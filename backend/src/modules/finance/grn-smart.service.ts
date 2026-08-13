import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { recordFinanceApprovalEvent } from "../../shared/financeApprovalEvent.js";
import {
  calculateBudgetLine,
  type BudgetGstType,
  type BudgetTaxTreatment,
} from "../process-pnl/branch-budget.service.js";
import { budgetConsumptionService } from "../process-pnl/budget-consumption.service.js";
import { isPeriodLocked } from "../process-pnl/finance-period-lock.js";
import { vendorPaymentService } from "./vendor-payment.service.js";
import { imprestLedgerService } from "./imprest-ledger.service.js";
import {
  grnPeriodAllocationService,
  resolveEligiblePeriods,
} from "./grn-period-allocation.service.js";

export interface SmartAllocationInput {
  budgetLineId: string;
  quantity: number;
  unitRate?: number;
  remarks?: string;
}

export interface SmartGrnInvoiceInput {
  invoiceNumber?: string;
  /** E-invoice reference number (IRN) — optional, Finance Head visible. */
  irn?: string | null;
  irnAckNo?: string | null;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  purchaseReference?: string | null;
  vendorGstin?: string | null;
  placeOfSupply?: string | null;
  otherCharges?: number;
  roundOffAmount?: number;
  declaredInvoiceTotal?: number;
  /** Multi-month recognition (Req 5). Both NULL keeps the GRN single-month, which is what
   *  every existing caller sends and what every historical row already is. */
  recognitionStartPeriod?: string | null;
  recognitionEndPeriod?: string | null;
  /** Custom percentage per month (YYYY-MM → pct). Finance Head override for non-equal splits.
   *  Must cover every month in the start→end range and sum to 100. */
  recognitionCustomPercentages?: Record<string, number> | null;
  allocations: SmartAllocationInput[];
}

/** Unified vendor-GRN flow: one declared invoice total, broken into repeatable GST-slab
 *  components (the same real invoice often carries 2+ GST rates), fanned out across
 *  whichever cost-centre budget lines the split targets. See saveComponentAllocations(). */
export interface InvoiceComponentInput {
  amountWithoutTax: number;
  gstRate: number;
  remarks?: string;
  /** Optional HSN (goods) or SAC (services) code from the physical invoice. */
  hsnSacCode?: string | null;
}

export interface CostCentreSplitRowInput {
  budgetLineId: string;
  percentage: number;
  remarks?: string;
}

export interface SmartGrnComponentSplitInput {
  invoiceNumber?: string;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  purchaseReference?: string | null;
  vendorGstin?: string | null;
  placeOfSupply?: string | null;
  /** Override accounting month (YYYY-MM). Finance Head / Accounts Head / Super Admin only.
   *  Omit to keep the existing value (COALESCE at DB layer). */
  accountingPeriod?: string | null;
  /** E-invoice reference number (IRN) — optional, Finance Head visible. */
  irn?: string | null;
  irnAckNo?: string | null;
  declaredInvoiceTotal: number;
  /** Multi-month recognition (Req 5). Both NULL keeps the GRN single-month, which is what
   *  every existing caller sends and what every historical row already is. */
  recognitionStartPeriod?: string | null;
  recognitionEndPeriod?: string | null;
  /** Custom percentage per month (YYYY-MM → pct). Finance Head override for non-equal splits.
   *  Must cover every month in the start→end range and sum to 100. */
  recognitionCustomPercentages?: Record<string, number> | null;
  components: InvoiceComponentInput[];
  costCentreSplits: CostCentreSplitRowInput[];
}

/** Above this, the raiser must fix the invoice components themselves — a bigger mismatch
 *  than ordinary invoice rounding is a real data-entry error, not something to auto-absorb. */
const GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT = 1.00;
/** Standard Indian GST slabs — kept in lockstep with src/lib/gst.ts's GST_RATES on the
 *  frontend; the dropdown there is the only way to reach this value from the UI. */
const ALLOWED_GST_RATES = new Set([0, 5, 12, 18, 28]);

export interface RegisteredDocumentInput {
  originalName: string;
  storedPath: string;
  mimeType: string;
  fileSizeBytes: number;
  documentType?: "invoice" | "receipt" | "po" | "contract" | "supporting" | "other";
  isPrimary?: boolean;
}

type ValidationStatus = "passed" | "warning" | "failed";
type ValidationSeverity = "info" | "warning" | "error";

type ValidationResult = {
  code: string;
  status: ValidationStatus;
  severity: ValidationSeverity;
  blocking: boolean;
  message: string;
  details?: Record<string, unknown>;
};

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 10_000) / 10_000;
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function normalizeInvoiceNumber(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

function dateOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function lockGrn(connection: PoolConnection, grnId: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT * FROM grn_request WHERE id = ? FOR UPDATE",
    [grnId]
  );
  if (!rows[0]) throw new Error("GRN not found");
  return rows[0] as any;
}

async function lockBudgetLine(
  connection: PoolConnection,
  budgetLineId: string,
  branchId: string
) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT l.*, h.status AS budget_status, h.branch_id, h.period_code, h.financial_year,
            pm.process_name, ccm.cost_centre_name
       FROM finance_budget_line l
       JOIN finance_budget_header h ON h.id = l.budget_id
       LEFT JOIN process_master pm ON pm.id = l.process_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = l.cost_centre_id
      WHERE l.id = ? AND h.branch_id = ?
      FOR UPDATE`,
    [budgetLineId, branchId]
  );
  const line = rows[0] as any;
  if (!line) throw new Error("Approved budget line was not found for this branch");
  if (String(line.budget_status) !== "active") {
    throw new Error("Only fully approved active budget lines can be allocated");
  }
  return line;
}

async function loadAllocations(connection: PoolConnection, grnId: string, forUpdate = false) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT a.*, pm.process_name, ccm.cost_centre_name, h.budget_number,
            l.head AS budget_head, l.sub_head AS budget_sub_head, l.item_name AS budget_item_name
       FROM grn_cost_allocation a
       JOIN finance_budget_line l ON l.id = a.budget_line_id
       JOIN finance_budget_header h ON h.id = a.budget_id
       LEFT JOIN process_master pm ON pm.id = a.process_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = a.cost_centre_id
      WHERE a.grn_request_id = ?
      ORDER BY a.sequence_no${forUpdate ? " FOR UPDATE" : ""}`,
    [grnId]
  );
  return rows as any[];
}

async function loadInvoiceComponents(connection: PoolConnection, grnId: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT * FROM grn_invoice_component WHERE grn_request_id = ? ORDER BY sequence_no",
    [grnId]
  );
  return rows as any[];
}

async function writeAudit(
  action: string,
  grnId: string,
  actorUserId: string,
  actorRole: string,
  changes: Record<string, unknown>
) {
  await logSensitiveAction({
    actor_user_id: actorUserId,
    actor_role: actorRole,
    action_type: `GRN_${action}`,
    module_key: "FINANCE",
    entity_type: "grn_request",
    entity_id: grnId,
    change_summary: changes,
  });
}

function parseModelJson(text: string) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}

async function refreshDuplicateMatches(connection: PoolConnection, grn: any) {
  await connection.execute("DELETE FROM grn_duplicate_match WHERE grn_request_id = ?", [grn.id]);
  const matches: Array<{
    matchedGrnId: string | null;
    matchedDocumentId: string | null;
    type: "invoice_identity" | "document_hash" | "amount_date_vendor" | "possible";
    confidence: number;
    details: Record<string, unknown>;
  }> = [];

  const invoiceNumber = normalizeInvoiceNumber(grn.invoice_number);
  if (grn.vendor_id && invoiceNumber) {
    const [invoiceRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, grn_number, invoice_number, bill_date, amount_with_tax, status
         FROM grn_request
        WHERE id <> ? AND vendor_id = ?
          AND UPPER(REPLACE(COALESCE(invoice_number,''), ' ', '')) = ?
          AND status NOT IN ('rejected','cancelled')
        LIMIT 20`,
      [grn.id, grn.vendor_id, invoiceNumber]
    );
    for (const row of invoiceRows) {
      matches.push({
        matchedGrnId: String(row.id),
        matchedDocumentId: null,
        type: "invoice_identity",
        confidence: 100,
        details: {
          grnNumber: row.grn_number,
          invoiceNumber: row.invoice_number,
          billDate: row.bill_date,
          amount: row.amount_with_tax,
          status: row.status,
        },
      });
    }
  }

  const [hashRows] = await connection.execute<RowDataPacket[]>(
    `SELECT d.id AS document_id, d.grn_request_id, d.original_name, g.grn_number
       FROM grn_document current_doc
       JOIN grn_document d ON d.sha256 = current_doc.sha256 AND d.id <> current_doc.id
       JOIN grn_request g ON g.id = d.grn_request_id
      WHERE current_doc.grn_request_id = ? AND d.grn_request_id <> ?
      LIMIT 20`,
    [grn.id, grn.id]
  );
  for (const row of hashRows) {
    matches.push({
      matchedGrnId: String(row.grn_request_id),
      matchedDocumentId: String(row.document_id),
      type: "document_hash",
      confidence: 100,
      details: { grnNumber: row.grn_number, originalName: row.original_name },
    });
  }

  if (grn.vendor_id && grn.bill_date && Number(grn.amount_with_tax || grn.amount) > 0) {
    const [possibleRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, grn_number, invoice_number, bill_date, amount_with_tax, status
         FROM grn_request
        WHERE id <> ? AND vendor_id = ? AND bill_date = ?
          AND ABS(COALESCE(amount_with_tax, amount, 0) - ?) <= 1
          AND status NOT IN ('rejected','cancelled')
        LIMIT 20`,
      [grn.id, grn.vendor_id, grn.bill_date, Number(grn.amount_with_tax || grn.amount)]
    );
    for (const row of possibleRows) {
      if (matches.some((item) => item.matchedGrnId === String(row.id))) continue;
      matches.push({
        matchedGrnId: String(row.id),
        matchedDocumentId: null,
        type: "amount_date_vendor",
        confidence: 85,
        details: {
          grnNumber: row.grn_number,
          invoiceNumber: row.invoice_number,
          billDate: row.bill_date,
          amount: row.amount_with_tax,
          status: row.status,
        },
      });
    }
  }

  for (const match of matches) {
    await connection.execute(
      `INSERT INTO grn_duplicate_match
       (id, grn_request_id, matched_grn_request_id, matched_document_id,
        match_type, confidence_score, match_details_json)
       VALUES (?,?,?,?,?,?,?)`,
      [
        randomUUID(),
        grn.id,
        match.matchedGrnId,
        match.matchedDocumentId,
        match.type,
        match.confidence,
        safeJson(match.details),
      ]
    );
  }
  return matches;
}

