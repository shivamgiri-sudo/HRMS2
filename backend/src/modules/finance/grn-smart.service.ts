import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import {
  calculateBudgetLine,
  type BudgetGstType,
  type BudgetTaxTreatment,
} from "../process-pnl/branch-budget.service.js";
import { budgetConsumptionService } from "../process-pnl/budget-consumption.service.js";
import { vendorPaymentService } from "./vendor-payment.service.js";

export interface SmartAllocationInput {
  budgetLineId: string;
  quantity: number;
  unitRate?: number;
  remarks?: string;
}

export interface SmartGrnInvoiceInput {
  invoiceNumber?: string;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  purchaseReference?: string | null;
  vendorGstin?: string | null;
  placeOfSupply?: string | null;
  otherCharges?: number;
  roundOffAmount?: number;
  declaredInvoiceTotal?: number;
  allocations: SmartAllocationInput[];
}

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
      Number(allocation.quantity)
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
      Number(allocation.quantity)
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
      Number(allocation.quantity)
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

export const grnSmartService = {
  async hasAllocations(grnId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM grn_cost_allocation WHERE grn_request_id = ?",
      [grnId]
    );
    return Number(rows[0]?.total ?? 0) > 0;
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
        if (String(grn.bill_date).slice(0, 7) !== String(line.period_code)) {
          throw new Error(`Allocation ${index + 1}: budget period ${line.period_code} does not match the invoice month`);
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
                invoice_number = ?, service_period_start = ?, service_period_end = ?,
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
          dateOrNull(input.servicePeriodStart), dateOrNull(input.servicePeriodEnd),
          String(input.purchaseReference ?? "").trim() || null,
          String(input.vendorGstin ?? "").trim().toUpperCase() || null,
          String(input.placeOfSupply ?? "").trim() || null,
          roundMoney(Number(input.otherCharges ?? 0)), roundMoney(Number(input.roundOffAmount ?? 0)),
          grnId,
        ]
      );

      await connection.commit();
      await writeAudit("ALLOCATIONS_SAVED", grnId, actorUserId, actorRole, {
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
    let newStatus = "";
    try {
      await connection.beginTransaction();
      const grn = await lockGrn(connection, grnId);
      const allocations = await loadAllocations(connection, grnId, true);
      if (!allocations.length) throw new Error("Smart GRN has no saved cost allocations");
      const role = actorRole.toLowerCase();

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
        await connection.execute(
          `UPDATE grn_request
              SET status = ?, branch_head_reviewed_by = ?, branch_head_reviewed_at = NOW(),
                  branch_head_review_note = ?, reviewed_by = ?, reviewed_at = NOW(),
                  review_note = ?, rejection_reason = ?
            WHERE id = ?`,
          [
            newStatus, actorUserId, reviewNote?.trim() || null, actorUserId,
            reviewNote?.trim() || null, decision === "rejected" ? reviewNote?.trim() : null, grnId,
          ]
        );
      } else if (role === "finance_head") {
        if (String(grn.status) !== "branch_head_approved") {
          throw new Error(`Finance Head can only review Branch Head-approved GRNs. Current status: ${grn.status}`);
        }
        if (decision === "approved") {
          await consumeAllocations(connection, allocations);
          newStatus = grn.grn_type === "vendor" ? "pending_accounts_payment" : "approved";
          await connection.execute(
            `UPDATE grn_request
                SET status = ?, accounts_payment_status = ?, finance_head_reviewed_by = ?,
                    finance_head_reviewed_at = NOW(), finance_head_review_note = ?,
                    reviewed_by = ?, reviewed_at = NOW(), review_note = ?, approved_by = ?,
                    approved_at = NOW(), rejection_reason = NULL
              WHERE id = ?`,
            [
              newStatus, grn.grn_type === "vendor" ? "pending" : "not_required",
              actorUserId, reviewNote?.trim() || null, actorUserId,
              reviewNote?.trim() || null, actorUserId, grnId,
            ]
          );
          if (grn.grn_type === "vendor") {
            paymentId = await vendorPaymentService.createFromGrn(grnId, actorUserId, connection);
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
      return {
        grn: grnRows[0],
        allocations,
        documents,
        extractions,
        validations,
        duplicates,
      };
    } finally {
      connection.release();
    }
  },
};
