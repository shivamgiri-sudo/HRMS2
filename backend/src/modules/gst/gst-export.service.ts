/**
 * GST export staging — the replacement for db_bill.tbl_tally_row_invoice_data.
 *
 * The legacy sheet was 34 varchar(100) columns with its own header row stored as data, no period
 * scoping, no validation, and a single `downloadstatus` flag. Everything it fed was reconciled by
 * hand before filing. This module materialises the same hand-off as typed, validated, reproducible
 * batches (see 1514_gst_export_staging.sql for the schema rationale).
 *
 * The governing idea: a row that CANNOT legally be filed is still written, flagged `exception`,
 * with a machine-readable reason. Finance gets a worklist instead of a silently short return, and
 * a batch is never presented as filing-ready while `exception_rows > 0`.
 */

import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export type GstExportType = "GSTR1" | "GSTR3B_OUTWARD" | "TALLY_SALES";

/** Threshold above which an unregistered inter-state supply is B2CL rather than B2CS (s.10 / Table 5). */
const B2CL_THRESHOLD = 250000;

/** Money tolerance. Invoice-level rounding is legitimately up to a rupee; beyond that is a data error. */
const MONEY_TOLERANCE = 1.0;

const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Statutory GSTIN check-digit validation.
 *
 * A structural regex alone accepts transposed digits and OCR slips, which is exactly how a wrong
 * recipient GSTIN reaches a return and lands the CUSTOMER with a mismatched credit. The 15th
 * character is a modulus-36 check digit over the first 14, so this is cheap and catches the
 * realistic failure mode.
 */
export function isValidGstin(value: unknown): boolean {
  const gstin = String(value ?? "").trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const v = GSTIN_ALPHABET.indexOf(gstin[i]);
    if (v < 0) return false;
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_ALPHABET[(36 - (sum % 36)) % 36] === gstin[14];
}

export function gstinStateCode(value: unknown): string | null {
  const gstin = String(value ?? "").trim().toUpperCase();
  return /^[0-9]{2}/.test(gstin) ? gstin.slice(0, 2) : null;
}

const money = (v: unknown): number => Math.round((Number(v ?? 0) + Number.EPSILON) * 100) / 100;

type ValidationError = { code: string; severity: "error" | "warning"; message: string };

interface StagedRow {
  sourceType: "invoice" | "credit_note";
  sourceId: string;
  billNo: string | null;
  invoiceDate: string | null;
  financialYear: string | null;
  monthLabel: string | null;
  companyName: string | null;
  companyGstin: string | null;
  branchName: string | null;
  branchStateCode: string | null;
  clientName: string | null;
  clientGstin: string | null;
  clientStateCode: string | null;
  placeOfSupply: string | null;
  processCode: string | null;
  poNo: string | null;
  grnNo: string | null;
  hsnSacCode: string | null;
  supplyType: string | null;
  gstType: string | null;
  gstRate: number | null;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  otherCharges: number;
  roundOff: number;
  invoiceValue: number;
  tallyHead: string | null;
  errors: ValidationError[];
}

/**
 * Classify the supply. GSTR-1 puts B2B, B2CL and B2CS in different tables with different key
 * fields, so getting this wrong misfiles the whole line rather than merely mis-stating a number.
 */
function classifySupply(
  applyGst: boolean,
  clientGstinValid: boolean,
  interState: boolean,
  invoiceValue: number
): string {
  if (!applyGst) return "NON_GST";
  if (clientGstinValid) return "B2B";
  if (interState && invoiceValue > B2CL_THRESHOLD) return "B2CL";
  return "B2CS";
}

/**
 * Every rule that decides whether a row can be filed.
 *
 * Ordered roughly by how badly each one bites: an unfilable supplier GSTIN kills the batch, a
 * wrong CGST/SGST-vs-IGST split creates a liability in the wrong state, a missing HSN fails
 * Table 12 validation at the portal.
 */