async function buildValidations(connection: PoolConnection, grnId: string) {
  const [grnRows] = await connection.execute<RowDataPacket[]>(
    "SELECT * FROM grn_request WHERE id = ? LIMIT 1",
    [grnId]
  );
  const grn = grnRows[0] as any;
  if (!grn) throw new Error("GRN not found");
  const allocations = await loadAllocations(connection, grnId);
  const invoiceComponents = await loadInvoiceComponents(connection, grnId);
  const [documentRows] = await connection.execute<RowDataPacket[]>(
    "SELECT * FROM grn_document WHERE grn_request_id = ? ORDER BY uploaded_at",
    [grnId]
  );
  const [extractionRows] = await connection.execute<RowDataPacket[]>(
    `SELECT e.* FROM grn_document_extraction e
      WHERE e.grn_request_id = ? ORDER BY e.created_at DESC LIMIT 1`,
    [grnId]
  );
  const duplicates = await refreshDuplicateMatches(connection, grn);
  const results: ValidationResult[] = [];

  results.push({
    code: "DOCUMENT_REQUIRED",
    status: documentRows.length ? "passed" : "failed",
    severity: documentRows.length ? "info" : "error",
    blocking: !documentRows.length,
    message: documentRows.length ? `${documentRows.length} supporting document(s) attached` : "At least one invoice or supporting proof is mandatory",
  });

  results.push({
    code: "INVOICE_NUMBER_REQUIRED",
    status: grn.grn_type === "imprest" || normalizeInvoiceNumber(grn.invoice_number) ? "passed" : "failed",
    severity: grn.grn_type === "imprest" || normalizeInvoiceNumber(grn.invoice_number) ? "info" : "error",
    blocking: grn.grn_type === "vendor" && !normalizeInvoiceNumber(grn.invoice_number),
    message: grn.grn_type === "imprest" || normalizeInvoiceNumber(grn.invoice_number)
      ? "Invoice identity captured"
      : "Vendor GRN requires an invoice number",
  });

  const totalGross = roundMoney(allocations.reduce((sum, item) => sum + Number(item.amount_with_tax || 0), 0));
  const totalBase = roundMoney(allocations.reduce((sum, item) => sum + Number(item.amount_without_tax || 0), 0));
  const totalTax = roundMoney(allocations.reduce((sum, item) => sum + Number(item.tax_amount || 0), 0));
  const totalPnl = roundMoney(allocations.reduce((sum, item) => sum + Number(item.pnl_cost_amount || 0), 0));
  const totalPercent = Math.round(allocations.reduce((sum, item) => sum + Number(item.allocation_percentage || 0), 0) * 1_000_000) / 1_000_000;
  const parentGross = roundMoney(Number(grn.amount_with_tax || grn.amount || 0));

  results.push({
    code: "ALLOCATION_REQUIRED",
    status: allocations.length ? "passed" : "failed",
    severity: allocations.length ? "info" : "error",
    blocking: !allocations.length,
    message: allocations.length ? `${allocations.length} cost allocation row(s) prepared` : "At least one approved budget allocation is required",
  });
  results.push({
    code: "ALLOCATION_PERCENT",
    status: allocations.length && Math.abs(totalPercent - 100) <= 0.0001 ? "passed" : "failed",
    severity: allocations.length && Math.abs(totalPercent - 100) <= 0.0001 ? "info" : "error",
    blocking: !allocations.length || Math.abs(totalPercent - 100) > 0.0001,
    message: `Allocation percentage totals ${totalPercent.toFixed(6)}%`,
    details: { totalPercent },
  });
  results.push({
    code: "ALLOCATION_AMOUNT_RECONCILIATION",
    status: allocations.length && Math.abs(totalGross - parentGross) <= 0.01 ? "passed" : "failed",
    severity: allocations.length && Math.abs(totalGross - parentGross) <= 0.01 ? "info" : "error",
    blocking: !allocations.length || Math.abs(totalGross - parentGross) > 0.01,
    message: Math.abs(totalGross - parentGross) <= 0.01
      ? "Allocation total exactly matches the GRN total"
      : `Allocation difference is ${roundMoney(totalGross - parentGross).toFixed(2)}`,
    details: { totalBase, totalTax, totalGross, totalPnl, parentGross },
  });

  // Only fires for GRNs raised through the invoice-component flow (saveComponentAllocations);
  // legacy single-line and pre-existing split-mode GRNs have zero grn_invoice_component rows
  // and skip this entirely — re-verifies what saveComponentAllocations already enforced at
  // save time, catching any later mutation (e.g. confirmExtraction touching round_off_amount).
  if (invoiceComponents.length) {
    const componentGross = roundMoney(
      invoiceComponents.reduce((sum, item) => sum + Number(item.amount_with_tax || 0), 0)
    );
    const reconciledTotal = roundMoney(componentGross + Number(grn.round_off_amount || 0));
    const componentDiff = roundMoney(reconciledTotal - parentGross);
    results.push({
      code: "INVOICE_COMPONENT_RECONCILIATION",
      status: Math.abs(componentDiff) <= 0.01 ? "passed" : "failed",
      severity: Math.abs(componentDiff) <= 0.01 ? "info" : "error",
      blocking: Math.abs(componentDiff) > 0.01,
      message: Math.abs(componentDiff) <= 0.01
        ? "Invoice components plus round-off exactly match the GRN total"
        : `Invoice component total (incl. round-off) differs from the GRN total by ${componentDiff.toFixed(2)}`,
      details: { componentGross, roundOffAmount: Number(grn.round_off_amount || 0), reconciledTotal, parentGross },
    });
  }

  const exactDuplicates = duplicates.filter((item) => item.type === "invoice_identity" || item.type === "document_hash");
  results.push({
    code: "DUPLICATE_INVOICE",
    status: exactDuplicates.length ? "failed" : duplicates.length ? "warning" : "passed",
    severity: exactDuplicates.length ? "error" : duplicates.length ? "warning" : "info",
    blocking: exactDuplicates.length > 0,
    message: exactDuplicates.length
      ? `${exactDuplicates.length} exact duplicate match(es) require resolution`
      : duplicates.length
        ? `${duplicates.length} possible duplicate match(es) found`
        : "No duplicate invoice or document match found",
    details: { matchCount: duplicates.length, exactMatchCount: exactDuplicates.length },
  });

  const latestExtraction = extractionRows[0] as any;
  let documentMatchStatus: "not_checked" | "matched" | "near_match" | "mismatch" | "manual_review" = "not_checked";
  if (latestExtraction?.status === "manual_review" || latestExtraction?.status === "failed") {
    documentMatchStatus = "manual_review";
    results.push({
      code: "DOCUMENT_EXTRACTION",
      status: "warning",
      severity: "warning",
      blocking: false,
      message: "Automated extraction is unavailable or needs manual verification",
    });
  } else if (latestExtraction?.extracted_fields_json) {
    const fields = typeof latestExtraction.extracted_fields_json === "string"
      ? JSON.parse(latestExtraction.extracted_fields_json)
      : latestExtraction.extracted_fields_json;
    const extractedGross = Number(fields?.grossAmount ?? fields?.invoiceTotal ?? 0);
    const difference = roundMoney(extractedGross - parentGross);
    if (extractedGross > 0 && Math.abs(difference) <= 0.01) documentMatchStatus = "matched";
    else if (extractedGross > 0 && Math.abs(difference) <= 1) documentMatchStatus = "near_match";
    else if (extractedGross > 0) documentMatchStatus = "mismatch";
    else documentMatchStatus = "manual_review";
    results.push({
      code: "DOCUMENT_AMOUNT_MATCH",
      status: documentMatchStatus === "matched" ? "passed" : documentMatchStatus === "near_match" ? "warning" : "failed",
      severity: documentMatchStatus === "matched" ? "info" : documentMatchStatus === "near_match" ? "warning" : "error",
      blocking: documentMatchStatus === "mismatch",
      message: extractedGross > 0
        ? `Extracted invoice total ${extractedGross.toFixed(2)}; GRN total ${parentGross.toFixed(2)}`
        : "Invoice total could not be extracted reliably",
      details: { extractedGross, parentGross, difference },
    });
  } else {
    results.push({
      code: "DOCUMENT_EXTRACTION",
      status: "warning",
      severity: "warning",
      blocking: false,
      message: "Run document analysis or complete manual verification",
    });
  }

  // HSN/SAC: warn if any invoice component is missing its statutory commodity code.
  // Non-blocking — the approved business rule on mandatory vs optional is not yet codified
  // in this system; adding the check here makes it visible in the validation panel so Finance
  // can act on it without the field being silently ignored.
  if (invoiceComponents.length) {
    const missingHsn = (invoiceComponents as any[]).filter(
      (c) => !String(c.hsn_sac_code ?? "").trim()
    );
    results.push({
      code: "HSN_SAC_REQUIRED",
      status: missingHsn.length ? "warning" : "passed",
      severity: missingHsn.length ? "warning" : "info",
      blocking: false,
      message: missingHsn.length
        ? `${missingHsn.length} invoice component(s) are missing a HSN/SAC code — required for statutory compliance`
        : "HSN/SAC codes captured on all invoice components",
      details: { missingCount: missingHsn.length },
    });
  }

  // IRN: if an e-invoice reference number is present, the acknowledgement number must be too.
  if (grn.grn_type === "vendor" && String(grn.irn ?? "").trim()) {
    const hasAck = Boolean(String(grn.irn_ack_no ?? "").trim());
    results.push({
      code: "IRN_ACK_REQUIRED",
      status: hasAck ? "passed" : "warning",
      severity: hasAck ? "info" : "warning",
      blocking: false,
      message: hasAck
        ? "IRN acknowledgement number captured"
        : "IRN is present but acknowledgement number (IRN ACK No) is missing",
    });
  }

  await connection.execute("DELETE FROM grn_validation_result WHERE grn_request_id = ?", [grnId]);
  for (const result of results) {
    await connection.execute(
      `INSERT INTO grn_validation_result
       (id, grn_request_id, validation_code, severity, validation_status,
        is_blocking, message, details_json)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        randomUUID(), grnId, result.code, result.severity, result.status,
        result.blocking ? 1 : 0, result.message, safeJson(result.details),
      ]
    );
  }
  const passed = results.filter((item) => item.status === "passed").length;
  const score = results.length ? roundMoney((passed / results.length) * 100) : 0;
  await connection.execute(
    "UPDATE grn_request SET validation_score = ?, document_match_status = ? WHERE id = ?",
    [score, documentMatchStatus, grnId]
  );
  return { results, score, documentMatchStatus, duplicateCount: duplicates.length };
}

async function reserveAllocations(connection: PoolConnection, allocations: any[]) {
  for (const allocation of allocations) {
    await budgetConsumptionService.reserve(
      connection,
      String(allocation.budget_line_id),
      Number(allocation.amount_with_tax),
      Number(allocation.quantity),
      Number(allocation.amount_without_tax) || undefined
    );
  }
  await connection.execute(
    `UPDATE grn_cost_allocation
        SET lifecycle_status = 'reserved', reserved_at = NOW(), released_at = NULL
      WHERE grn_request_id = ?`,
    [allocations[0].grn_request_id]
  );
}

async function consumeAllocations(connection: PoolConnection, allocations: any[]) {
  for (const allocation of allocations) {
    await budgetConsumptionService.consume(
      connection,
      String(allocation.budget_line_id),
      Number(allocation.amount_with_tax),
      Number(allocation.quantity),
      Number(allocation.amount_without_tax) || undefined
    );
  }
  await connection.execute(
    `UPDATE grn_cost_allocation
        SET lifecycle_status = 'consumed', consumed_at = NOW()
      WHERE grn_request_id = ?`,
    [allocations[0].grn_request_id]
  );
}

async function releaseAllocations(connection: PoolConnection, allocations: any[]) {
  for (const allocation of allocations) {
    if (String(allocation.lifecycle_status) !== "reserved") continue;
    await budgetConsumptionService.release(
      connection,
      String(allocation.budget_line_id),
      Number(allocation.amount_with_tax),
      Number(allocation.quantity),
      Number(allocation.amount_without_tax) || undefined
    );
  }
  if (allocations.length) {
    await connection.execute(
      `UPDATE grn_cost_allocation
          SET lifecycle_status = 'released', released_at = NOW()
        WHERE grn_request_id = ? AND lifecycle_status = 'reserved'`,
      [allocations[0].grn_request_id]
    );
  }
}

/** Symmetric to releaseAllocations(), but against allocation rows already 'consumed' — for
 *  correcting a smart GRN whose Finance Head approval already moved every split allocation
 *  from reserved into consumed. */
async function reverseConsumedAllocations(connection: PoolConnection, allocations: any[]) {
  for (const allocation of allocations) {
    if (String(allocation.lifecycle_status) !== "consumed") continue;
    await budgetConsumptionService.reverseConsumption(
      connection,
      String(allocation.budget_line_id),
      Number(allocation.amount_with_tax),
      Number(allocation.quantity),
      Number(allocation.amount_without_tax) || undefined
    );
  }
  if (allocations.length) {
    await connection.execute(
      `UPDATE grn_cost_allocation
          SET lifecycle_status = 'reversed'
        WHERE grn_request_id = ? AND lifecycle_status = 'consumed'`,
      [allocations[0].grn_request_id]
    );
  }
}

export const grnSmartService = {
  async hasAllocations(grnId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM grn_cost_allocation WHERE grn_request_id = ?",
      [grnId]
    );
    return Number(rows[0]?.total ?? 0) > 0;
  },

  /** Called by grnService.reverseConsumption() once it has confirmed the GRN is a smart
   *  (split-allocation) GRN and already holds the row lock on grn_request. */
  async reverseConsumption(connection: PoolConnection, grnId: string) {
    const allocations = await loadAllocations(connection, grnId, true);
    if (!allocations.length) throw new Error("Smart GRN has no saved cost allocations");
    await reverseConsumedAllocations(connection, allocations);
  },

  async saveAllocations(
    grnId: string,
    input: SmartGrnInvoiceInput,
    actorUserId: string,
    actorRole: string
  ) {
    if (!Array.isArray(input.allocations) || !input.allocations.length) {
      throw new Error("At least one cost-centre allocation is required");
    }
    if (input.allocations.length > 100) throw new Error("A GRN cannot exceed 100 allocation rows");

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const grn = await lockGrn(connection, grnId);
      if (String(grn.status) !== "draft") {
        throw new Error("Allocations can only be changed while the GRN is a draft");
      }

      const prepared: any[] = [];
      const groupedUsage = new Map<string, { amount: number; quantity: number; line: any }>();
      for (let index = 0; index < input.allocations.length; index += 1) {
        const allocation = input.allocations[index];
        if (!allocation?.budgetLineId) throw new Error(`Allocation ${index + 1}: budget line is required`);
        const line = await lockBudgetLine(connection, allocation.budgetLineId, String(grn.branch_id));
        if (consumptionPeriodOf(grn) !== String(line.period_code)) {
          throw new Error(`Allocation ${index + 1}: budget period ${line.period_code} does not match the accounting month`);
        }
        if (await isPeriodLocked(line.period_code)) {
          throw new Error(
            `Allocation ${index + 1}: ${line.period_code} is locked for P&L close. Raise this against the current open period.`
          );
        }
        const quantity = Number(allocation.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error(`Allocation ${index + 1}: quantity must be greater than zero`);
        }
        const unitRate = allocation.unitRate == null ? Number(line.unit_rate) : Number(allocation.unitRate);
        if (!Number.isFinite(unitRate) || unitRate < 0) {
          throw new Error(`Allocation ${index + 1}: unit rate is invalid`);
        }
        if (unitRate > Number(line.unit_rate) + 0.0001) {
          throw new Error(`Allocation ${index + 1}: unit rate exceeds the approved rate`);
        }
        const amounts = calculateBudgetLine({
          head: String(line.head),
          subHead: line.sub_head,
          itemName: String(line.item_name),
          quantity,
          unit: String(line.unit),
          unitRate,
          taxTreatment: String(line.tax_treatment) as BudgetTaxTreatment,
          gstRate: Number(line.gst_rate),
          gstType: String(line.gst_type) as BudgetGstType,
          recoverableTaxPct: Number(line.recoverable_tax_pct),
          justification: String(line.justification || "Approved budget allocation"),
        });
        const usage = groupedUsage.get(String(line.id)) ?? { amount: 0, quantity: 0, line };
        usage.amount = roundMoney(usage.amount + amounts.grossAmount);
        usage.quantity = roundQuantity(usage.quantity + quantity);
        groupedUsage.set(String(line.id), usage);
        prepared.push({ line, quantity, unitRate, amounts, remarks: allocation.remarks?.trim() || null });
      }

      for (const usage of groupedUsage.values()) {
        const availableAmount = roundMoney(
          Number(usage.line.gross_amount || 0)
          - Number(usage.line.reserved_amount || 0)
          - Number(usage.line.consumed_amount || 0)
        );
        const availableQuantity = roundQuantity(
          Number(usage.line.quantity || 0)
          - Number(usage.line.reserved_quantity || 0)
          - Number(usage.line.consumed_quantity || 0)
        );
        if (usage.amount > availableAmount + 0.01) {
          throw new Error(`${usage.line.item_name}: split allocation exceeds available budget by ${(usage.amount - availableAmount).toFixed(2)}`);
        }
        if (usage.quantity > availableQuantity + 0.0001) {
          throw new Error(`${usage.line.item_name}: split allocation exceeds available quantity by ${roundQuantity(usage.quantity - availableQuantity)}`);
        }
      }

      const totalBase = roundMoney(prepared.reduce((sum, item) => sum + item.amounts.baseAmount, 0));
      const totalTax = roundMoney(prepared.reduce((sum, item) => sum + item.amounts.taxAmount, 0));
      const totalGross = roundMoney(prepared.reduce((sum, item) => sum + item.amounts.grossAmount, 0));
      const totalPnl = roundMoney(prepared.reduce((sum, item) => sum + item.amounts.pnlCostAmount, 0));
      const totalRecoverable = roundMoney(prepared.reduce((sum, item) => sum + item.amounts.recoverableTaxAmount, 0));
      const totalQuantity = roundQuantity(prepared.reduce((sum, item) => sum + item.quantity, 0));
      if (input.declaredInvoiceTotal != null && Math.abs(Number(input.declaredInvoiceTotal) - totalGross) > 0.01) {
        throw new Error(`Cost-centre splits must equal the invoice total exactly. Difference: ${roundMoney(totalGross - Number(input.declaredInvoiceTotal)).toFixed(2)}`);
      }

      await connection.execute("DELETE FROM grn_cost_allocation WHERE grn_request_id = ?", [grnId]);
      for (let index = 0; index < prepared.length; index += 1) {
        const item = prepared[index];
        const percentage = totalGross > 0
          ? Math.round((item.amounts.grossAmount / totalGross) * 100 * 1_000_000) / 1_000_000
          : 0;
        await connection.execute(
          `INSERT INTO grn_cost_allocation
           (id, grn_request_id, sequence_no, budget_id, budget_line_id, branch_id,
            process_id, cost_centre_id, cost_class, allocation_percentage,
            quantity, unit, unit_rate, tax_treatment, gst_rate, gst_type,
            recoverable_tax_pct, amount_without_tax, tax_amount, cgst_amount,
            sgst_amount, igst_amount, amount_with_tax, recoverable_tax_amount,
            pnl_cost_amount, lifecycle_status, remarks, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            randomUUID(), grnId, index + 1, item.line.budget_id, item.line.id,
            grn.branch_id, item.line.process_id ?? null, item.line.cost_centre_id ?? null,
            item.line.process_id || item.line.cost_centre_id ? "direct" : "indirect",
            percentage, item.quantity, item.line.unit, item.unitRate,
            item.line.tax_treatment, item.line.gst_rate, item.line.gst_type,
            item.line.recoverable_tax_pct, item.amounts.baseAmount,
            item.amounts.taxAmount, item.amounts.cgstAmount, item.amounts.sgstAmount,
            item.amounts.igstAmount, item.amounts.grossAmount,
            item.amounts.recoverableTaxAmount, item.amounts.pnlCostAmount,
            "draft", item.remarks, actorUserId,
          ]
        );
      }

      // Force the percentage total to exactly 100.000000 after decimal rounding.
      const [percentageRows] = await connection.execute<RowDataPacket[]>(
        "SELECT id, allocation_percentage FROM grn_cost_allocation WHERE grn_request_id = ? ORDER BY sequence_no",
        [grnId]
      );
      const percentageTotal = percentageRows.reduce((sum, row) => sum + Number(row.allocation_percentage), 0);
      if (percentageRows.length && Math.abs(percentageTotal - 100) > 0.000001) {
        const last = percentageRows[percentageRows.length - 1];
        await connection.execute(
          "UPDATE grn_cost_allocation SET allocation_percentage = allocation_percentage + ? WHERE id = ?",
          [Math.round((100 - percentageTotal) * 1_000_000) / 1_000_000, last.id]
        );
      }

      const distinctProcesses = new Set(prepared.map((item) => item.line.process_id).filter(Boolean));
      const distinctCostCentres = new Set(prepared.map((item) => item.line.cost_centre_id).filter(Boolean));
      const distinctHeads = new Set(prepared.map((item) => String(item.line.head)));
      const distinctSubHeads = new Set(prepared.map((item) => String(item.line.sub_head || "")));
      const first = prepared[0].line;
      const weightedGstRate = totalBase > 0 ? roundMoney((totalTax / totalBase) * 100) : 0;
      const weightedRecoverablePct = totalTax > 0 ? roundMoney((totalRecoverable / totalTax) * 100) : 0;
      const units = new Set(prepared.map((item) => String(item.line.unit)));
      const taxTreatments = new Set(prepared.map((item) => String(item.line.tax_treatment)));
      const gstTypes = new Set(prepared.map((item) => String(item.line.gst_type)));

      await connection.execute(
        `UPDATE grn_request
            SET allocation_mode = ?, budget_id = ?, budget_line_id = ?,
                process_id = ?, cost_centre_id = ?, cost_class = ?,
                head = ?, sub_head = ?, description = ?, quantity = ?, unit = ?,
                unit_rate = ?, tax_treatment = ?, gst_rate = ?, gst_type = ?,
                recoverable_tax_pct = ?, amount_without_tax = ?, tax_amount = ?,
                amount_with_tax = ?, pnl_cost_amount = ?, amount = ?,
                invoice_number = ?, irn = ?, irn_ack_no = ?,
                service_period_start = ?, service_period_end = ?,
                purchase_reference = ?, vendor_gstin = ?, place_of_supply = ?,
                other_charges = ?, round_off_amount = ?
          WHERE id = ?`,
        [
          prepared.length > 1 ? "split" : "single", first.budget_id, first.id,
          distinctProcesses.size === 1 ? [...distinctProcesses][0] : null,
          distinctCostCentres.size === 1 ? [...distinctCostCentres][0] : null,
          prepared.some((item) => item.line.process_id || item.line.cost_centre_id) ? "direct" : "indirect",
          distinctHeads.size === 1 ? [...distinctHeads][0] : "Multiple Heads",
          distinctSubHeads.size === 1 ? [...distinctSubHeads][0] : "Multiple Sub-Heads",
          prepared.length === 1 ? String(first.item_name) : `Split invoice across ${prepared.length} approved budget lines`,
          totalQuantity, units.size === 1 ? [...units][0] : "Mixed",
          totalQuantity > 0 ? roundMoney(totalBase / totalQuantity) : 0,
          taxTreatments.size === 1 ? [...taxTreatments][0] : "exclusive",
          weightedGstRate, gstTypes.size === 1 ? [...gstTypes][0] : "none",
          weightedRecoverablePct, totalBase, totalTax, totalGross, totalPnl, totalGross,
          normalizeInvoiceNumber(input.invoiceNumber) || null,
          String(input.irn ?? "").trim() || null,
          String(input.irnAckNo ?? "").trim() || null,
          dateOrNull(input.servicePeriodStart), dateOrNull(input.servicePeriodEnd),
          String(input.purchaseReference ?? "").trim() || null,
          String(input.vendorGstin ?? "").trim().toUpperCase() || null,
          String(input.placeOfSupply ?? "").trim() || null,
          roundMoney(Number(input.otherCharges ?? 0)), roundMoney(Number(input.roundOffAmount ?? 0)),
          grnId,
        ]
      );

      // Recognition schedule last: it reads back the allocation rows just written, and being
      // inside this transaction means a split that does not reconcile rolls the invoice back.
      const periodSplit = await writePeriodSplits(connection, grnId, grn, input, actorUserId, actorRole);

      await connection.commit();
      await writeAudit("ALLOCATIONS_SAVED", grnId, actorUserId, actorRole, {
        recognition_months: periodSplit?.eligibleCount ?? 1,
        allocation_count: prepared.length,
        amount_without_tax: totalBase,
        tax_amount: totalTax,
        amount_with_tax: totalGross,
        pnl_cost_amount: totalPnl,
      });
      return this.getWorkspace(grnId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  /** The unified vendor-GRN flow: one declared invoice total, a single Head/Sub-head
   *  classification split across cost centres by percentage, and the invoice itself broken
   *  into repeatable {amount without tax, GST slab} components (the same real invoice
   *  routinely carries 2+ GST rates). Fans out to N (cost-centre splits) x M (components)
   *  grn_cost_allocation rows, each tagged with the component that drove its GST rate.
   *
   *  Parallel to, not a replacement for, saveAllocations() above — imprest GRNs and any
   *  draft started under the old split-mode UI keep using that route untouched. */
  async saveComponentAllocations(
    grnId: string,
    input: SmartGrnComponentSplitInput,
    actorUserId: string,
    actorRole: string
  ) {
    const components = Array.isArray(input.components) ? input.components : [];
    const splits = Array.isArray(input.costCentreSplits) ? input.costCentreSplits : [];
    if (!components.length) throw new Error("At least one invoice component is required");
    if (components.length > 20) throw new Error("A GRN cannot exceed 20 invoice components");
    if (!splits.length) throw new Error("At least one cost centre is required");
    if (splits.length > 100) throw new Error("A GRN cannot exceed 100 cost-centre splits");
    const declaredTotal = Number(input.declaredInvoiceTotal);
    if (!Number.isFinite(declaredTotal) || declaredTotal <= 0) {
      throw new Error("Total invoice amount (incl. GST) must be greater than zero");
    }

    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      const base = Number(component.amountWithoutTax);
      if (!Number.isFinite(base) || base <= 0) {
        throw new Error(`Component ${index + 1}: amount without tax must be greater than zero`);
      }
      if (!ALLOWED_GST_RATES.has(Number(component.gstRate))) {
        throw new Error(`Component ${index + 1}: GST rate must be one of 0%, 5%, 12%, 18%, 28%`);
      }
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const grn = await lockGrn(connection, grnId);
      if (String(grn.status) !== "draft") {
        throw new Error("Invoice components can only be changed while the GRN is a draft");
      }
      if (String(grn.grn_type) !== "vendor") {
        throw new Error("Invoice-component GRNs are only supported for vendor GRNs");
      }

      // Resolve every cost-centre split row against its approved budget line — same lock,
      // period-match, and period-lock checks saveAllocations() already applies per row.
      const resolvedSplits: any[] = [];
      let percentageSum = 0;
      for (let index = 0; index < splits.length; index += 1) {
        const split = splits[index];
        if (!split?.budgetLineId) throw new Error(`Cost centre ${index + 1}: budget line is required`);
        const percentage = Number(split.percentage);
        if (!Number.isFinite(percentage) || percentage <= 0) {
          throw new Error(`Cost centre ${index + 1}: split percentage must be greater than zero`);
        }
        const line = await lockBudgetLine(connection, split.budgetLineId, String(grn.branch_id));
        if (consumptionPeriodOf(grn) !== String(line.period_code)) {
          throw new Error(`Cost centre ${index + 1}: budget period ${line.period_code} does not match the accounting month`);
        }
        if (await isPeriodLocked(line.period_code)) {
          throw new Error(
            `Cost centre ${index + 1}: ${line.period_code} is locked for P&L close. Raise this against the current open period.`
          );
        }
        percentageSum += percentage;
        resolvedSplits.push({ line, percentage, remarks: split.remarks?.trim() || null });
      }
      if (Math.abs(percentageSum - 100) > 0.5) {
        throw new Error(`Cost-centre split percentages must total 100% (currently ${roundMoney(percentageSum)}%)`);
      }
      // Absorb ordinary floating-point noise from an auto-split calculation into the last row,
      // exactly like the defensive correction saveAllocations() applies after insert below.
      resolvedSplits[resolvedSplits.length - 1].percentage += 100 - percentageSum;

      // One Head/Sub-head classification per GRN — the split only decides how much of that
      // one spend belongs to which cost centre, not a mix of different expense categories.
      const distinctHeads = new Set(resolvedSplits.map((item) => String(item.line.head)));
      const distinctSubHeads = new Set(resolvedSplits.map((item) => String(item.line.sub_head || "")));
      if (distinctHeads.size > 1 || distinctSubHeads.size > 1) {
        throw new Error("All cost-centre splits must share the same expense head and sub-head");
      }

      // The invoice's own GST rate overrides whatever the budget line assumed at planning
      // time (requirement: invoice is ground truth) — but a line marked exempt/non-taxable
      // structurally cannot carry a GST-bearing component; that's a hard conflict, not
      // something to silently coerce to 0%.
      const gstBearing = components.some((component) => Number(component.gstRate) > 0);
      if (gstBearing) {
        const exemptSplit = resolvedSplits.find((item) =>
          ["exempt", "non_gst"].includes(String(item.line.tax_treatment))
        );
        if (exemptSplit) {
          const label = String(exemptSplit.line.tax_treatment) === "exempt" ? "exempt" : "non-taxable";
          throw new Error(
            `Cost centre "${exemptSplit.line.cost_centre_name || "Unassigned"}": budget line is marked ${label} and cannot carry a GST-bearing invoice component.`
          );
        }
      }

      // Tax breakdown is entirely component-driven (each component supplies its own explicit
      // base + rate), computed via the same calculateBudgetLine() every other GRN/budget path
      // uses, with quantity=1 and unitRate=<this component's base> so base comes out exact.
      // gstType: use the first resolved split's budget-line gst_type — all splits share the same
      // head/sub-head and therefore the same gst_type (intra-state vs inter-state). "cgst_sgst"
      // was hardcoded previously; that produced the correct total tax amount (taxAmount is
      // gstRate × base regardless of gstType) but wrong cgst/sgst/igst column breakdown.
      const componentGstType = (resolvedSplits[0]?.line?.gst_type as BudgetGstType | undefined) ?? "cgst_sgst";
      const componentAmounts = components.map((component) =>
        calculateBudgetLine({
          head: "invoice-component",
          itemName: "invoice-component",
          quantity: 1,
          unit: "amount",
          unitRate: Number(component.amountWithoutTax),
          taxTreatment: "exclusive",
          gstRate: Number(component.gstRate),
          gstType: componentGstType,
          recoverableTaxPct: 100,
          justification: "Invoice component",
        })
      );
      const rawTotalBase = roundMoney(componentAmounts.reduce((sum, item) => sum + item.baseAmount, 0));
      const rawTotalTax = roundMoney(componentAmounts.reduce((sum, item) => sum + item.taxAmount, 0));
      const rawTotalGross = roundMoney(rawTotalBase + rawTotalTax);
      const diff = roundMoney(declaredTotal - rawTotalGross);
      if (Math.abs(diff) > GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT) {
        throw new Error(
          `Invoice components total ₹${rawTotalGross.toFixed(2)} does not match the declared invoice total `
          + `₹${declaredTotal.toFixed(2)}. Difference ₹${diff.toFixed(2)} exceeds the ₹1.00 auto-round-off limit.`
        );
      }

      // Fan out N cost-centre rows x M components. Each grid cell's tax uses the component's
      // own rate/type (gst_type/recoverable_tax_pct still inherited from the budget line,
      // unchanged from today — only the rate itself is invoice-driven).
      const grid: any[] = [];
      for (const split of resolvedSplits) {
        const { line, percentage } = split;
        for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
          const component = components[componentIndex];
          const compBase = roundMoney(Number(component.amountWithoutTax) * percentage / 100);
          const unitRate = Number(line.unit_rate);
          if (!(unitRate > 0)) {
            throw new Error(
              `Cost centre "${line.cost_centre_name || "Unassigned"}": budget line has no approved unit rate to derive a consumed quantity from.`
            );
          }
          const amounts = calculateBudgetLine({
            head: String(line.head),
            subHead: line.sub_head,
            itemName: String(line.item_name),
            quantity: 1,
            unit: String(line.unit),
            unitRate: compBase,
            taxTreatment: "exclusive",
            gstRate: Number(component.gstRate),
            gstType: String(line.gst_type) as BudgetGstType,
            recoverableTaxPct: Number(line.recoverable_tax_pct),
            justification: String(line.justification || "Approved budget allocation"),
          });
          grid.push({
            line,
            component,
            componentIndex,
            quantity: roundQuantity(compBase / unitRate),
            unitRate,
            amounts,
            remarks: [split.remarks, component.remarks?.trim() || null].filter(Boolean).join(" — ") || null,
          });
        }
      }

      // Fold the <=₹1 round-off into whichever grid cell already carries the largest amount —
      // a pure rounding delta layered on amount_with_tax/pnl_cost_amount, not additional
      // taxable value, exactly like a printed invoice's own "Round Off" line. This keeps
      // Sigma(grn_cost_allocation.amount_with_tax) === grn_request.amount_with_tax exactly, so
      // the existing ALLOCATION_AMOUNT_RECONCILIATION check (tolerance <=0.01) keeps passing
      // unmodified; round_off_amount becomes a pure audit/disclosure figure.
      if (diff !== 0 && grid.length) {
        const target = grid.reduce((max, item) => (item.amounts.grossAmount > max.amounts.grossAmount ? item : max), grid[0]);
        target.amounts = {
          ...target.amounts,
          grossAmount: roundMoney(target.amounts.grossAmount + diff),
          pnlCostAmount: roundMoney(target.amounts.pnlCostAmount + diff),
        };
      }

      // Capacity check, grouped per budget line exactly like saveAllocations() — the round-off
      // adjustment above is included since it already landed inside a grid cell's amount.
      const groupedUsage = new Map<string, { amount: number; quantity: number; line: any }>();
      for (const cell of grid) {
        const usage = groupedUsage.get(String(cell.line.id)) ?? { amount: 0, quantity: 0, line: cell.line };
        usage.amount = roundMoney(usage.amount + cell.amounts.grossAmount);
        usage.quantity = roundQuantity(usage.quantity + cell.quantity);
        groupedUsage.set(String(cell.line.id), usage);
      }
      for (const usage of groupedUsage.values()) {
        const availableAmount = roundMoney(
          Number(usage.line.gross_amount || 0)
          - Number(usage.line.reserved_amount || 0)
          - Number(usage.line.consumed_amount || 0)
        );
        const availableQuantity = roundQuantity(
          Number(usage.line.quantity || 0)
          - Number(usage.line.reserved_quantity || 0)
          - Number(usage.line.consumed_quantity || 0)
        );
        if (usage.amount > availableAmount + 0.01) {
          throw new Error(`${usage.line.item_name} (${usage.line.cost_centre_name || "branch"}): split allocation exceeds available budget by ₹${(usage.amount - availableAmount).toFixed(2)}`);
        }
        if (usage.quantity > availableQuantity + 0.0001) {
          throw new Error(`${usage.line.item_name} (${usage.line.cost_centre_name || "branch"}): split allocation exceeds available quantity by ${roundQuantity(usage.quantity - availableQuantity)}`);
        }
      }

      await connection.execute("DELETE FROM grn_cost_allocation WHERE grn_request_id = ?", [grnId]);
      await connection.execute("DELETE FROM grn_invoice_component WHERE grn_request_id = ?", [grnId]);

      const componentIds: string[] = [];
      for (let index = 0; index < components.length; index += 1) {
        const component = components[index];
        const amounts = componentAmounts[index];
        const id = randomUUID();
        componentIds.push(id);
        await connection.execute(
          `INSERT INTO grn_invoice_component
           (id, grn_request_id, sequence_no, amount_without_tax, gst_rate,
            hsn_sac_code, tax_amount, amount_with_tax, remarks, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            id, grnId, index + 1, amounts.baseAmount, Number(component.gstRate),
            component.hsnSacCode?.trim() || null,
            amounts.taxAmount, amounts.grossAmount, component.remarks?.trim() || null, actorUserId,
          ]
        );
      }

      let sequenceNo = 0;
      for (const cell of grid) {
        sequenceNo += 1;
        const percentage = declaredTotal > 0
          ? Math.round((cell.amounts.grossAmount / declaredTotal) * 100 * 1_000_000) / 1_000_000
          : 0;
        await connection.execute(
          `INSERT INTO grn_cost_allocation
           (id, grn_request_id, sequence_no, budget_id, budget_line_id, invoice_component_id,
            branch_id, process_id, cost_centre_id, cost_class, allocation_percentage,
            quantity, unit, unit_rate, tax_treatment, gst_rate, gst_type,
            recoverable_tax_pct, amount_without_tax, tax_amount, cgst_amount,
            sgst_amount, igst_amount, amount_with_tax, recoverable_tax_amount,
            pnl_cost_amount, lifecycle_status, remarks, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            randomUUID(), grnId, sequenceNo, cell.line.budget_id, cell.line.id,
            componentIds[cell.componentIndex], grn.branch_id, cell.line.process_id ?? null,
            cell.line.cost_centre_id ?? null,
            cell.line.process_id || cell.line.cost_centre_id ? "direct" : "indirect",
            percentage, cell.quantity, cell.line.unit, cell.unitRate,
            "exclusive", cell.component.gstRate, cell.line.gst_type,
            cell.line.recoverable_tax_pct, cell.amounts.baseAmount,
            cell.amounts.taxAmount, cell.amounts.cgstAmount, cell.amounts.sgstAmount,
            cell.amounts.igstAmount, cell.amounts.grossAmount,
            cell.amounts.recoverableTaxAmount, cell.amounts.pnlCostAmount,
            "draft", cell.remarks, actorUserId,
          ]
        );
      }

      // Same defensive rounding correction saveAllocations() already applies: force the
      // percentage total to exactly 100.000000 after per-cell decimal rounding.
      const [percentageRows] = await connection.execute<RowDataPacket[]>(
        "SELECT id, allocation_percentage FROM grn_cost_allocation WHERE grn_request_id = ? ORDER BY sequence_no",
        [grnId]
      );
      const percentageTotal = percentageRows.reduce((sum, row) => sum + Number(row.allocation_percentage), 0);
      if (percentageRows.length && Math.abs(percentageTotal - 100) > 0.000001) {
        const last = percentageRows[percentageRows.length - 1];
        await connection.execute(
          "UPDATE grn_cost_allocation SET allocation_percentage = allocation_percentage + ? WHERE id = ?",
          [Math.round((100 - percentageTotal) * 1_000_000) / 1_000_000, last.id]
        );
      }

      const totalGrossFinal = roundMoney(grid.reduce((sum, cell) => sum + cell.amounts.grossAmount, 0));
      const totalPnlFinal = roundMoney(grid.reduce((sum, cell) => sum + cell.amounts.pnlCostAmount, 0));
      const totalQuantity = roundQuantity(grid.reduce((sum, cell) => sum + cell.quantity, 0));
      const first = resolvedSplits[0].line;
      const distinctProcesses = new Set(resolvedSplits.map((item) => item.line.process_id).filter(Boolean));
      const distinctCostCentres = new Set(resolvedSplits.map((item) => item.line.cost_centre_id).filter(Boolean));
      const units = new Set(resolvedSplits.map((item) => String(item.line.unit)));
      const gstTypes = new Set(resolvedSplits.map((item) => String(item.line.gst_type)));
      const weightedGstRate = rawTotalBase > 0 ? roundMoney((rawTotalTax / rawTotalBase) * 100) : 0;
      const totalRecoverable = roundMoney(grid.reduce((sum, cell) => sum + cell.amounts.recoverableTaxAmount, 0));
      const weightedRecoverablePct = rawTotalTax > 0 ? roundMoney((totalRecoverable / rawTotalTax) * 100) : 0;

      await connection.execute(
        `UPDATE grn_request
            SET allocation_mode = ?, budget_id = ?, budget_line_id = ?,
                process_id = ?, cost_centre_id = ?, cost_class = ?,
                head = ?, sub_head = ?, description = ?, quantity = ?, unit = ?,
                unit_rate = ?, tax_treatment = ?, gst_rate = ?, gst_type = ?,
                recoverable_tax_pct = ?, amount_without_tax = ?, tax_amount = ?,
                amount_with_tax = ?, pnl_cost_amount = ?, amount = ?,
                other_charges = 0.00, round_off_amount = ?,
                invoice_number = ?, service_period_start = ?, service_period_end = ?,
                purchase_reference = ?, vendor_gstin = ?, place_of_supply = ?,
                irn = ?, irn_ack_no = ?,
                accounting_period = COALESCE(?, accounting_period)
          WHERE id = ?`,
        [
          grid.length > 1 ? "split" : "single", first.budget_id, first.id,
          distinctProcesses.size === 1 ? [...distinctProcesses][0] : null,
          distinctCostCentres.size === 1 ? [...distinctCostCentres][0] : null,
          resolvedSplits.some((item) => item.line.process_id || item.line.cost_centre_id) ? "direct" : "indirect",
          String(first.head), first.sub_head ?? null,
          `${components.length} invoice component(s) across ${resolvedSplits.length} cost centre(s)`,
          totalQuantity, units.size === 1 ? [...units][0] : "Mixed",
          totalQuantity > 0 ? roundMoney(rawTotalBase / totalQuantity) : 0,
          "exclusive", weightedGstRate, gstTypes.size === 1 ? [...gstTypes][0] : "none",
          weightedRecoverablePct, rawTotalBase, rawTotalTax,
          totalGrossFinal, totalPnlFinal, totalGrossFinal,
          diff,
          normalizeInvoiceNumber(input.invoiceNumber) || null,
          dateOrNull(input.servicePeriodStart), dateOrNull(input.servicePeriodEnd),
          String(input.purchaseReference ?? "").trim() || null,
          String(input.vendorGstin ?? "").trim().toUpperCase() || null,
          String(input.placeOfSupply ?? "").trim() || null,
          String(input.irn ?? "").trim() || null,
          String(input.irnAckNo ?? "").trim() || null,
          /^\d{4}-(0[1-9]|1[0-2])$/.test(String(input.accountingPeriod ?? "").trim())
            ? String(input.accountingPeriod).trim()
            : null,
          grnId,
        ]
      );

      // Recognition schedule last: it reads back the allocation rows just written, and being
      // inside this transaction means a split that does not reconcile rolls the invoice back.
      const periodSplit = await writePeriodSplits(connection, grnId, grn, input, actorUserId, actorRole);

      await connection.commit();
      await writeAudit("INVOICE_COMPONENTS_SAVED", grnId, actorUserId, actorRole, {
        recognition_months: periodSplit?.eligibleCount ?? 1,
        component_count: components.length,
        cost_centre_count: resolvedSplits.length,
        amount_without_tax: rawTotalBase,
        tax_amount: rawTotalTax,
        amount_with_tax: totalGrossFinal,
        round_off_amount: diff,
      });
      return this.getWorkspace(grnId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async registerDocuments(grnId: string, files: RegisteredDocumentInput[], actorUserId: string) {
    if (!files.length) throw new Error("At least one document is required");
    const connection = await db.getConnection();
    const inserted: any[] = [];
    try {
      await connection.beginTransaction();
      const grn = await lockGrn(connection, grnId);
      if (String(grn.status) !== "draft") throw new Error("Documents can only be added to draft GRNs");
      const [countRows] = await connection.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM grn_document WHERE grn_request_id = ?",
        [grnId]
      );
      let existingCount = Number(countRows[0]?.total ?? 0);
      for (const file of files) {
        const buffer = await fs.readFile(file.storedPath);
        const hash = createHash("sha256").update(buffer).digest("hex");
        const id = randomUUID();
        const isPrimary = file.isPrimary === true || existingCount === 0;
        if (isPrimary) {
          await connection.execute("UPDATE grn_document SET is_primary = 0 WHERE grn_request_id = ?", [grnId]);
        }
        await connection.execute(
          `INSERT INTO grn_document
           (id, grn_request_id, document_type, original_name, stored_path,
            mime_type, file_size_bytes, sha256, is_primary, extraction_status, uploaded_by)
           VALUES (?,?,?,?,?,?,?,?,?,'pending',?)`,
          [
            id, grnId, file.documentType ?? "invoice", file.originalName,
            file.storedPath, file.mimeType, file.fileSizeBytes, hash,
            isPrimary ? 1 : 0, actorUserId,
          ]
        );
        if (isPrimary) {
          await connection.execute(
            `UPDATE grn_request
                SET attachment_path = ?, attachment_original_name = ?, attachment_mime = ?,
                    attachment_file_path = ?, attachment_file_name = ?, attachment_file_mime = ?
              WHERE id = ?`,
            [file.storedPath, file.originalName, file.mimeType, file.storedPath, file.originalName, file.mimeType, grnId]
          );
        }
        inserted.push({ id, sha256: hash, isPrimary, ...file });
        existingCount += 1;
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await writeAudit("DOCUMENTS_UPLOADED", grnId, actorUserId, "document_uploader", {
      documents: inserted.map((item) => ({ id: item.id, name: item.originalName, sha256: item.sha256 })),
    });
    return inserted;
  },

  async analyzeDocument(grnId: string, documentId: string, actorUserId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM grn_document WHERE id = ? AND grn_request_id = ? LIMIT 1",
      [documentId, grnId]
    );
    const document = rows[0] as any;
    if (!document) throw new Error("GRN document not found");
    await db.execute("UPDATE grn_document SET extraction_status = 'processing' WHERE id = ?", [documentId]);

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
    const modelName = process.env.GRN_DOCUMENT_AI_MODEL || "gemini-1.5-flash";
    if (!apiKey) {
      const extractionId = randomUUID();
      await db.execute(
        `INSERT INTO grn_document_extraction
         (id, document_id, grn_request_id, provider, model_name, status,
          confidence_score, error_message)
         VALUES (?,?,?,?,?,'manual_review',0,?)`,
        [extractionId, documentId, grnId, "unconfigured", null, "Configure GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY for automated extraction"]
      );
      await db.execute("UPDATE grn_document SET extraction_status = 'manual_review' WHERE id = ?", [documentId]);
      return { id: extractionId, status: "manual_review", provider: "unconfigured" };
    }

    try {
      const fileBuffer = await fs.readFile(String(document.stored_path));
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      const prompt = `Extract invoice information and return ONLY valid JSON using this schema:\n{
  "vendorName": string|null,
  "vendorGstin": string|null,
  "invoiceNumber": string|null,
  "invoiceDate": "YYYY-MM-DD"|null,
  "servicePeriodStart": "YYYY-MM-DD"|null,
  "servicePeriodEnd": "YYYY-MM-DD"|null,
  "purchaseReference": string|null,
  "placeOfSupply": string|null,
  "baseAmount": number|null,
  "cgstAmount": number|null,
  "sgstAmount": number|null,
  "igstAmount": number|null,
  "taxAmount": number|null,
  "otherCharges": number|null,
  "roundOffAmount": number|null,
  "grossAmount": number|null,
  "paymentTermsDays": number|null,
  "lineItems": [{"description":string,"quantity":number|null,"unit":string|null,"unitRate":number|null,"amount":number|null}],
  "confidence": number
}\nUse null when uncertain. Confidence must be 0 to 100. Do not include markdown.`;
      const response = await model.generateContent([
        prompt,
        { inlineData: { data: fileBuffer.toString("base64"), mimeType: String(document.mime_type) } },
      ]);
      const rawText = response.response.text();
      const fields = parseModelJson(rawText);
      const confidence = Math.max(0, Math.min(100, Number(fields.confidence ?? 0)));
      const extractionId = randomUUID();
      await db.execute(
        `INSERT INTO grn_document_extraction
         (id, document_id, grn_request_id, provider, model_name, status,
          confidence_score, raw_text, extracted_fields_json, raw_response_json)
         VALUES (?,?,?,?,?,'completed',?,?,?,?)`,
        [
          extractionId, documentId, grnId, "google_gemini", modelName,
          confidence, rawText, safeJson(fields), safeJson({ text: rawText }),
        ]
      );
      await db.execute("UPDATE grn_document SET extraction_status = 'completed' WHERE id = ?", [documentId]);
      await writeAudit("DOCUMENT_ANALYZED", grnId, actorUserId, "document_ai", {
        document_id: documentId, provider: "google_gemini", model: modelName, confidence,
      });
      await this.revalidate(grnId);
      return { id: extractionId, status: "completed", confidence, fields };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const extractionId = randomUUID();
      await db.execute(
        `INSERT INTO grn_document_extraction
         (id, document_id, grn_request_id, provider, model_name, status, error_message)
         VALUES (?,?,?,?,?,'failed',?)`,
        [extractionId, documentId, grnId, "google_gemini", modelName, message]
      );
      await db.execute("UPDATE grn_document SET extraction_status = 'failed' WHERE id = ?", [documentId]);
      throw new Error(`Document analysis failed: ${message}`);
    }
  },

  async confirmExtraction(
    grnId: string,
    fields: Record<string, unknown>,
    actorUserId: string,
    actorRole: string
  ) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const grn = await lockGrn(connection, grnId);
      if (String(grn.status) !== "draft") throw new Error("Extraction can only be confirmed on a draft GRN");
      await connection.execute(
        `UPDATE grn_request
            SET invoice_number = COALESCE(?, invoice_number),
                bill_date = COALESCE(?, bill_date),
                service_period_start = COALESCE(?, service_period_start),
                service_period_end = COALESCE(?, service_period_end),
                purchase_reference = COALESCE(?, purchase_reference),
                vendor_gstin = COALESCE(?, vendor_gstin),
                place_of_supply = COALESCE(?, place_of_supply),
                other_charges = COALESCE(?, other_charges),
                round_off_amount = COALESCE(?, round_off_amount)
          WHERE id = ?`,
        [
          normalizeInvoiceNumber(fields.invoiceNumber) || null,
          dateOrNull(fields.invoiceDate),
          dateOrNull(fields.servicePeriodStart),
          dateOrNull(fields.servicePeriodEnd),
          String(fields.purchaseReference ?? "").trim() || null,
          String(fields.vendorGstin ?? "").trim().toUpperCase() || null,
          String(fields.placeOfSupply ?? "").trim() || null,
          fields.otherCharges == null ? null : roundMoney(Number(fields.otherCharges)),
          fields.roundOffAmount == null ? null : roundMoney(Number(fields.roundOffAmount)),
          grnId,
        ]
      );
      await connection.execute(
        `UPDATE grn_document_extraction
            SET confirmed_by = ?, confirmed_at = NOW()
          WHERE grn_request_id = ? AND confirmed_at IS NULL`,
        [actorUserId, grnId]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await writeAudit("EXTRACTION_CONFIRMED", grnId, actorUserId, actorRole, fields);
    return this.revalidate(grnId);
  },

  async revalidate(grnId: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const result = await buildValidations(connection, grnId);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async submit(grnId: string, actorUserId: string, actorRole: string, remarks?: string) {
    const validation = await this.revalidate(grnId);
    const blocking = validation.results.filter((item) => item.blocking && item.status === "failed");
    if (blocking.length) {
      throw new Error(`Resolve blocking validations before submission: ${blocking.map((item) => item.message).join("; ")}`);
    }
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE grn_request
          SET status = 'submitted', submitted_by = ?, submitted_at = NOW(),
              remarks = COALESCE(?, remarks)
        WHERE id = ? AND status = 'draft'`,
      [actorUserId, remarks?.trim() || null, grnId]
    );
    if (result.affectedRows !== 1) throw new Error("GRN status changed before submission; refresh and try again");
    await writeAudit("SUBMIT", grnId, actorUserId, actorRole, {
      validation_score: validation.score,
      allocation_mode: "smart",
      remarks,
    });
    return { success: true, newStatus: "submitted", validation };
  },

  async review(
    grnId: string,
    decision: "approved" | "rejected",
    reviewNote: string | undefined,
    actorUserId: string,
    actorRole: string
  ) {
    if (decision === "rejected" && !reviewNote?.trim()) {
      throw new Error("Review remarks are mandatory when rejecting a GRN");
    }
    const connection = await db.getConnection();
    let paymentId: string | null = null;
    let imprestLedgerEntryId: string | null = null;
    let newStatus = "";
    try {
      await connection.beginTransaction();
      const grn = await lockGrn(connection, grnId);
      const allocations = await loadAllocations(connection, grnId, true);
      if (!allocations.length) throw new Error("Smart GRN has no saved cost allocations");
      const role = actorRole.toLowerCase();

      // P0-2: Provision GRNs have no payment/ledger/reversal lifecycle — block approval.
      if (String(grn.grn_type) === "provision") {
        throw Object.assign(
          new Error("PROVISION_GRN_NOT_SUPPORTED: Provision GRN approval is not yet implemented. Contact Finance Admin."),
          { code: "PROVISION_GRN_NOT_SUPPORTED" }
        );
      }

      // P0-3: Re-check period lock inside the transaction immediately before the financial
      // mutation so a concurrent lock cannot slip through between API check and this UPDATE.
      const grnPeriod = String(grn.accounting_period ?? grn.bill_date ?? "").substring(0, 7);
      if (grnPeriod && await isPeriodLocked(grnPeriod, connection)) {
        throw new Error(
          `${grnPeriod} was locked for P&L close before this approval completed. `
          + "Resubmit the GRN against the current open period."
        );
      }

      // P0P1-4: Enforce actor-identity maker-checker — role names alone are insufficient.
      // Applies to approvals; rejections do not create financial commitments.
      if (decision === "approved") {
        if (role === "branch_head" && grn.submitted_by && String(grn.submitted_by) === actorUserId) {
          throw new Error(
            "Maker-checker violation: the same person cannot submit and Branch Head-approve the same GRN"
          );
        }
        if (role === "finance_head") {
          if (grn.submitted_by && String(grn.submitted_by) === actorUserId) {
            throw new Error(
              "Maker-checker violation: Finance Head cannot be the person who submitted this GRN"
            );
          }
          if (grn.branch_head_reviewed_by && String(grn.branch_head_reviewed_by) === actorUserId) {
            throw new Error(
              "Maker-checker violation: Finance Head cannot be the person who performed the Branch Head review"
            );
          }
        }
      }

      if (role === "branch_head") {
        if (String(grn.status) !== "submitted") {
          throw new Error(`Branch Head can only review submitted GRNs. Current status: ${grn.status}`);
        }
        if (decision === "approved") {
          await reserveAllocations(connection, allocations);
          newStatus = "branch_head_approved";
        } else {
          newStatus = "rejected";
        }
        // P1-5: Include expected status in WHERE so a concurrent state change yields
        // affectedRows === 0 and is caught as a 409, not silently swallowed.
        const [bhUpdateResult] = await connection.execute<ResultSetHeader>(
          `UPDATE grn_request
              SET status = ?, branch_head_reviewed_by = ?, branch_head_reviewed_at = NOW(),
                  branch_head_review_note = ?, reviewed_by = ?, reviewed_at = NOW(),
                  review_note = ?, rejection_reason = ?
            WHERE id = ? AND status = 'submitted'`,
          [
            newStatus, actorUserId, reviewNote?.trim() || null, actorUserId,
            reviewNote?.trim() || null, decision === "rejected" ? reviewNote?.trim() : null, grnId,
          ]
        );
        if (bhUpdateResult.affectedRows !== 1) {
          throw Object.assign(
            new Error("GRN state changed concurrently; refresh and try again"),
            { code: "STATE_CHANGED", statusCode: 409 }
          );
        }
      } else if (role === "finance_head") {
        if (String(grn.status) !== "branch_head_approved") {
          throw new Error(`Finance Head can only review Branch Head-approved GRNs. Current status: ${grn.status}`);
        }
        if (decision === "approved") {
          await consumeAllocations(connection, allocations);
          newStatus = grn.grn_type === "vendor" ? "pending_accounts_payment" : "approved";
          // P1-5: Expected status in WHERE for atomic guard.
          const [fhUpdateResult] = await connection.execute<ResultSetHeader>(
            `UPDATE grn_request
                SET status = ?, accounts_payment_status = ?, finance_head_reviewed_by = ?,
                    finance_head_reviewed_at = NOW(), finance_head_review_note = ?,
                    reviewed_by = ?, reviewed_at = NOW(), review_note = ?, approved_by = ?,
                    approved_at = NOW(), rejection_reason = NULL
              WHERE id = ? AND status = 'branch_head_approved'`,
            [
              newStatus, grn.grn_type === "vendor" ? "pending" : "not_required",
              actorUserId, reviewNote?.trim() || null, actorUserId,
              reviewNote?.trim() || null, actorUserId, grnId,
            ]
          );
          if (fhUpdateResult.affectedRows !== 1) {
            throw Object.assign(
              new Error("GRN state changed concurrently; refresh and try again"),
              { code: "STATE_CHANGED", statusCode: 409 }
            );
          }
          if (grn.grn_type === "vendor") {
            paymentId = await vendorPaymentService.createFromGrn(grnId, actorUserId, connection);
          } else if (grn.grn_type === "imprest") {
            imprestLedgerEntryId = await postImprestVoucherDebit(connection, grnId, grn, actorUserId);
            if (imprestLedgerEntryId) {
              // Links the voucher to the exact ledger row it produced. Migration 1094 created
              // this column for it; leaving it NULL made the ledger posting untraceable from
              // the GRN, so "which entry did this voucher create" had no answer but a guess by
              // amount and date. Written in the same transaction as the posting itself.
              await connection.execute(
                `UPDATE grn_request SET imprest_ledger_entry_id = ? WHERE id = ?`,
                [imprestLedgerEntryId, grnId],
              );
            }
          }
        } else {
          await releaseAllocations(connection, allocations);
          newStatus = "rejected";
          await connection.execute(
            `UPDATE grn_request
                SET status = 'rejected', finance_head_reviewed_by = ?,
                    finance_head_reviewed_at = NOW(), finance_head_review_note = ?,
                    reviewed_by = ?, reviewed_at = NOW(), review_note = ?, rejection_reason = ?
              WHERE id = ?`,
            [actorUserId, reviewNote?.trim(), actorUserId, reviewNote?.trim(), reviewNote?.trim(), grnId]
          );
        }
      } else {
        throw new Error(`Role ${actorRole} is not permitted to review smart GRNs`);
      }

      // The same omission as the legacy path in grn.service.ts, and the same fix. An
      // allocation-aware GRN is reviewed here instead of there, so without this an approval or
      // rejection of a smart GRN also left GET /grns/:id/approval-history empty. Recorded on
      // the review connection so the event and the transition share one commit. `role` is the
      // stage that was cleared, which is what a reader of the history is asking about.
      await recordFinanceApprovalEvent(
        {
          entityType: "grn",
          entityId: grnId,
          action: decision === "approved" ? "approve" : "reject",
          fromStatus: String(grn.status),
          toStatus: newStatus,
          decision,
          actorUserId,
          actorRole: role,
          remarks: reviewNote?.trim() || null,
          details: { allocationCount: allocations.length },
        },
        connection
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await writeAudit(decision.toUpperCase(), grnId, actorUserId, actorRole, {
      review_note: reviewNote,
      new_status: newStatus,
      payment_id: paymentId,
      allocation_aware: true,
    });
    if (paymentId) await vendorPaymentService.notifyPaymentPending(paymentId).catch(() => undefined);
    return { success: true, newStatus, paymentId };
  },

  async cancel(grnId: string, actorUserId: string, actorRole: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const grn = await lockGrn(connection, grnId);
      if (["pending_accounts_payment", "payment_scheduled", "partially_paid", "paid", "approved", "cancelled"].includes(String(grn.status))) {
        throw new Error(`Cannot cancel a GRN with status '${grn.status}'`);
      }
      const allocations = await loadAllocations(connection, grnId, true);
      if (String(grn.status) === "branch_head_approved") {
        await releaseAllocations(connection, allocations);
      }
      const [result] = await connection.execute<ResultSetHeader>(
        "UPDATE grn_request SET status = 'cancelled', reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = ?",
        [actorUserId, grnId, grn.status]
      );
      if (result.affectedRows !== 1) throw new Error("GRN status changed before cancellation; refresh and try again");
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await writeAudit("CANCEL", grnId, actorUserId, actorRole, { allocation_aware: true });
    return { success: true };
  },

  async reopen(grnId: string, actorUserId: string, actorRole: string, actorRoles: string[] = []) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const grn = await lockGrn(connection, grnId);
      if (String(grn.status) !== "rejected") {
        throw new Error(`Only rejected GRNs can be reopened. Current status: ${grn.status}`);
      }
      // Ownership check: only the original creator OR finance leadership can reopen.
      // Check the full roles array — primary role alone misses multi-role users (e.g. admin+finance_head).
      const allRoles = new Set([actorRole, ...actorRoles]);
      const isFinanceLeader = ["finance_head", "accounts_head", "super_admin", "admin"].some(r => allRoles.has(r));
      if (!isFinanceLeader && String(grn.created_by) !== actorUserId) {
        throw new Error("Only the GRN creator or Finance Head can reopen this GRN.");
      }
      // Finance-head rejections call releaseAllocations(), setting lifecycle_status = 'released'.
      // Restore them to 'draft' so the next save can proceed normally.
      await connection.execute(
        `UPDATE grn_cost_allocation SET lifecycle_status = 'draft', updated_at = NOW()
           WHERE grn_request_id = ? AND lifecycle_status = 'released'`,
        [grnId]
      );
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE grn_request
            SET status = 'draft',
                rejection_reason = NULL,
                branch_head_reviewed_by = NULL, branch_head_reviewed_at = NULL,
                branch_head_review_note = NULL,
                finance_head_reviewed_by = NULL, finance_head_reviewed_at = NULL,
                finance_head_review_note = NULL,
                reviewed_by = NULL, reviewed_at = NULL,
                review_note = NULL,
                submitted_at = NULL, submitted_by = NULL
          WHERE id = ? AND status = 'rejected'`,
        [grnId]
      );
      if (result.affectedRows !== 1) {
        throw new Error("GRN status changed before reopen; refresh and try again");
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await writeAudit("REOPEN", grnId, actorUserId, actorRole, { previous_status: "rejected" });
    return { success: true, newStatus: "draft" as const };
  },

  async getWorkspace(grnId: string) {
    const [grnRows] = await db.execute<RowDataPacket[]>(
      `SELECT g.*, bm.branch_name, pm.process_name, ccm.cost_centre_name, h.budget_number
         FROM grn_request g
         LEFT JOIN branch_master bm ON bm.id = g.branch_id
         LEFT JOIN process_master pm ON pm.id = g.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
         LEFT JOIN finance_budget_header h ON h.id = g.budget_id
        WHERE g.id = ? LIMIT 1`,
      [grnId]
    );
    if (!grnRows[0]) throw new Error("GRN not found");
    const connection = await db.getConnection();
    try {
      const allocations = await loadAllocations(connection, grnId);
      const invoiceComponents = await loadInvoiceComponents(connection, grnId);
      const [documents] = await connection.execute<RowDataPacket[]>(
        "SELECT * FROM grn_document WHERE grn_request_id = ? ORDER BY is_primary DESC, uploaded_at",
        [grnId]
      );
      const [extractions] = await connection.execute<RowDataPacket[]>(
        "SELECT * FROM grn_document_extraction WHERE grn_request_id = ? ORDER BY created_at DESC",
        [grnId]
      );
      const [validations] = await connection.execute<RowDataPacket[]>(
        "SELECT * FROM grn_validation_result WHERE grn_request_id = ? ORDER BY is_blocking DESC, created_at",
        [grnId]
      );
      const [duplicates] = await connection.execute<RowDataPacket[]>(
        `SELECT d.*, g.grn_number AS matched_grn_number
           FROM grn_duplicate_match d
           LEFT JOIN grn_request g ON g.id = d.matched_grn_request_id
          WHERE d.grn_request_id = ? ORDER BY d.confidence_score DESC`,
        [grnId]
      );
      // Read on the same connection, so a workspace fetched mid-save cannot show allocations
      // from before the split and period rows from after it.
      const [periodAllocations] = await connection.execute<RowDataPacket[]>(
        `SELECT p.id, p.cost_allocation_id, p.sequence_no, p.period_code,
                p.recognition_amount, p.pnl_bucket, p.split_method,
                a.cost_centre_id, a.process_id, a.pnl_cost_amount AS allocation_amount
           FROM grn_period_allocation p
           JOIN grn_cost_allocation a ON a.id = p.cost_allocation_id
          WHERE p.grn_request_id = ?
          ORDER BY a.sequence_no, p.sequence_no`,
        [grnId]
      );
      return {
        grn: grnRows[0],
        allocations,
        invoiceComponents,
        documents,
        extractions,
        validations,
        duplicates,
        periodAllocations,
      };
    } finally {
      connection.release();
    }
  },
};

/**
 * The month a GRN consumes budget in.
 *
 * Was `bill_date` alone, which made multi-month impossible: an annual policy dated 25-Mar-2026
 * recognising from Apr-2026 was rejected outright because its bill month did not equal the
 * budget line's period. bill_date is vendor-controlled; the accounting month is ours.
 *
 * Order is deliberate — accounting_period (what Finance booked it to), then
 * recognition_start_period (where recognition begins), then bill_date. Every one of those is
 * NULL on historical rows, so this returns exactly bill_date for them and behaviour is
 * unchanged for every GRN raised before multi-month existed.
 */
function consumptionPeriodOf(grn: {
  accounting_period?: unknown;
  recognition_start_period?: unknown;
  bill_date?: unknown;
}): string {
  const accounting = String(grn.accounting_period ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(accounting)) return accounting;
  const recognition = String(grn.recognition_start_period ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(recognition)) return recognition;
  return String(grn.bill_date ?? "").slice(0, 7);
}

/**
 * Writes the multi-month recognition schedule for every cost allocation of a GRN.
 *
 * Runs after the allocation rows exist and inside the same transaction, so a split that fails
 * to reconcile takes the whole invoice save down with it rather than leaving a GRN whose
 * recognition does not sum to its cost.
 *
 * Each allocation is split independently against its OWN pnl_cost_amount: a 3-cost-centre
 * invoice over 12 months is 36 rows, and each cost centre's twelve rows sum to that centre's
 * share. Splitting the invoice total once and apportioning afterwards would round twice.
 *
 * With no recognition window the function clears any previous schedule and returns null — the
 * GRN is single-month, exactly as before multi-month existed.
 */
/**
 * Who may decide which months an invoice is recognised in.
 *
 * Both of the overrides below were documented as Finance Head / Accounts Head /
 * Super Admin and enforced nowhere on the server. canCustomSplit exists only as a
 * prop on MonthSplitPanel, so the chip was hidden in the UI and the field was
 * accepted from the payload regardless: PUT /:id/allocations admits
 * SMART_WRITE_ROLES, which also includes admin, branch_head and branch_admin, and
 * recognitionCustomPercentages went straight through to saveSplit unchecked.
 *
 * Both decide which financial period bears a cost, so both are gated here rather
 * than in the UI:
 *
 *   custom percentages - naming the exact share each month carries.
 *   a cross-FY window - moving cost into a financial year the GRN does not belong
 *   to. Allowed since the ruling of 2026-08-12, which replaced a hard clamp with a
 *   warning; this keeps it allowed, but only for the roles that own the call.
 */
const RECOGNITION_OVERRIDE_ROLES = new Set(["finance_head", "accounts_head", "super_admin"]);

export function assertMayOverrideRecognition(actorRole: string, what: string): void {
  if (RECOGNITION_OVERRIDE_ROLES.has(String(actorRole))) return;
  throw Object.assign(
    new Error(
      `${what} requires Finance Head, Accounts Head or Super Admin.`,
    ),
    { statusCode: 403, code: "RECOGNITION_OVERRIDE_FORBIDDEN" },
  );
}

async function writePeriodSplits(
  connection: PoolConnection,
  grnId: string,
  grn: { accounting_period?: unknown; recognition_start_period?: unknown; bill_date?: unknown },
  input: {
    recognitionStartPeriod?: string | null;
    recognitionEndPeriod?: string | null;
    recognitionCustomPercentages?: Record<string, number> | null;
  },
  actorUserId: string,
  actorRole: string,
) {
  const start = String(input.recognitionStartPeriod ?? "").trim();
  const end = String(input.recognitionEndPeriod ?? "").trim();
  if (!start && !end) {
    // Re-saving a previously multi-month invoice as single-month must not leave the old
    // schedule behind, or the P&L keeps recognising months the GRN no longer claims.
    await connection.execute("DELETE FROM grn_period_allocation WHERE grn_request_id = ?", [grnId]);
    await connection.execute(
      `UPDATE grn_request
          SET recognition_start_period = NULL, recognition_end_period = NULL,
              period_allocation_mode = 'single', is_multi_month = 0
        WHERE id = ?`,
      [grnId],
    );
    return null;
  }
  if (!start || !end) {
    throw new Error("A multi-month invoice needs both a first and a last recognition month");
  }

  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT id, pnl_cost_amount FROM grn_cost_allocation WHERE grn_request_id = ? ORDER BY sequence_no",
    [grnId],
  );
  const accountingPeriod = consumptionPeriodOf(grn);
  const customPercentages = input.recognitionCustomPercentages ?? null;

  if (customPercentages && Object.keys(customPercentages).length > 0) {
    assertMayOverrideRecognition(actorRole, "A custom recognition split");
  }

  // resolveEligiblePeriods is pure, so the window can be judged before anything is
  // written rather than rolling the transaction back afterwards.
  if (resolveEligiblePeriods({ accountingPeriod, startPeriod: start, endPeriod: end }).crossFy) {
    assertMayOverrideRecognition(
      actorRole,
      "Recognising an invoice across financial years",
    );
  }
  let summary: Awaited<ReturnType<typeof grnPeriodAllocationService.saveSplit>> | null = null;
  for (const row of rows as RowDataPacket[]) {
    summary = await grnPeriodAllocationService.saveSplit(
      {
        costAllocationId: String(row.id),
        grnRequestId: grnId,
        recognitionAmount: Number(row.pnl_cost_amount ?? 0),
        accountingPeriod,
        startPeriod: start,
        endPeriod: end,
        customPercentages,
        actorUserId,
      },
      connection,
    );
  }
  return summary;
}

/**
 * Debits the branch float when an imprest voucher is approved.
 *
 * THIS WAS MISSING ENTIRELY. The ledger service, its tests and the Imprest Details report all
 * existed, and allocations posted their credits — but nothing ever posted the voucher DEBIT, so
 * a float could only ever go up. The report would have shown inflows and no outflows, the exact
 * inverse of the reference workbook, and the "float in hand" on the allocation form would have
 * been overstated by everything ever spent.
 *
 * Posted inside the approval transaction, so a voucher that fails to approve never moves money,
 * and a debit that fails takes the approval down with it.
 *
 * A MISSING MANAGER DOES NOT BLOCK APPROVAL. imprest_manager is a new master and is EMPTY in
 * production, so throwing here would stop every imprest approval the moment this deploys. The
 * debit is skipped and the skip is AUDITED with its reason — visible rather than silent, which
 * is the whole failure mode this function exists to close.
 */
async function postImprestVoucherDebit(
  connection: PoolConnection,
  grnId: string,
  grn: RowDataPacket,
  actorUserId: string,
): Promise<string | null> {
  const branchId = String(grn.branch_id ?? "");
  const amount = Number(grn.amount_with_tax ?? grn.amount ?? 0);
  if (!(amount > 0)) return null;

  // The manager named on the GRN wins; otherwise the branch's live appointment. Effective dating
  // matters — a manager whose term ended must not be debited for today's spend.
  let managerId = String(grn.imprest_manager_id ?? "").trim();
  if (!managerId) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM imprest_manager
        WHERE branch_id = ? AND active_status = 1
          AND (effective_from IS NULL OR effective_from <= CURDATE())
          AND (effective_to IS NULL OR effective_to >= CURDATE())
        ORDER BY effective_from DESC LIMIT 1`,
      [branchId],
    );
    managerId = String(rows[0]?.id ?? "");
  }

  if (!managerId) {
    await writeAudit("IMPREST_LEDGER_SKIPPED", grnId, actorUserId, "finance_head", {
      reason: "No active imprest manager is appointed for this branch, so the float was not debited",
      branch_id: branchId,
      amount,
    });
    return null;
  }

  // Refuses a debit the float cannot cover. Also never called before — the guard existed and
  // nothing consulted it, so a branch could spend a float it did not have and go negative
  // silently. Checked before posting, inside the same transaction, so the approval fails
  // rather than the ledger going into deficit.
  await imprestLedgerService.assertSufficientBalance(managerId, amount, connection);

  return imprestLedgerService.post(
    {
      imprestManagerId: managerId,
      branchId,
      entryType: "voucher",
      direction: "debit",
      amount,
      transactionDate: String(grn.bill_date ?? "").slice(0, 10),
      referenceType: "grn_request",
      referenceId: grnId,
      narration: String(grn.description ?? grn.remarks ?? "Imprest voucher"),
      actorUserId,
    },
    connection,
  );
}
