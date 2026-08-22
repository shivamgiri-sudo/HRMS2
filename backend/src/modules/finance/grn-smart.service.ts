import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "../../db/mysql.js";
import { aiProviderConfigService } from "../ai/ai-provider-config.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { recordFinanceApprovalEvent } from "../../shared/financeApprovalEvent.js";
import {
  calculateBudgetLine,
  type BudgetGstType,
  type BudgetTaxTreatment,
} from "../process-pnl/branch-budget.service.js";
import { budgetConsumptionService } from "../process-pnl/budget-consumption.service.js";
import { isPeriodLocked } from "../process-pnl/finance-period-lock.js";
import {
  getHeadSubHeadCoverage,
  allocateAcrossLines,
} from "../process-pnl/budget-headroom-gate.service.js";
import { refuse } from "../process-pnl/finance-error.js";
import { vendorPaymentService } from "./vendor-payment.service.js";
import { imprestLedgerService } from "./imprest-ledger.service.js";
import {
  grnPeriodAllocationService,
  resolveEligiblePeriods,
} from "./grn-period-allocation.service.js";

export interface SmartAllocationInput {
  /** Required for a budgeted allocation. Omit for an unbudgeted row (the GRN itself must carry
   *  is_unbudgeted = 1) — costCentreId is required instead. */
  budgetLineId?: string;
  /** Unbudgeted row only: the cost centre this amount belongs to, since there is no budget line
   *  to read one off. Ignored when budgetLineId is present. */
  costCentreId?: string;
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
  /** Budget line ID — required for budgeted expenses, omit for unbudgeted */
  budgetLineId?: string;
  /** Cost centre ID — required for unbudgeted expenses (when budgetLineId is missing) */
  costCentreId?: string;
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
  /** Provided when invoice is >30 days old and the raiser is a branch-level role.
   *  Stored on grn_request after migration 1219 (is_late_invoice, late_invoice_reason). */
  lateInvoiceReason?: string | null;
  /** GST Enable toggle — explicit Yes/No on the GRN (migration 1218). */
  gstEnabled?: boolean | null;
  /** 2-digit GST state code of the vendor (e.g., "09" for UP). Auto-derived from GSTIN if present. */
  vendorStateCode?: string | null;
  /** 2-digit GST state code of the billing branch (e.g., "07" for Delhi). */
  billingStateCode?: string | null;
  /** True when no budget line exists for the selected HEAD/SUB-HEAD.
   *  Unbudgeted GRNs route through stricter approval workflow (Finance Head must approve). */
  isUnbudgeted?: boolean;
}

/** Above this, the raiser must fix the invoice components themselves — a bigger mismatch
 *  than ordinary invoice rounding is a real data-entry error, not something to auto-absorb. */
const GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT = 1.00;
/** Tolerance for the INVOICE_COMPONENT_RECONCILIATION re-check at submit time.
 *  Widened from 0.01 to 1.00 so it matches GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT above: the
 *  save path already refuses any component/declared-total gap over ₹1, so a stricter figure
 *  here only ever blocked GRNs the save path had deliberately accepted. Splitting one invoice
 *  across many cost centres rounds each cell to paise independently, so the grid sum can sit a
 *  few paise off the component total even when nothing is wrong. */
const GRN_INVOICE_COMPONENT_RECONCILIATION_TOLERANCE = 1.00;
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

/**
 * Reverses `calculateBudgetLine`'s gross-from-quoted arithmetic (branch-budget.service.ts) so a
 * draw against a specific funding line reproduces exactly `grossTarget` as that draw's own
 * `grossAmount`, given the funding line's own tax profile.
 *
 * Mirrors calculateBudgetLine's own branches: gross === quoted for "inclusive", "exempt"/
 * "non_gst", or any treatment with gstRate === 0 — only "exclusive"/"reverse_charge" with
 * gstRate > 0 adds tax on top of the quoted figure, so only that case needs dividing back out.
 */
