import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { clientBillingNumberingService } from "./client-billing-numbering.service.js";
import {
  assertMonthLabelInFinanceYear,
  computeInvoiceAmounts,
  deriveGstType,
} from "./client-billing-tax.js";
import { checkPoCoverage, normaliseReferences, type InvoiceReferenceInput } from "./client-billing-po.js";
import { clientBillingProvisionService } from "./client-billing-provision.service.js";

export interface CostCentreTaxRow {
  gstType: string;
  stateCode: string | null;
  supplierGstin?: string | null;
  clientGstin?: string | null;
  clientStateCode?: string | null;
}

/**
 * Resolves the operative GST type for an invoice, preferring GSTIN-derived state comparison
 * over the potentially-stale `gst_type` flag on cost_centre_master.
 */
export function resolveGstType(
  _costCentreId: string,
  row: CostCentreTaxRow,
): { gstType: "Integrated" | "Intrastate" } {
  const derived = deriveGstType({
    supplierStateCode: row.stateCode,
    clientStateCode: row.clientStateCode ?? null,
    clientGstin: row.clientGstin ?? null,
    fallbackFlag: row.gstType,
  });
  const gstType = derived.gstType ?? (row.gstType === "Intrastate" ? "Intrastate" : "Integrated");
  return { gstType };
}

export interface ProformaLineInput {
  particulars: string;
  qty: number;
  rate: number;
  lineType?: "charge" | "deduction";
}