function validateRow(row: StagedRow): ValidationError[] {
  const errors: ValidationError[] = [];
  const push = (code: string, severity: "error" | "warning", message: string) =>
    errors.push({ code, severity, message });

  if (!row.companyGstin) {
    push("SUPPLIER_GSTIN_MISSING", "error", "No GSTIN on the supplying branch — this row cannot be filed under any registration.");
  } else if (!isValidGstin(row.companyGstin)) {
    push("SUPPLIER_GSTIN_INVALID", "error", `Supplier GSTIN ${row.companyGstin} fails its check digit.`);
  }

  if (!row.billNo) {
    push("DOCUMENT_NUMBER_MISSING", "error", "No invoice/credit-note number — GSTR-1 Table 13 requires a document series.");
  }
  if (!row.invoiceDate) {
    push("DOCUMENT_DATE_MISSING", "error", "No document date.");
  }

  const applyGst = row.supplyType !== "NON_GST";
  const clientGstinPresent = Boolean(row.clientGstin);
  const clientGstinValid = clientGstinPresent && isValidGstin(row.clientGstin);

  if (clientGstinPresent && !clientGstinValid) {
    push("RECIPIENT_GSTIN_INVALID", "error", `Recipient GSTIN ${row.clientGstin} fails its check digit — the customer's credit will not match.`);
  }
  if (applyGst && !clientGstinPresent) {
    push(
      "RECIPIENT_GSTIN_MISSING",
      "warning",
      "GST charged but no recipient GSTIN — filed as B2C. Confirm the client is genuinely unregistered."
    );
  }

  // Tax-split integrity. gst_type is the intent; the amounts are the fact. When they disagree the
  // tax has been raised in the wrong state, which is not correctable by a later amendment alone.
  const hasIgst = row.igst > 0;
  const hasCgstSgst = row.cgst > 0 || row.sgst > 0;
  if (hasIgst && hasCgstSgst) {
    push("TAX_SPLIT_MIXED", "error", "Row carries both IGST and CGST/SGST — a supply is one or the other.");
  }
  if (applyGst && !hasIgst && !hasCgstSgst && row.taxableValue > 0) {
    push("TAX_MISSING", "error", "Marked as taxable but carries no tax amount.");
  }
  if (hasCgstSgst && Math.abs(row.cgst - row.sgst) > 0.01) {
    push("CGST_SGST_ASYMMETRIC", "error", `CGST ${row.cgst.toFixed(2)} and SGST ${row.sgst.toFixed(2)} must be equal.`);
  }

  // Place of supply drives the split. If both state codes are known they must agree with it.
  if (row.branchStateCode && row.clientStateCode) {
    const interState = row.branchStateCode !== row.clientStateCode;
    if (interState && hasCgstSgst) {
      push("SPLIT_STATE_MISMATCH", "error", `Supplier state ${row.branchStateCode} differs from place of supply ${row.clientStateCode}, so this must be IGST, not CGST/SGST.`);
    }
    if (!interState && hasIgst) {
      push("SPLIT_STATE_MISMATCH", "error", `Supplier and recipient are both in state ${row.branchStateCode}, so this must be CGST/SGST, not IGST.`);
    }
  } else if (applyGst) {
    push("PLACE_OF_SUPPLY_UNKNOWN", "warning", "Place of supply could not be resolved — the CGST/SGST vs IGST split is unverified.");
  }

  // Arithmetic. Catches the string-typed-money class of defect the legacy sheet was prone to.
  const computed = money(row.taxableValue + row.igst + row.cgst + row.sgst + row.otherCharges + row.roundOff);
  if (Math.abs(computed - row.invoiceValue) > MONEY_TOLERANCE) {
    push(
      "VALUE_RECONCILIATION",
      "error",
      `Taxable + tax + charges + round-off = ${computed.toFixed(2)} but the document total is ${row.invoiceValue.toFixed(2)}.`
    );
  }

  if (applyGst && !row.hsnSacCode) {
    push("HSN_SAC_MISSING", "warning", "No HSN/SAC — GSTR-1 Table 12 (HSN summary) cannot be built for this line.");
  }

  return errors;
}

/** A batch is filing-ready only when nothing in it carries a blocking error. */
const isBlocked = (errors: ValidationError[]) => errors.some((e) => e.severity === "error");