function requiredQuotedAmount(grossTarget: number, taxTreatment: string, gstRate: number): number {
  if (["exclusive", "reverse_charge"].includes(taxTreatment) && Number(gstRate) > 0) {
    return grossTarget / (1 + Number(gstRate) / 100);
  }
  return grossTarget;
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
  /*
   * LEFT JOIN, not JOIN, on the two budget tables.
   *
   * An UNBUDGETED allocation row carries budget_line_id = NULL and budget_id = NULL by design —
   * the raiser picked a Head/Sub-head with no approved budget line, and Finance Head links a real
   * one during approval. Under the previous inner joins every such row was silently dropped from
   * this result, which is not a cosmetic omission: review() reads these rows and throws
   * "Smart GRN has no saved cost allocations" when the array is empty, so an unbudgeted GRN would
   * have been unapprovable with an error naming the wrong problem, and getWorkspace() would have
   * shown the reviewer an invoice with no splits at all.
   *
   * Nothing changes for a budgeted GRN: every one of its rows has both ids and still matches.
   * The three budget_* label columns come back NULL for an unlinked split, which is the truth —
   * callers that consume them (reserve/consume/release/reverseConsumption, and the approval gate
   * in review()) all now branch on budget_line_id being present.
   *
   * FOR UPDATE is applied to the allocation table specifically rather than to the whole
   * statement: locking those rows is the actual intent, and a NULL-supplying outer-joined side has
   * nothing to lock. The budget lines are locked separately by lockBudgetLine() wherever they are
   * about to be mutated. Verified against the live MySQL 8.0.42 that this parses and runs.
   */
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT a.*, pm.process_name, ccm.cost_centre_name, h.budget_number,
            l.head AS budget_head, l.sub_head AS budget_sub_head, l.item_name AS budget_item_name
       FROM grn_cost_allocation a
       LEFT JOIN finance_budget_line l ON l.id = a.budget_line_id
       LEFT JOIN finance_budget_header h ON h.id = a.budget_id
       LEFT JOIN process_master pm ON pm.id = a.process_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = a.cost_centre_id
      WHERE a.grn_request_id = ?
      ORDER BY a.sequence_no${forUpdate ? " FOR UPDATE OF a" : ""}`,
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

async function writeAuditInTransaction(
  connection: PoolConnection,
  action: string,
  grnId: string,
  actorUserId: string,
  actorRole: string,
  changes: Record<string, unknown>
) {
  await connection.execute(
    `INSERT INTO sensitive_action_log
       (id, actor_user_id, action_type, module_key, entity_type, entity_id,
        actor_role, change_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      actorUserId,
      `GRN_${action}`,
      "FINANCE",
      "grn_request",
      grnId,
      actorRole,
      JSON.stringify(changes),
    ]
  );
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
      status: Math.abs(componentDiff) <= GRN_INVOICE_COMPONENT_RECONCILIATION_TOLERANCE ? "passed" : "failed",
      severity: Math.abs(componentDiff) <= GRN_INVOICE_COMPONENT_RECONCILIATION_TOLERANCE ? "info" : "error",
      blocking: Math.abs(componentDiff) > GRN_INVOICE_COMPONENT_RECONCILIATION_TOLERANCE,
      message: Math.abs(componentDiff) <= GRN_INVOICE_COMPONENT_RECONCILIATION_TOLERANCE
        ? componentDiff === 0
          ? "Invoice components plus round-off exactly match the GRN total"
          : `Invoice components plus round-off match the GRN total within rounding (${componentDiff.toFixed(2)})`
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

  // HSN_SAC_REQUIRED was removed here deliberately on 2026-08-17. Do NOT re-add it without
  // reading this first — it was a warning nobody could ever clear.
  //
  //  - There was no field to satisfy it. 0f1e599d had already removed the HSN/SAC column from
  //    InvoiceComponentsEditor (mobile and desktop), so the code could not be entered at all,
  //    while this check went on reporting it missing on every GRN.
  //  - It claimed a compliance duty that is not the buyer's. On a PURCHASE, HSN/SAC reporting
  //    sits with the supplier, in their GSTR-1. Input tax credit reconciles against GSTR-2B on
  //    GSTIN + invoice number + date + taxable value + tax — every one of which this GRN already
  //    captures. Nothing downstream consumed hsn_sac_code.
  //  - There is no precedent for capturing it. db_bill ran client billing across 11,020 invoices
  //    and never recorded a supplier's HSN/SAC; neither vendor master there even has the column.
  //    Its HSN/SAC columns are all OUTWARD — MAS's own supply codes, held per cost centre.
  //
  // The obligation that IS ours is the outward one: cost_centre_master.sac_code, which feeds our
  // own GSTR-1 HSN summary. That is where the real gap was — 54 of 437 active cost centres —
  // and it is being addressed there rather than by nagging about inbound invoices.
  //
  // The hsn_sac_code column and its payload plumbing are left intact, so re-introducing capture
  // later needs a UI field and a reason, not a schema change.

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

/*
 * An UNBUDGETED split (budget_line_id NULL) has no budget line to move money against, so every
 * one of the four lifecycle helpers below skips it rather than passing the string "null" into
 * budgetConsumptionService — which would have raised or, worse, matched nothing and silently
 * reserved zero.
 *
 * Skipping is only safe because it is temporary and gated: review() refuses a Finance Head
 * approval while any split is still unlinked, so a GRN can pass Branch Head with nothing
 * reserved but can never reach payment without a real budget line behind every rupee. The
 * lifecycle_status UPDATE that follows each loop still covers the unlinked rows, so their
 * reserved/consumed/released state stays in step with the rest of the GRN.
 */
function hasBudgetLine(allocation: any) {
  return allocation.budget_line_id != null && String(allocation.budget_line_id).length > 0;
}