/** Legacy `invoiceType` — 10,875 of the migrated bills are Revenue, 75 Non Revenue. */
export const INVOICE_TYPES = ["Revenue", "Non Revenue"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export interface CreateProformaInput {
  costCentreId: string;
  category: string;
  financeYear: string;
  monthLabel: string;
  invoiceDate: string; // YYYY-MM-DD
  description?: string;
  applyGst?: boolean;
  /** Legacy "Apply Tax Calculation" (app_tax_cal). false = no tax at all, whatever applyGst says. */
  applyTaxCalc?: boolean;
  invoiceType?: string | null;
  lines: ProformaLineInput[];
  createdBy: string;
  references?: InvoiceReferenceInput;
}

export interface ProformaResult {
  id: string;
  proformaNo: string;
  totalAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  grandTotal: number;
  provisionUsed: number;
}

function clientError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function normaliseInvoiceType(value: unknown): InvoiceType {
  const v = String(value ?? "").trim();
  if (!v) return "Revenue";
  const match = INVOICE_TYPES.find((t) => t.toLowerCase() === v.toLowerCase());
  if (!match) throw clientError(`invoiceType must be one of ${INVOICE_TYPES.join(", ")}`);
  return match;
}

function validateLines(lines: ProformaLineInput[]): void {
  if (lines.length === 0) throw clientError("At least one line item is required");
  for (const line of lines) {
    if (!String(line.particulars ?? "").trim()) throw clientError("Every line needs particulars");
    if (!Number.isFinite(line.qty) || line.qty <= 0) throw clientError("Line quantity must be greater than zero");
    if (!Number.isFinite(line.rate) || line.rate < 0) throw clientError("Line rate must be zero or more");
  }
}

/**
 * Create = legacy Initial Invoice/Proforma. Uses the SAME rules as edit
 * (client-billing-edit.service.ts) so an invoice cannot change tax just by being re-saved:
 * GST type derived from the GSTIN states (stored flag only as fallback), single paise
 * rounding via computeInvoiceAmounts, month-inside-FY check. PO/GRN/JCC typed on the form
 * are stored (they used to be accepted by the route and silently dropped here), and the
 * taxable total is drawn from the cost centre's approved provision for the month.
 */
async function createProforma(input: CreateProformaInput): Promise<ProformaResult> {
  validateLines(input.lines);
  assertMonthLabelInFinanceYear(input.monthLabel, input.financeYear);
  const category = String(input.category ?? "").trim();
  if (!category || category.length > 50) throw clientError("category is required (max 50 characters)");
  const invoiceType = normaliseInvoiceType(input.invoiceType);
  const refs = input.references ? normaliseReferences(input.references) : null;

  const conn = await db.getConnection();
  const invoiceId = randomUUID();

  try {
    await conn.beginTransaction();

    const [costCentreRows] = await conn.execute<RowDataPacket[]>(
      `SELECT cc.gst_type AS gstType, b.gst_state_code AS stateCode,
              cc.service_tax_no AS supplierGstin, cc.vendor_gst_no AS clientGstin,
              cc.vendor_state_code AS clientStateCode,
              cc.tally_head AS tallyHead, cc.billing_client_name AS clientTallyName
       FROM cost_centre_master cc
       LEFT JOIN branch_master b ON b.id = cc.branch_id
       WHERE cc.id = ?`,
      [input.costCentreId]
    );
    const costCentre = costCentreRows[0] as (CostCentreTaxRow & {
      tallyHead: string | null; clientTallyName: string | null;
    }) | undefined;
    if (!costCentre) {
      throw clientError(`cost_centre_master ${input.costCentreId} not found`);
    }
    if (!costCentre.stateCode) {
      throw clientError(`cost centre ${input.costCentreId} has no branch GST state code — cannot mint a proforma number`);
    }
    // Same inputs as resolveGstType (used by edit), so create and edit always agree.
    const derived = deriveGstType({
      supplierStateCode: costCentre.stateCode,
      clientStateCode: costCentre.clientStateCode ?? null,
      clientGstin: costCentre.clientGstin ?? null,
      fallbackFlag: costCentre.gstType,
    });
    if (!derived.gstType) {
      throw clientError(`cost centre ${input.costCentreId} has an unrecognized GST type '${costCentre.gstType}' — expected 'Integrated' or 'Intrastate'`);
    }
    const gstType = derived.gstType;

    const applyGst = input.applyGst ?? true;
    const applyTaxCalc = input.applyTaxCalc ?? true;
    const amounts = computeInvoiceAmounts(input.lines, gstType, applyTaxCalc && applyGst);

    if (refs && refs.poNumbers.length > 0) {
      const coverage = await checkPoCoverage(
        { costCentreId: input.costCentreId, invoiceDate: input.invoiceDate, grandTotal: amounts.grandTotal, poNumbers: refs.poNumbers },
        conn,
      );
      if (!coverage.ok) throw clientError(coverage.errors.join("; "));
    }

    const proformaNo = await clientBillingNumberingService.mintProformaNumber(costCentre.stateCode, conn);

    await conn.execute<ResultSetHeader>(
      `INSERT INTO client_invoice
         (id, cost_centre_id, invoice_status, category, finance_year, month_label, invoice_date,
          description, proforma_no, gst_type, apply_gst, total_amount, igst_amount, cgst_amount,
          sgst_amount, grand_total, created_by, tally_head, client_tally_name, invoice_type, apply_tax_calc)
       VALUES (?, ?, 'proforma', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId, input.costCentreId, category, input.financeYear, input.monthLabel,
        input.invoiceDate, input.description ?? null, proformaNo, gstType,
        applyGst ? 1 : 0, amounts.totalAmount, amounts.igstAmount, amounts.cgstAmount,
        amounts.sgstAmount, amounts.grandTotal, input.createdBy,
        // Frozen at creation time, same as legacy's own cost_TallyHead/cost_client_tally_name
        // snapshot — Tally posting must reflect what was true then, not whatever
        // cost_centre_master says later if the ledger head is renamed.
        costCentre.tallyHead ?? null, costCentre.clientTallyName ?? null, invoiceType, applyTaxCalc ? 1 : 0,
      ]
    );

    if (refs) {
      await conn.execute<ResultSetHeader>(
        `UPDATE client_invoice
         SET po_numbers = ?, grn_no = ?, grn_date = ?, jcc_no = ?, jcc_date = ?, rcm_applicable = ?
         WHERE id = ?`,
        [
          refs.poNumbers.length > 0 ? refs.poNumbers.join(",") : null,
          refs.grnNo, refs.grnDate, refs.jccNo, refs.jccDate, refs.rcmApplicable ? 1 : 0, invoiceId,
        ]
      );
    }

    for (const [index, line] of input.lines.entries()) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO client_invoice_line (id, invoice_id, line_type, particulars, qty, rate, amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), invoiceId, line.lineType ?? "charge", line.particulars.trim(), line.qty, line.rate, amounts.lineAmounts[index]]
      );
    }

    const drawdown = await clientBillingProvisionService.drawDownForInvoice(conn, {
      invoiceId,
      costCentreId: input.costCentreId,
      financeYear: input.financeYear,
      monthLabel: input.monthLabel,
      amount: amounts.totalAmount,
    });

    await conn.execute(
      `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, 'created', ?, ?)`,
      [randomUUID(), invoiceId, input.createdBy, drawdown.used > 0 ? `provision used ${drawdown.used}` : null]
    );

    await conn.commit();
    return {
      id: invoiceId, proformaNo, totalAmount: amounts.totalAmount, igstAmount: amounts.igstAmount,
      cgstAmount: amounts.cgstAmount, sgstAmount: amounts.sgstAmount, grandTotal: amounts.grandTotal,
      provisionUsed: drawdown.used,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export const clientBillingService = { createProforma };