export const gstExportService = {
  isValidGstin,

  /**
   * Build a batch for one registration and one month.
   *
   * Regeneration never mutates an existing batch — the previous one for the same
   * (type, GSTIN, period) is marked 'superseded' and a new row is written, so what was filed
   * stays reproducible.
   */
  async generateBatch(
    input: { exportType: GstExportType; companyGstin: string; periodMonth: string; notes?: string },
    actorUserId: string,
    actorRole: string
  ) {
    const exportType = input.exportType;
    const companyGstin = String(input.companyGstin ?? "").trim().toUpperCase();
    const periodMonth = String(input.periodMonth ?? "").trim();

    if (!/^\d{4}-\d{2}$/.test(periodMonth)) {
      throw new Error("periodMonth must be YYYY-MM");
    }
    if (!isValidGstin(companyGstin)) {
      throw new Error(`companyGstin ${companyGstin || "(blank)"} is not a valid GSTIN — a return is filed per registration and cannot be generated without one.`);
    }
    const stateCode = gstinStateCode(companyGstin)!;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const rows = await collectRows(connection, companyGstin, stateCode, periodMonth);

      const batchId = randomUUID();
      const totals = rows.reduce(
        (acc, r) => {
          acc.taxable += r.taxableValue;
          acc.igst += r.igst;
          acc.cgst += r.cgst;
          acc.sgst += r.sgst;
          acc.value += r.invoiceValue;
          return acc;
        },
        { taxable: 0, igst: 0, cgst: 0, sgst: 0, value: 0 }
      );
      const exceptionRows = rows.filter((r) => isBlocked(r.errors)).length;

      // Supersede any live batch for the same registration + period before inserting the new one,
      // so a period can never present two "current" batches to a preparer.
      await connection.execute(
        `UPDATE gst_export_batch
            SET status = 'superseded', superseded_by_id = ?, updated_at = NOW()
          WHERE export_type = ? AND company_gstin = ? AND period_month = ?
            AND status <> 'superseded'`,
        [batchId, exportType, companyGstin, periodMonth]
      );

      await connection.execute(
        `INSERT INTO gst_export_batch
           (id, export_type, company_gstin, gst_state_code, period_month, financial_year, status,
            total_rows, valid_rows, exception_rows,
            total_taxable_value, total_igst, total_cgst, total_sgst, total_invoice_value,
            generated_by, generated_at, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?)`,
        [
          batchId, exportType, companyGstin, stateCode, periodMonth,
          financialYearOf(periodMonth),
          exceptionRows > 0 ? "draft" : "validated",
          rows.length, rows.length - exceptionRows, exceptionRows,
          money(totals.taxable), money(totals.igst), money(totals.cgst), money(totals.sgst), money(totals.value),
          actorUserId, input.notes?.trim() || null,
        ]
      );

      let seq = 0;
      for (const r of rows) {
        seq += 1;
        const blocked = isBlocked(r.errors);
        await connection.execute(
          `INSERT INTO gst_export_row
             (id, batch_id, sequence_no, source_type, source_id, bill_no, invoice_date,
              financial_year, month_label, company_name, company_gstin, branch_name, branch_state_code,
              client_name, client_gstin, client_state_code, place_of_supply,
              process_code, po_no, grn_no, hsn_sac_code,
              supply_type, gst_type, gst_rate, taxable_value, igst_amount, cgst_amount, sgst_amount,
              other_charges, round_off_amount, invoice_value, tally_head,
              validation_status, validation_errors)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            randomUUID(), batchId, seq, r.sourceType, r.sourceId, r.billNo, r.invoiceDate,
            r.financialYear, r.monthLabel, r.companyName, r.companyGstin, r.branchName, r.branchStateCode,
            r.clientName, r.clientGstin, r.clientStateCode, r.placeOfSupply,
            r.processCode, r.poNo, r.grnNo, r.hsnSacCode,
            r.supplyType, r.gstType, r.gstRate, money(r.taxableValue), money(r.igst), money(r.cgst), money(r.sgst),
            money(r.otherCharges), money(r.roundOff), money(r.invoiceValue), r.tallyHead,
            blocked ? "exception" : "valid",
            r.errors.length ? JSON.stringify(r.errors) : null,
          ]
        );
      }

      await connection.commit();

      await logSensitiveAction({
        actor_user_id: actorUserId,
        actor_role: actorRole,
        action_type: "GST_EXPORT_GENERATED",
        module_key: "gst",
        entity_type: "gst_export_batch",
        entity_id: batchId,
        change_summary: {
          export_type: exportType, company_gstin: companyGstin, period_month: periodMonth,
          total_rows: rows.length, exception_rows: exceptionRows,
        },
      });

      return {
        batchId,
        exportType,
        companyGstin,
        periodMonth,
        status: exceptionRows > 0 ? "draft" : "validated",
        totalRows: rows.length,
        validRows: rows.length - exceptionRows,
        exceptionRows,
        filingReady: exceptionRows === 0 && rows.length > 0,
        totals: {
          taxableValue: money(totals.taxable),
          igst: money(totals.igst),
          cgst: money(totals.cgst),
          sgst: money(totals.sgst),
          invoiceValue: money(totals.value),
        },
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async listBatches(filters: { exportType?: string; companyGstin?: string; periodMonth?: string; limit?: number }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.exportType) { where.push("export_type = ?"); params.push(filters.exportType); }
    if (filters.companyGstin) { where.push("company_gstin = ?"); params.push(String(filters.companyGstin).toUpperCase()); }
    if (filters.periodMonth) { where.push("period_month = ?"); params.push(filters.periodMonth); }
    const limit = Math.min(Math.max(Number(filters.limit ?? 50), 1), 200);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM gst_export_batch
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY period_month DESC, created_at DESC
        LIMIT ${limit}`,
      params
    );
    return rows;
  },

  async getBatch(batchId: string) {
    const [batches] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM gst_export_batch WHERE id = ? LIMIT 1",
      [batchId]
    );
    if (!batches[0]) throw new Error("GST export batch not found");
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM gst_export_row WHERE batch_id = ? ORDER BY sequence_no",
      [batchId]
    );
    return { batch: batches[0], rows };
  },

  /** Only the rows a preparer has to act on. This is the report that replaces the manual reconciliation. */
  async getExceptions(batchId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sequence_no, source_type, source_id, bill_no, invoice_date, client_name,
              client_gstin, taxable_value, invoice_value, validation_errors
         FROM gst_export_row
        WHERE batch_id = ? AND validation_status = 'exception'
        ORDER BY sequence_no`,
      [batchId]
    );
    return rows;
  },

  async markDownloaded(batchId: string, actorUserId: string, actorRole: string) {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE gst_export_batch
          SET status = CASE WHEN exception_rows = 0 THEN 'exported' ELSE status END,
              downloaded_by = ?, downloaded_at = NOW()
        WHERE id = ? AND status <> 'superseded'`,
      [actorUserId, batchId]
    );
    if (result.affectedRows !== 1) throw new Error("Batch not found, or it has been superseded by a newer generation");
    await logSensitiveAction({
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action_type: "GST_EXPORT_DOWNLOADED",
      module_key: "gst",
      entity_type: "gst_export_batch",
      entity_id: batchId,
      change_summary: { batch_id: batchId },
    });
    return { success: true };
  },
};