async function reserveAllocations(connection: PoolConnection, allocations: any[]) {
  for (const allocation of allocations) {
    if (!hasBudgetLine(allocation)) continue;
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
    if (!hasBudgetLine(allocation)) continue;
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
    if (!hasBudgetLine(allocation)) continue;
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
    if (!hasBudgetLine(allocation)) continue;
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

      // An UNBUDGETED row (raised via the same "no approved budget line" path the vendor
      // cascade already has — createUnbudgetedDraft/e2c8db0d) has no budget line to pick.
      // Resolved per allocation row now (whichever ones omit budgetLineId), not gated by the
      // GRN's own stored is_unbudgeted flag — a GRN can mix budgeted and unbudgeted cost
      // centres in one save. Pre-resolve every budgeted row's real line first, so an
      // unbudgeted row's synthetic line (below) can borrow its head/sub-head/gst_type from
      // whichever budgeted row sits alongside it, rather than the GRN header's own head/
      // sub_head columns (only ever populated at create time for a WHOLLY unbudgeted GRN).
      const resolvedLines: Array<any | null> = [];
      for (let index = 0; index < input.allocations.length; index += 1) {
        const allocation = input.allocations[index];
        if (!allocation?.budgetLineId) {
          resolvedLines.push(null);
          continue;
        }
        const line = await lockBudgetLine(connection, allocation.budgetLineId, String(grn.branch_id));
        if (consumptionPeriodOf(grn) !== String(line.period_code)) {
          throw new Error(`Allocation ${index + 1}: budget period ${line.period_code} does not match the accounting month`);
        }
        if (await isPeriodLocked(line.period_code)) {
          throw new Error(
            `Allocation ${index + 1}: ${line.period_code} is locked for P&L close. Raise this against the current open period.`
          );
        }
        resolvedLines.push(line);
      }
      const referenceLine = resolvedLines.find(Boolean) ?? null;

      // Group C, step 2a: branch-wide headroom gate (2026-08-22). Every allocation row — budgeted
      // or unbudgeted alike — is now checked against budget aggregated across every line in the
      // branch sharing that row's head+sub-head (budget-headroom-gate.service.ts), not just the
      // one line the raiser happened to pick. A row whose own line is short can spill onto a
      // sibling line (direct or pooled) automatically; a row that cannot be covered at all across
      // the whole branch aggregate is refused rather than silently accepted (the previous
      // behaviour for an unbudgeted row, which had no capacity check whatsoever) or checked only
      // against its own single line's headroom (the previous behaviour for a budgeted row).
      const period = consumptionPeriodOf(grn);
      const prepared: any[] = [];
      // Running totals of what THIS save has already drawn against each real line, keyed by
      // line id. getHeadSubHeadCoverage re-reads finance_budget_line fresh for every row, which
      // by itself would let two rows in the SAME GRN that share a head+sub-head each draw against
      // the same aggregate as if the other had not happened — a real, mainstream case (splitting
      // one invoice across cost centres under one expense category), not an edge case. These maps
      // are consulted before each row's allocateAcrossLines call and updated after every draw, so
      // the second row of such a pair sees the first row's draws already subtracted out.
      const drawnAmountByLineId = new Map<string, number>();
      const drawnQuantityByLineId = new Map<string, number>();
      for (let index = 0; index < input.allocations.length; index += 1) {
        const allocation = input.allocations[index];
        const isUnbudgetedRow = !allocation?.budgetLineId;

        let head: string;
        let subHead: string | null;
        let originalCostCentreId: string;
        let originalCostCentreName: string | null;
        let grossTarget: number;
        let preferredLineId: string | null;

        if (isUnbudgetedRow) {
          if (!allocation?.costCentreId) {
            throw new Error(`Allocation ${index + 1}: cost centre is required for an unbudgeted allocation`);
          }
          // Same branch-membership check createUnbudgetedDraft() already applied to the header's
          // own cost centre — repeated here because a raiser could still pass a different one.
          const [ccRows] = await connection.execute<RowDataPacket[]>(
            `SELECT id, cost_centre_code, cost_centre_name, branch_id
               FROM cost_centre_master
              WHERE id = ? AND active_status = 1
              LIMIT 1`,
            [allocation.costCentreId]
          );
          const cc = ccRows[0] as any;
          if (!cc) throw new Error(`Allocation ${index + 1}: cost centre not found or inactive`);
          if (String(cc.branch_id) !== String(grn.branch_id)) {
            throw new Error(`Allocation ${index + 1}: cost centre does not belong to this branch`);
          }
          const quantity = Number(allocation.quantity);
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error(`Allocation ${index + 1}: quantity must be greater than zero`);
          }
          const unitRate = allocation.unitRate == null ? 1 : Number(allocation.unitRate);
          if (!Number.isFinite(unitRate) || unitRate < 0) {
            throw new Error(`Allocation ${index + 1}: unit rate is invalid`);
          }
          // head/sub_head/gst_type borrow from referenceLine (a budgeted row in this same save,
          // if any) rather than the GRN header, which is only populated at create time for a
          // WHOLLY unbudgeted GRN and can be stale/blank for one that started out mixed. This
          // "target" synthetic line is only used to derive grossTarget (the money this row needs
          // funded) — unlike before, it is never itself the funding line.
          head = referenceLine ? String(referenceLine.head) : String(grn.head || "Unbudgeted");
          subHead = referenceLine ? String(referenceLine.sub_head || "") : String(grn.sub_head || "");
          const itemName = referenceLine ? String(referenceLine.head) : String(grn.head || "Unbudgeted Expense");
          const gstType = referenceLine ? String(referenceLine.gst_type) : "cgst_sgst";
          const targetAmounts = calculateBudgetLine({
            head,
            subHead,
            itemName,
            quantity,
            unit: "amount",
            unitRate,
            taxTreatment: "exclusive" as BudgetTaxTreatment,
            gstRate: 0,
            gstType: gstType as BudgetGstType,
            recoverableTaxPct: 100,
            justification: "Unbudgeted expense",
          });
          grossTarget = targetAmounts.grossAmount;
          originalCostCentreId = cc.id;
          originalCostCentreName = cc.cost_centre_name;
          preferredLineId = null;
        } else {
          // Already locked and period-checked in the pre-pass above.
          const line = resolvedLines[index]!;
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
          // Priced against the ORIGINALLY SELECTED line's own tax profile purely to derive the
          // money target (grossTarget) this row needs funded — which line(s) actually end up
          // funding it, and their own tax profile, is decided below by allocateAcrossLines.
          const targetAmounts = calculateBudgetLine({
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
          grossTarget = targetAmounts.grossAmount;
          head = String(line.head);
          subHead = line.sub_head;
          originalCostCentreId = line.cost_centre_id;
          originalCostCentreName = line.cost_centre_name;
          preferredLineId = String(allocation.budgetLineId);
        }

        const coverage = await getHeadSubHeadCoverage(String(grn.branch_id), period, head, subHead);
        if (!coverage.headerActive) {
          throw refuse(
            409,
            "NO_BRANCH_BUDGET",
            `No approved budget exists for this branch for ${period}. A GRN cannot be raised until one is approved.`
          );
        }
        if (!coverage.lines.length) {
          throw refuse(
            409,
            "NO_BUDGET_FOR_HEAD",
            `${head}/${subHead || ""} has no budget anywhere in this branch. Raise a budget addition request before submitting this GRN.`
          );
        }

        // Net out whatever earlier rows in this same save already drew against each of these
        // lines before handing them to the allocator — see drawnAmountByLineId's comment above.
        const netLines = coverage.lines.map((candidate) => {
          const alreadyDrawn = drawnAmountByLineId.get(String(candidate.id)) ?? 0;
          return alreadyDrawn > 0
            ? { ...candidate, available_gross_amount: Math.max(0, Number(candidate.available_gross_amount) - alreadyDrawn) }
            : candidate;
        });

        // Branch-wide money split. Can throw HEADROOM_EXCEEDED if the branch aggregate (not just
        // the one line the raiser picked) cannot cover this row — let it propagate.
        const draws = allocateAcrossLines(preferredLineId, grossTarget, netLines);
        const baseRemarks = allocation.remarks?.trim() || null;

        for (let drawIndex = 0; drawIndex < draws.length; drawIndex += 1) {
          const draw = draws[drawIndex];
          const fundingLine = coverage.lines.find((candidate) => String(candidate.id) === String(draw.lineId));
          if (!fundingLine) {
            throw new Error(`Allocation ${index + 1}: internal error resolving funding line ${draw.lineId}`);
          }

          // Reproduce exactly draw.amount as this draw's own grossAmount, from the FUNDING line's
          // own tax profile (which can differ from the originally selected line's).
          const quotedAmount = requiredQuotedAmount(
            draw.amount,
            String(fundingLine.tax_treatment),
            Number(fundingLine.gst_rate)
          );
          const fundingUnitRate = Number(fundingLine.unit_rate);
          const drawQuantity = fundingUnitRate > 0 ? roundQuantity(quotedAmount / fundingUnitRate) : 0;

          // Quantity headroom is a SEPARATE check from the money split above. allocateAcrossLines
          // only ever balances money (see its doc comment) — it has no visibility into physical
          // unit quantity, so a draw that clears the money check can still ask for more of this
          // specific line's own available_quantity than remains. This is a hard stop for the
          // whole save: deliberately NOT re-run against the allocator excluding this line, since
          // joint amount+quantity bin-packing across the branch is out of scope here. Netted
          // against this same save's own earlier draws against this line (drawnQuantityByLineId),
          // for the same reason the money side is netted above.
          const alreadyDrawnQuantity = drawnQuantityByLineId.get(String(fundingLine.id)) ?? 0;
          const availableQuantity = Number(fundingLine.available_quantity) - alreadyDrawnQuantity;
          if (drawQuantity > availableQuantity + 0.0001) {
            const shortfall = roundQuantity(drawQuantity - availableQuantity);
            throw Object.assign(
              refuse(
                409,
                "HEADROOM_EXCEEDED",
                `${fundingLine.item_name}: split allocation exceeds available quantity by ${shortfall} ${fundingLine.unit}`
              ),
              { shortfall }
            );
          }

          const amounts = calculateBudgetLine({
            head: String(fundingLine.head),
            subHead: fundingLine.sub_head,
            itemName: String(fundingLine.item_name),
            quantity: drawQuantity,
            unit: String(fundingLine.unit),
            unitRate: fundingUnitRate,
            taxTreatment: String(fundingLine.tax_treatment) as BudgetTaxTreatment,
            gstRate: Number(fundingLine.gst_rate),
            gstType: String(fundingLine.gst_type) as BudgetGstType,
            recoverableTaxPct: Number(fundingLine.recoverable_tax_pct),
            justification: String(fundingLine.justification || "Approved budget allocation"),
          });

          // Spillover audit trail: only the first/primary draw for a row keeps the raiser's own
          // remarks verbatim. Every draw beyond it exists only because the row's own line came up
          // short, so it gets a note explaining why it is here.
          const remarks = drawIndex === 0
            ? baseRemarks
            : `Auto-allocated from branch aggregate headroom for ${head}/${subHead || ""} — original line's own share was insufficient`;

          prepared.push({
            // Funding source (budget_id/id/tax profile) is fundingLine's own; cost-centre
            // attribution is overridden to the ORIGINAL allocation row's own cost centre — the
            // GRN's cost-centre attribution reflects who incurred the spend, not which budget
            // pool paid for it.
            line: { ...fundingLine, cost_centre_id: originalCostCentreId, cost_centre_name: originalCostCentreName },
            quantity: drawQuantity,
            unitRate: fundingUnitRate,
            amounts,
            remarks,
            // Inherited from the ORIGINAL allocation row, regardless of which line ended up
            // funding it — a budgeted row that merely spilled onto a sibling line is not
            // "unbudgeted"; only a row that started with no budgetLineId at all is.
            isUnbudgeted: isUnbudgetedRow,
          });

          drawnAmountByLineId.set(String(fundingLine.id), (drawnAmountByLineId.get(String(fundingLine.id)) ?? 0) + draw.amount);
          drawnQuantityByLineId.set(String(fundingLine.id), (drawnQuantityByLineId.get(String(fundingLine.id)) ?? 0) + drawQuantity);
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
          // is_unbudgeted written per row. IMPORTANT — this differs from saveComponentAllocations()
          // (untouched, vendor-only path): as of the Group C step 2a headroom gate (2026-08-22),
          // an unbudgeted row saved HERE always gets a REAL budget_id/budget_line_id, drawn from
          // the branch aggregate for its head+sub-head (see getHeadSubHeadCoverage/
          // allocateAcrossLines above) — it is no longer persisted with a NULL budget_line_id
          // waiting to be linked. is_unbudgeted is the only surviving signal that the raiser
          // themselves picked no line; do not assume NULL budget_line_id identifies such a row any
          // more for allocations saved through this method. See flagged concern in the step-2a
          // report about linkUnbudgetedBudgetLines() (Finance Head's manual "link a budget line"
          // action, which required budget_line_id IS NULL): it becomes unreachable for any
          // allocation saved through this method after this change, since hasBudgetLine() now
          // returns true immediately. It remains reachable only for legacy rows already in the
          // database with a NULL budget_line_id from before this deploy.
          `INSERT INTO grn_cost_allocation
           (id, grn_request_id, sequence_no, budget_id, budget_line_id, branch_id,
            process_id, cost_centre_id, cost_class, allocation_percentage,
            quantity, unit, unit_rate, tax_treatment, gst_rate, gst_type,
            recoverable_tax_pct, amount_without_tax, tax_amount, cgst_amount,
            sgst_amount, igst_amount, amount_with_tax, recoverable_tax_amount,
            pnl_cost_amount, lifecycle_status, remarks, is_unbudgeted, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
            "draft", item.remarks, item.isUnbudgeted ? 1 : 0, actorUserId,
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
                other_charges = ?, round_off_amount = ?,
                is_unbudgeted = ?
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
          // Derived from the rows just written, not the flag stored at create time — a GRN
          // created as an ordinary budgeted draft can still end up with an unbudgeted cost
          // centre once split, and that has to route through the same stricter approval an
          // originally-unbudgeted GRN does.
          prepared.some((item) => item.isUnbudgeted) ? 1 : 0,
          grnId,
        ]
      );

      // Recognition schedule last: it reads back the allocation rows just written, and being
      // inside this transaction means a split that does not reconcile rolls the invoice back.
      const periodSplit = await writePeriodSplits(connection, grnId, grn, input, actorUserId, actorRole);

      await writeAuditInTransaction(connection, "ALLOCATIONS_SAVED", grnId, actorUserId, actorRole, {
        recognition_months: periodSplit?.eligibleCount ?? 1,
        allocation_count: prepared.length,
        amount_without_tax: totalBase,
        tax_amount: totalTax,
        amount_with_tax: totalGross,
        pnl_cost_amount: totalPnl,
      });
      await connection.commit();
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

      // UNBUDGETED EXPENSES: a split row with no budgetLineId but a costCentreId is unbudgeted
      // for that cost centre only — resolved independently per row, not gated by a single
      // whole-GRN flag, so one Head/Sub-head that is budgeted at some cost centres and not
      // others can still be raised (and saved) as one GRN. isUnbudgeted below is DERIVED after
      // resolution (true if any row came back unbudgeted) rather than dictating it up front —
      // input.isUnbudgeted is accepted but no longer authoritative, kept only so an old client
      // sending it does not break.

      // Resolve every cost-centre split row against its approved budget line — same lock,
      // period-match, and period-lock checks saveAllocations() already applies per row. A row
      // with no budgetLineId falls back to costCentreId directly.
      const resolvedSplits: any[] = [];
      let percentageSum = 0;
      for (let index = 0; index < splits.length; index += 1) {
        const split = splits[index];
        const percentage = Number(split.percentage);
        if (!Number.isFinite(percentage) || percentage <= 0) {
          throw new Error(`Cost centre ${index + 1}: split percentage must be greater than zero`);
        }

        if (!split?.budgetLineId) {
          // No budget line for this row: fall back to the cost centre the raiser picked directly.
          if (!split?.costCentreId) throw new Error(`Cost centre ${index + 1}: select a budget line, or a cost centre for an unbudgeted allocation`);
          // Verify cost centre exists and belongs to the branch
          const [ccRows] = await connection.execute<RowDataPacket[]>(
            `SELECT id, cost_centre_code, cost_centre_name, branch_id
             FROM cost_centre_master WHERE id = ? AND active_status = 1 LIMIT 1`,
            [split.costCentreId]
          );
          if (!ccRows.length) throw new Error(`Cost centre ${index + 1}: cost centre not found or inactive`);
          const cc = ccRows[0];
          if (String(cc.branch_id) !== String(grn.branch_id)) {
            throw new Error(`Cost centre ${index + 1}: cost centre does not belong to this branch`);
          }
          percentageSum += percentage;
          resolvedSplits.push({
            line: null, // No budget line for this row — filled in with a synthetic one below
            costCentreId: split.costCentreId,
            costCentreCode: cc.cost_centre_code,
            percentage,
            remarks: split.remarks?.trim() || null,
            isUnbudgeted: true,
          });
        } else {
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
          resolvedSplits.push({ line, percentage, remarks: split.remarks?.trim() || null, isUnbudgeted: false });
        }
      }
      const isUnbudgeted = resolvedSplits.some((item) => item.isUnbudgeted);
      if (Math.abs(percentageSum - 100) > 0.5) {
        throw new Error(`Cost-centre split percentages must total 100% (currently ${roundMoney(percentageSum)}%)`);
      }
      // Absorb ordinary floating-point noise from an auto-split calculation into the last row,
      // exactly like the defensive correction saveAllocations() applies after insert below.
      resolvedSplits[resolvedSplits.length - 1].percentage += 100 - percentageSum;

      // Synthetic "line" for an unbudgeted row — filled in per row (not gated by a whole-GRN
      // flag), so a mixed GRN keeps every unbudgeted row's head/sub-head matching whichever
      // real budget line(s) sit alongside it, rather than the GRN header's own head/sub_head
      // columns (those are only populated at create time for a WHOLLY unbudgeted GRN — see
      // createUnbudgetedDraft / isUnbudgetedFlow on the frontend, e2c8db0d — so they can be
      // stale/blank here for a GRN that started out mixed).
      const referenceLine = resolvedSplits.find((item) => !item.isUnbudgeted)?.line;
      const fallbackHead = referenceLine ? String(referenceLine.head) : String(grn.head || "Unbudgeted");
      const fallbackSubHead = referenceLine ? (referenceLine.sub_head ?? null) : (grn.sub_head || null);
      for (const split of resolvedSplits) {
        if (!split.isUnbudgeted) continue;
        split.line = {
          id: null,
          budget_id: null,
          head: fallbackHead,
          sub_head: fallbackSubHead,
          item_name: fallbackHead,
          cost_centre_id: split.costCentreId,
          cost_centre_name: split.costCentreCode,
          process_id: null,
          unit: "amount",
          unit_rate: 1, // For unbudgeted, we use 1:1 mapping
          quantity: declaredTotal, // Full amount as "available"
          tax_treatment: "exclusive",
          gst_rate: 0,
          gst_type: referenceLine ? String(referenceLine.gst_type) : "cgst_sgst",
          recoverable_tax_pct: 100,
          justification: "Unbudgeted expense",
          // No budget capacity constraints for unbudgeted
          gross_amount: declaredTotal * 1000, // Effectively unlimited
          reserved_amount: 0,
          consumed_amount: 0,
          reserved_quantity: 0,
          consumed_quantity: 0,
        };
      }

      // One Head/Sub-head classification per GRN — the split only decides how much of that one
      // spend belongs to which cost centre, not a mix of different expense categories. Runs
      // after the synthetic-line fill above so every row (budgeted or not) has a real .line.
      const distinctHeads = new Set(resolvedSplits.map((item) => String(item.line.head)));
      const distinctSubHeads = new Set(resolvedSplits.map((item) => String(item.line.sub_head || "")));
      if (distinctHeads.size > 1 || distinctSubHeads.size > 1) {
        throw new Error("All cost-centre splits must share the same expense head and sub-head");
      }

      // Invoice GST rates are ground truth. Budget line tax_treatment is a planning-time
      // classification and does not block GRN submission — gross amount consumption is
      // correct regardless of the budget line's tax_treatment label.

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
      // G8: Finance Head / Accounts Head / Super Admin can accept larger round-offs (up to ₹500)
      // for invoices with legitimate rounding differences. Branch-level roles are still limited
      // to ₹1 auto-round-off.
      const isElevatedRole = ["finance_head", "accounts_head", "super_admin"].includes(actorRole);
      const roundoffLimit = isElevatedRole ? 500 : GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT;
      if (Math.abs(diff) > roundoffLimit) {
        throw new Error(
          `Invoice components total ₹${rawTotalGross.toFixed(2)} does not match the declared invoice total `
          + `₹${declaredTotal.toFixed(2)}. Difference ₹${diff.toFixed(2)} exceeds the ₹${roundoffLimit.toFixed(2)} round-off limit.`
        );
      }

      // An absorption only a senior role could authorise is a judgement call, so record it.
      //
      // G8's ceiling is Finance's decision and is left exactly where they set it. What was missing
      // is that using it left no trace: a gap of up to ₹500 was folded into a cost-allocation
      // amount and the invoice then reconciled perfectly, so afterwards nothing distinguished
      // "the numbers agreed" from "someone senior accepted that they didn't". Anything within the
      // ordinary ₹1 is arithmetic rounding and stays silent; beyond it, the actor, the invoice and
      // the amount are on the record.
      //
      // Deliberately not awaited into the caller's critical path failure — see the catch: an audit
      // write must not be able to fail a GRN save that is otherwise valid.
      if (Math.abs(diff) > GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT) {
        void logSensitiveAction({
          actor_user_id: actorUserId,
          actor_role: actorRole,
          action_type: "GRN_ELEVATED_ROUNDOFF_ACCEPTED",
          module_key: "FINANCE",
          entity_type: "grn_request",
          entity_id: grnId,
          change_summary: {
            difference: diff,
            ordinary_limit: GRN_INVOICE_COMPONENT_ROUNDOFF_LIMIT,
            elevated_limit: roundoffLimit,
            components_total: rawTotalGross,
            declared_invoice_total: declaredTotal,
          },
        }).catch((err: unknown) => {
          console.error("[grn] failed to record elevated round-off:", err instanceof Error ? err.message : String(err));
        });
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
            isUnbudgeted: Boolean(split.isUnbudgeted),
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
          // is_unbudgeted is written per row, not left to its DEFAULT 0. Migration 1218 added this
          // column for exactly this case and nothing had ever populated it, so an unbudgeted split
          // would have been indistinguishable from a budgeted one the moment a budget line was
          // linked during approval — the NULL budget_line_id that identifies it is overwritten by
          // that very step. Nothing reads the column yet; this stops it being another half-built
          // signal that reads 0 for every row forever.
          `INSERT INTO grn_cost_allocation
           (id, grn_request_id, sequence_no, budget_id, budget_line_id, invoice_component_id,
            branch_id, process_id, cost_centre_id, cost_class, allocation_percentage,
            quantity, unit, unit_rate, tax_treatment, gst_rate, gst_type,
            recoverable_tax_pct, amount_without_tax, tax_amount, cgst_amount,
            sgst_amount, igst_amount, amount_with_tax, recoverable_tax_amount,
            pnl_cost_amount, lifecycle_status, remarks, is_unbudgeted, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
            "draft", cell.remarks, cell.isUnbudgeted ? 1 : 0, actorUserId,
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
                accounting_period = COALESCE(?, accounting_period),
                is_late_invoice  = COALESCE(?, is_late_invoice),
                late_invoice_reason = COALESCE(?, late_invoice_reason),
                gst_enabled = COALESCE(?, gst_enabled),
                vendor_state_code = COALESCE(?, vendor_state_code),
                billing_state_code = COALESCE(?, billing_state_code),
                is_unbudgeted = ?
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
          // Late invoice fields (migration 1219 columns) — null when invoice is current
          input.lateInvoiceReason?.trim() ? 1 : null,
          input.lateInvoiceReason?.trim() || null,
          // GST fields (migration 1218 columns)
          input.gstEnabled != null ? (input.gstEnabled ? 1 : 0) : null,
          input.vendorStateCode?.trim() || null,
          input.billingStateCode?.trim() || null,
          isUnbudgeted ? 1 : 0,
          grnId,
        ]
      );

      // Recognition schedule last: it reads back the allocation rows just written, and being
      // inside this transaction means a split that does not reconcile rolls the invoice back.
      const periodSplit = await writePeriodSplits(connection, grnId, grn, input, actorUserId, actorRole);

      await writeAuditInTransaction(connection, "INVOICE_COMPONENTS_SAVED", grnId, actorUserId, actorRole, {
        recognition_months: periodSplit?.eligibleCount ?? 1,
        component_count: components.length,
        cost_centre_count: resolvedSplits.length,
        amount_without_tax: rawTotalBase,
        tax_amount: rawTotalTax,
        amount_with_tax: totalGrossFinal,
        round_off_amount: diff,
      });
      await connection.commit();
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

    // Key resolution order: env first (a deployment can always pin its own key), then the
    // DB-managed provider config that the AI Provider admin screen and every other AI feature
    // already use. Reading env alone left this extractor reporting "unconfigured" on a system
    // where an active, is_default Gemini key was configured all along — the key existed, this
    // was simply the one caller that never looked where it lives.
    let apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
    let modelName = process.env.GRN_DOCUMENT_AI_MODEL || "";
    let providerSource = apiKey ? "env" : "";
    if (!apiKey) {
      try {
        const config = await aiProviderConfigService.getByKey("gemini", true);
        if (config?.activeStatus === "active" && config.apiKey) {
          apiKey = config.apiKey;
          modelName = modelName || config.modelName || "";
          providerSource = "ai_provider_config";
        }
      } catch (error) {
        // A decryption or lookup failure must not take the upload down — fall through to the
        // manual_review row below, which is the same outcome as having no key at all.
        console.error("[GRN] Gemini provider config lookup failed:", error instanceof Error ? error.message : error);
      }
    }
    modelName = modelName || "gemini-1.5-flash";
    if (!apiKey) {
      const extractionId = randomUUID();
      await db.execute(
        `INSERT INTO grn_document_extraction
         (id, document_id, grn_request_id, provider, model_name, status,
          confidence_score, error_message)
         VALUES (?,?,?,?,?,'manual_review',0,?)`,
        [extractionId, documentId, grnId, "unconfigured", null, "No Gemini key available — set GEMINI_API_KEY, or configure an active Gemini provider under AI Providers"]
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
        key_source: providerSource,
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

  /**
   * Links an approved budget line to each cost-centre split of an UNBUDGETED GRN.
   *
   * This is the second half of the unbudgeted flow and the reason raising one without a budget is
   * safe. The raiser books the invoice against a Head/Sub-head that has no budget line; Finance
   * Head, who is the person able to create or move budget in the first place, attaches a real line
   * to every split before approving. review() refuses a Finance Head approval until that is done.
   *
   * Every check saveInvoiceComponents() applies when a split is linked at draft time is applied
   * again here, because this path reaches the same end state by a different route: the line must
   * belong to this branch and be active (lockBudgetLine), sit in the GRN's own consumption period,
   * not be in a period closed for P&L, and match the cost centre the split was raised against —
   * without that last one a Finance Head could quietly move spend onto another cost centre's
   * budget after Branch Head had already reviewed the split.
   *
   * Capacity is checked against the line's live availability rather than assumed, and where the
   * GRN has already passed Branch Head — so every split is sitting in lifecycle_status 'reserved'
   * with nothing actually reserved, because there was no line to reserve against — the reservation
   * is placed now, at link time. Skipping that would leave consumeAllocations() at approval
   * consuming a reservation that was never made.
   */
  async linkUnbudgetedBudgetLines(
    grnId: string,
    links: Array<{ allocationId: string; budgetLineId: string }>,
    actorUserId: string,
    actorRole: string
  ) {
    if (!Array.isArray(links) || !links.length) {
      throw new Error("At least one cost-centre split must be linked to a budget line");
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const grn = await lockGrn(connection, grnId);
      if (Number(grn.is_unbudgeted) !== 1) {
        throw new Error("This GRN was raised against an approved budget — there is nothing to link");
      }
      // Linking is an approval-stage action. Before submission the raiser still owns the splits
      // and the next invoice-components save replaces every allocation row wholesale, which would
      // discard the link; after Finance Head approval the budget has already moved.
      if (!["submitted", "branch_head_approved"].includes(String(grn.status))) {
        throw new Error(
          `A budget line can only be linked while the GRN is awaiting review. Current status: ${grn.status}`
        );
      }

      const allocations = await loadAllocations(connection, grnId, true);
      const byId = new Map(allocations.map((allocation) => [String(allocation.id), allocation]));
      const period = consumptionPeriodOf(grn);
      if (await isPeriodLocked(period, connection)) {
        throw new Error(
          `${period} is locked for P&L close. This GRN must be raised against the current open period.`
        );
      }

      const linked: Array<Record<string, unknown>> = [];
      for (const link of links) {
        const allocation = byId.get(String(link?.allocationId ?? ""));
        if (!allocation) throw new Error("Cost-centre split not found on this GRN");
        if (hasBudgetLine(allocation)) {
          throw new Error(
            `${allocation.cost_centre_name || "This cost centre"} is already linked to a budget line`
          );
        }
        if (!link?.budgetLineId) {
          throw new Error(
            `${allocation.cost_centre_name || "Cost centre"}: select an approved budget line`
          );
        }

        const line = await lockBudgetLine(connection, String(link.budgetLineId), String(grn.branch_id));
        if (String(line.period_code) !== period) {
          throw new Error(
            `${allocation.cost_centre_name || "Cost centre"}: budget period ${line.period_code} does not match the accounting month ${period}`
          );
        }
        if (String(line.cost_centre_id ?? "") !== String(allocation.cost_centre_id ?? "")) {
          throw new Error(
            `${allocation.cost_centre_name || "Cost centre"}: that budget line belongs to a different cost centre`
          );
        }

        const availableAmount = roundMoney(
          Number(line.gross_amount || 0)
          - Number(line.reserved_amount || 0)
          - Number(line.consumed_amount || 0)
        );
        if (Number(allocation.amount_with_tax) > availableAmount + 0.01) {
          throw new Error(
            `${allocation.cost_centre_name || "Cost centre"}: this split of ${Number(allocation.amount_with_tax).toFixed(2)} exceeds the line's available budget of ${availableAmount.toFixed(2)}`
          );
        }

        /*
         * The consumed QUANTITY has to be re-derived against the line being linked, and this is
         * the subtle part of the whole flow.
         *
         * An unbudgeted split was costed against a synthetic line with unit "amount" and
         * unit_rate 1, so its stored quantity is literally the rupee amount. A real budget line
         * is denominated in its own unit — 12 months, 40 headcount, 6 licences — and
         * budgetConsumptionService.reserve() checks the quantity as well as the money. Reserving
         * a quantity of 52,012 against a line approved for 12 months would fail on availability
         * with a message about quantity that would read as nonsense to the reviewer, and where it
         * did NOT fail it would be worse: a line's whole quantity budget consumed by one invoice.
         *
         * Derived exactly as saveComponentAllocations() derives it for a budgeted split —
         * base / unit_rate — so a linked split ends up identical to one that had this budget line
         * from the start.
         *
         * The MONEY is deliberately not recomputed. The invoice's own components are ground truth
         * (the same principle the tax breakdown already follows) and the reviewer has already
         * reconciled those totals; re-deriving them from the budget line at link time would move
         * the numbers under them after Branch Head had signed off.
         */
        const lineUnitRate = Number(line.unit_rate);
        if (!(lineUnitRate > 0)) {
          throw new Error(
            `${allocation.cost_centre_name || "Cost centre"}: that budget line has no approved unit rate to derive a consumed quantity from`
          );
        }
        const linkedQuantity = roundQuantity(Number(allocation.amount_without_tax) / lineUnitRate);
        const availableQuantity = roundQuantity(
          Number(line.quantity || 0)
          - Number(line.reserved_quantity || 0)
          - Number(line.consumed_quantity || 0)
        );
        if (linkedQuantity > availableQuantity + 0.0001) {
          throw new Error(
            `${allocation.cost_centre_name || "Cost centre"}: this split needs ${linkedQuantity} ${line.unit} but only ${availableQuantity} ${line.unit} remain approved on that line`
          );
        }

        await connection.execute(
          `UPDATE grn_cost_allocation
              SET budget_id = ?, budget_line_id = ?, process_id = ?, cost_class = ?,
                  quantity = ?, unit = ?, unit_rate = ?
            WHERE id = ? AND grn_request_id = ?`,
          [
            line.budget_id,
            line.id,
            line.process_id ?? allocation.process_id ?? null,
            line.process_id || line.cost_centre_id ? "direct" : "indirect",
            linkedQuantity,
            line.unit,
            lineUnitRate,
            allocation.id,
            grnId,
          ]
        );

        // Branch Head has already approved: the split is marked 'reserved' but nothing was
        // reserved, because there was no line. Place that reservation now against the line just
        // linked, so the amounts stay in step with every budgeted GRN at the same stage.
        if (String(allocation.lifecycle_status) === "reserved") {
          await budgetConsumptionService.reserve(
            connection,
            String(line.id),
            Number(allocation.amount_with_tax),
            linkedQuantity,
            Number(allocation.amount_without_tax) || undefined
          );
        }

        linked.push({
          allocation_id: String(allocation.id),
          cost_centre_id: allocation.cost_centre_id ?? null,
          cost_centre_name: allocation.cost_centre_name ?? null,
          budget_line_id: String(line.id),
          budget_id: String(line.budget_id),
          item_name: line.item_name ?? null,
          amount_with_tax: Number(allocation.amount_with_tax),
          quantity: linkedQuantity,
          unit: line.unit ?? null,
          unit_rate: lineUnitRate,
          reserved_now: String(allocation.lifecycle_status) === "reserved",
        });
      }

      // Mirror the header onto the first split exactly as saveInvoiceComponents() does, but only
      // once nothing is left unlinked — a half-linked GRN must not read as budgeted anywhere.
      const remaining = await loadAllocations(connection, grnId);
      const stillUnlinked = remaining.filter((allocation) => !hasBudgetLine(allocation));
      if (!stillUnlinked.length && remaining.length) {
        await connection.execute(
          `UPDATE grn_request SET budget_id = ?, budget_line_id = ? WHERE id = ?`,
          [remaining[0].budget_id, remaining[0].budget_line_id, grnId]
        );
      }

      // is_unbudgeted deliberately stays 1. It records how the GRN was RAISED — which is the
      // fact an auditor asking "what did we commit to before budgeting it?" needs — not whether
      // it currently has a budget line, which the allocation rows already answer.
      await writeAuditInTransaction(
        connection,
        "GRN_UNBUDGETED_BUDGET_LINKED",
        grnId,
        actorUserId,
        actorRole,
        {
          linked_count: linked.length,
          still_unlinked_count: stillUnlinked.length,
          accounting_period: period,
          links: linked,
        }
      );
      await connection.commit();
      return {
        ...(await this.getWorkspace(grnId)),
        linkedCount: linked.length,
        remainingUnlinked: stillUnlinked.length,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
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
          /*
           * An UNBUDGETED GRN approves WITHOUT a budget line. Deliberate, and asked for
           * explicitly: linking is an option Finance Head has, never a gate they must pass.
           *
           * What that costs is exactly one thing — no budget line is decremented, because there
           * is no line to decrement. Everything else still happens, which is why this is safe
           * rather than a hole:
           *   - consumeAllocations() below marks EVERY row 'consumed', unlinked ones included,
           *     and the P&L overlay aggregates on lifecycle_status = 'consumed' with no
           *     dependency on budget_line_id — so the cost lands in the P&L in full.
           *   - the vendor payable is created as normal; vendor-payment.service.ts already
           *     stores a NULL budget_id/budget_line_id.
           *   - is_unbudgeted = 1 stays on the GRN and on each allocation row, so spend that
           *     bypassed a budget is identifiable rather than silently indistinguishable.
           *
           * The honest description is that this records unbudgeted spend instead of preventing
           * it. Finance sees it, it hits the P&L, and no budget claims to have covered it.
           */
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
          // P1-5, same as the branch_head and finance_head-approve UPDATEs above: expected
          // status in WHERE so a concurrent transition can't be silently overwritten. This
          // branch was the one arm of review() still missing it.
          const [fhRejectResult] = await connection.execute<ResultSetHeader>(
            `UPDATE grn_request
                SET status = 'rejected', finance_head_reviewed_by = ?,
                    finance_head_reviewed_at = NOW(), finance_head_review_note = ?,
                    reviewed_by = ?, reviewed_at = NOW(), review_note = ?, rejection_reason = ?
              WHERE id = ? AND status = 'branch_head_approved'`,
            [actorUserId, reviewNote?.trim(), actorUserId, reviewNote?.trim(), reviewNote?.trim(), grnId]
          );
          if (fhRejectResult.affectedRows !== 1) {
            throw Object.assign(
              new Error("GRN state changed concurrently; refresh and try again"),
              { code: "STATE_CHANGED", statusCode: 409 }
            );
          }
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

      await writeAuditInTransaction(connection, decision.toUpperCase(), grnId, actorUserId, actorRole, {
        review_note: reviewNote,
        new_status: newStatus,
        payment_id: paymentId,
        allocation_aware: true,
      });

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
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