function financialYearOf(periodMonth: string): string {
  const [y, m] = periodMonth.split("-").map(Number);
  return m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, "0")}` : `${y - 1}-${String(y % 100).padStart(2, "0")}`;
}

/**
 * Pull every outward document for this registration and period.
 *
 * Scoping is by the SUPPLYING BRANCH's GSTIN, not by company: two branches of one legal entity in
 * different states file separate returns, and putting a Gujarat invoice into the UP return is a
 * misdeclaration in both.
 */
async function collectRows(
  connection: PoolConnection,
  companyGstin: string,
  stateCode: string,
  periodMonth: string
): Promise<StagedRow[]> {
  const [invoices] = await connection.execute<RowDataPacket[]>(
    `SELECT ci.id, ci.bill_no, ci.invoice_date, ci.finance_year, ci.month_label,
            ci.gst_type, ci.apply_gst, ci.total_amount, ci.igst_amount, ci.cgst_amount,
            ci.sgst_amount, ci.grand_total, ci.tally_head, ci.client_tally_name,
            cm.cost_centre_code, cm.billing_client_name, cm.client_name,
            cm.vendor_gst_no, cm.vendor_state_code, cm.sac_code, cm.hsn_code, cm.jcc_no, cm.grn,
            bm.branch_name, bm.gstin AS branch_gstin, bm.gst_state_code, bm.company_name AS branch_company
       FROM client_invoice ci
       JOIN cost_centre_master cm ON cm.id = ci.cost_centre_id
       JOIN branch_master bm ON bm.id = cm.branch_id
      WHERE bm.gstin = ?
        AND DATE_FORMAT(ci.invoice_date, '%Y-%m') = ?
        AND ci.invoice_status = 'approved'
      ORDER BY ci.invoice_date, ci.bill_no`,
    [companyGstin, periodMonth]
  );

  const staged: StagedRow[] = [];
  for (const r of invoices) {
    staged.push(buildRow(r, "invoice", companyGstin, stateCode));
  }

  const [notes] = await connection.execute<RowDataPacket[]>(
    `SELECT cn.id, cn.credit_no AS bill_no, cn.credit_date AS invoice_date, cn.finance_year,
            cn.month_label, cn.gst_type, cn.apply_gst, cn.total_amount, cn.igst_amount,
            cn.cgst_amount, cn.sgst_amount, cn.grand_total, cn.tally_head, cn.client_tally_name,
            cm.cost_centre_code, cm.billing_client_name, cm.client_name,
            cm.vendor_gst_no, cm.vendor_state_code, cm.sac_code, cm.hsn_code, cm.jcc_no, cm.grn,
            bm.branch_name, bm.gstin AS branch_gstin, bm.gst_state_code, bm.company_name AS branch_company
       FROM client_credit_note cn
       JOIN cost_centre_master cm ON cm.id = cn.cost_centre_id
       JOIN branch_master bm ON bm.id = cm.branch_id
      WHERE bm.gstin = ?
        AND DATE_FORMAT(cn.credit_date, '%Y-%m') = ?
      ORDER BY cn.credit_date, cn.credit_no`,
    [companyGstin, periodMonth]
  );
  for (const r of notes) {
    // Credit notes reduce outward liability; carrying them positive would overstate the return.
    const row = buildRow(r, "credit_note", companyGstin, stateCode);
    row.taxableValue = -Math.abs(row.taxableValue);
    row.igst = -Math.abs(row.igst);
    row.cgst = -Math.abs(row.cgst);
    row.sgst = -Math.abs(row.sgst);
    row.invoiceValue = -Math.abs(row.invoiceValue);
    row.errors = validateRow({ ...row, taxableValue: Math.abs(row.taxableValue), igst: Math.abs(row.igst), cgst: Math.abs(row.cgst), sgst: Math.abs(row.sgst), invoiceValue: Math.abs(row.invoiceValue) });
    staged.push(row);
  }

  return staged;
}

function buildRow(
  r: RowDataPacket,
  sourceType: "invoice" | "credit_note",
  companyGstin: string,
  stateCode: string
): StagedRow {
  const applyGst = Number(r.apply_gst ?? 0) === 1 && String(r.gst_type ?? "") !== "Not Applicable";
  const rawClientGstin = String(r.vendor_gst_no ?? "").trim().toUpperCase();
  // 'NA', '0', '-' are real values in cost_centre_master. Treat them as absent, not as a GSTIN.
  const clientGstin = /^(NA|N\/A|0|-|)$/i.test(rawClientGstin) ? null : rawClientGstin;
  const clientState = gstinStateCode(clientGstin) ?? (String(r.vendor_state_code ?? "").trim() || null);

  const taxable = money(r.total_amount);
  const igst = money(r.igst_amount);
  const cgst = money(r.cgst_amount);
  const sgst = money(r.sgst_amount);
  const total = money(r.grand_total);
  const rate = taxable > 0 ? Math.round(((igst + cgst + sgst) / taxable) * 100) : null;

  const row: StagedRow = {
    sourceType,
    sourceId: String(r.id),
    billNo: r.bill_no ? String(r.bill_no) : null,
    invoiceDate: r.invoice_date ? new Date(r.invoice_date).toISOString().slice(0, 10) : null,
    financialYear: r.finance_year ? String(r.finance_year) : null,
    monthLabel: r.month_label ? String(r.month_label) : null,
    companyName: r.branch_company ? String(r.branch_company) : null,
    companyGstin,
    branchName: r.branch_name ? String(r.branch_name) : null,
    branchStateCode: String(r.gst_state_code ?? stateCode) || stateCode,
    clientName: String(r.client_tally_name ?? r.billing_client_name ?? r.client_name ?? "") || null,
    clientGstin,
    clientStateCode: clientState,
    placeOfSupply: clientState,
    processCode: r.cost_centre_code ? String(r.cost_centre_code) : null,
    poNo: r.jcc_no ? String(r.jcc_no) : null,
    grnNo: r.grn ? String(r.grn) : null,
    hsnSacCode: String(r.sac_code ?? r.hsn_code ?? "").trim() || null,
    supplyType: null,
    gstType: r.gst_type ? String(r.gst_type) : null,
    gstRate: rate,
    taxableValue: taxable,
    igst,
    cgst,
    sgst,
    otherCharges: 0,
    roundOff: money(total - (taxable + igst + cgst + sgst)),
    invoiceValue: total,
    tallyHead: r.tally_head ? String(r.tally_head) : null,
    errors: [],
  };

  const interState = Boolean(row.branchStateCode && row.clientStateCode && row.branchStateCode !== row.clientStateCode);
  row.supplyType = classifySupply(applyGst, Boolean(clientGstin) && isValidGstin(clientGstin), interState, total);
  row.errors = validateRow(row);
  return row;
}
