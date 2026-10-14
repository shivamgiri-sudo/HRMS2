/**
 * Proforma edit (header + lines) — legacy `edit_proforma` / `update_proforma`.
 *
 * Only a LIVE proforma (invoice_status = 'proforma', is_migrated = 0) is editable. The cost
 * centre is fixed (it determines the proforma number's state code and the bill-number
 * scope), everything else on the header and the whole line list can change. Amounts are
 * recomputed with the shared single-rounding-rule engine and the GST type is re-derived,
 * exactly as on create. An 'edited' audit row records what changed.
 */
import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  normaliseInvoiceType,
  resolveGstType,
  type CostCentreTaxRow,
} from "./client-billing.service.js";
import { clientBillingProvisionService } from "./client-billing-provision.service.js";
import {
  checkPoCoverage,
  normaliseReferences,
  parsePoNumbers,
  type InvoiceReferenceInput,
} from "./client-billing-po.js";
import {
  assertMonthLabelInFinanceYear,
  computeInvoiceAmounts,
} from "./client-billing-tax.js";

export interface EditLineInput {
  particulars: string;
  qty: number;
  rate: number;
  lineType?: "charge" | "deduction";
}

export interface UpdateProformaInput {
  invoiceId: string;
  userId: string;
  category?: string;
  financeYear?: string;
  monthLabel?: string;
  invoiceDate?: string;
  description?: string | null;
  applyGst?: boolean;
  applyTaxCalc?: boolean;
  invoiceType?: string | null;
  lines?: EditLineInput[];
  references?: InvoiceReferenceInput;
}

export interface UpdateProformaResult {
  id: string;
  totalAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  grandTotal: number;
  gstType: string;
  changed: string[];
}

function clientError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function validateLines(lines: EditLineInput[]): void {
  if (lines.length === 0)
    throw clientError("At least one line item is required");
  for (const line of lines) {
    if (!String(line.particulars ?? "").trim()) {
      throw clientError("Every line needs particulars");
    }
    if (!Number.isFinite(line.qty) || line.qty <= 0) {
      throw clientError("Line quantity must be greater than zero");
    }
    if (!Number.isFinite(line.rate) || line.rate < 0) {
      throw clientError("Line rate must be zero or more");
    }
  }
}

async function updateProforma(
  input: UpdateProformaInput,
): Promise<UpdateProformaResult> {
  if (input.lines) validateLines(input.lines);
  const refs = input.references ? normaliseReferences(input.references) : null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.invoiceId],
    );
    const invoice = rows[0];
    if (!invoice) throw clientError(`Invoice ${input.invoiceId} not found`);
    if (invoice.is_migrated) {
      throw clientError(
        `Invoice ${input.invoiceId} is a migrated historical record (is_migrated=1) and cannot be edited through the live workflow`,
      );
    }
    if (invoice.invoice_status !== "proforma") {
      throw clientError(
        `Only a proforma can be edited (currently: ${invoice.invoice_status}). Request a status change or void instead.`,
      );
    }

    const financeYear = input.financeYear ?? String(invoice.finance_year);
    const monthLabel = input.monthLabel ?? String(invoice.month_label);
    assertMonthLabelInFinanceYear(monthLabel, financeYear);
    const category = (input.category ?? String(invoice.category)).trim();
    if (!category || category.length > 50) {
      throw clientError("category is required (max 50 characters)");
    }
    const invoiceDate =
      input.invoiceDate ?? String(invoice.invoice_date).slice(0, 10);
    const description =
      input.description === undefined ? invoice.description : input.description;
    const applyGst = input.applyGst ?? Boolean(invoice.apply_gst);
    // Apply GST is the one tax switch on the form; Apply Tax Calculation follows it when GST is sent.
    const applyTaxCalc = input.applyTaxCalc ?? (input.applyGst !== undefined ? input.applyGst : Number(invoice.apply_tax_calc ?? 1) === 1);
    const invoiceType =
      input.invoiceType === undefined && invoice.invoice_type
        ? String(invoice.invoice_type)
        : normaliseInvoiceType(input.invoiceType);

    const [ccRows] = await conn.execute<RowDataPacket[]>(
      `SELECT cc.gst_type AS gstType, b.gst_state_code AS stateCode,
              cc.service_tax_no AS supplierGstin, cc.vendor_gst_no AS clientGstin,
              cc.vendor_state_code AS clientStateCode
       FROM cost_centre_master cc
       LEFT JOIN branch_master b ON b.id = cc.branch_id
       WHERE cc.id = ?`,
      [invoice.cost_centre_id],
    );
    const costCentre = ccRows[0] as CostCentreTaxRow | undefined;
    if (!costCentre) {
      throw clientError(
        `cost_centre_master ${invoice.cost_centre_id} not found`,
      );
    }
    const { gstType } = resolveGstType(
      String(invoice.cost_centre_id),
      costCentre,
    );

    let lines: EditLineInput[];
    if (input.lines) {
      lines = input.lines;
    } else {
      const [lineRows] = await conn.execute<RowDataPacket[]>(
        `SELECT line_type, particulars, qty, rate FROM client_invoice_line WHERE invoice_id = ? ORDER BY COALESCE(line_no, 2147483647), created_at, id`,
        [input.invoiceId],
      );
      lines = lineRows.map((l) => ({
        particulars: String(l.particulars),
        qty: Number(l.qty),
        rate: Number(l.rate),
        lineType: l.line_type as "charge" | "deduction",
      }));
      validateLines(lines);
    }

    const amounts = computeInvoiceAmounts(lines, gstType, applyTaxCalc && applyGst);

    const poNumbers = refs
      ? refs.poNumbers
      : parsePoNumbers(invoice.po_numbers);
    if (poNumbers.length > 0) {
      const coverage = await checkPoCoverage(
        {
          costCentreId: String(invoice.cost_centre_id),
          invoiceDate,
          grandTotal: amounts.grandTotal,
          poNumbers,
        },
        conn,
      );
      if (!coverage.ok) throw clientError(coverage.errors.join("; "));
    }

    const changed: string[] = [];
    const note = (label: string, before: unknown, after: unknown) => {
      if (String(before ?? "") !== String(after ?? "")) {
        changed.push(
          `${label}: ${String(before ?? "—")} → ${String(after ?? "—")}`,
        );
      }
    };
    note("category", invoice.category, category);
    note("financeYear", invoice.finance_year, financeYear);
    note("monthLabel", invoice.month_label, monthLabel);
    note("invoiceDate", String(invoice.invoice_date).slice(0, 10), invoiceDate);
    note("description", invoice.description, description);
    note("applyGst", invoice.apply_gst ? "yes" : "no", applyGst ? "yes" : "no");
    note("invoiceType", invoice.invoice_type, invoiceType);
    note("applyTaxCalc", Number(invoice.apply_tax_calc ?? 1) === 1 ? "yes" : "no", applyTaxCalc ? "yes" : "no");
    note("gstType", invoice.gst_type, gstType);
    note("total", Number(invoice.total_amount), amounts.totalAmount);
    note("grandTotal", Number(invoice.grand_total), amounts.grandTotal);
    if (input.lines) changed.push(`lines replaced (${input.lines.length})`);
    if (refs) {
      note("PO numbers", invoice.po_numbers, refs.poNumbers.join(",") || null);
      note("GRN", invoice.grn_no, refs.grnNo);
      note("JCC", invoice.jcc_no, refs.jccNo);
      note(
        "RCM",
        invoice.rcm_applicable ? "yes" : "no",
        refs.rcmApplicable ? "yes" : "no",
      );
    }

    await conn.execute<ResultSetHeader>(
      `UPDATE client_invoice
       SET category = ?, finance_year = ?, month_label = ?, invoice_date = ?, description = ?,
           gst_type = ?, apply_gst = ?, total_amount = ?, igst_amount = ?, cgst_amount = ?,
           sgst_amount = ?, grand_total = ?, invoice_type = ?, apply_tax_calc = ?,
           proforma_approved_by = NULL, proforma_approved_at = NULL
       WHERE id = ?`,
      [
        category,
        financeYear,
        monthLabel,
        invoiceDate,
        description ?? null,
        gstType,
        applyGst ? 1 : 0,
        amounts.totalAmount,
        amounts.igstAmount,
        amounts.cgstAmount,
        amounts.sgstAmount,
        amounts.grandTotal,
        invoiceType,
        applyTaxCalc ? 1 : 0,
        input.invoiceId,
      ],
    );
    // An edit after "Approve Proforma" sends it back for proforma approval — the approver
    // signed off on the old figures, not these.
    if (invoice.proforma_approved_at) {
      changed.push("proforma approval cleared (re-approval needed)");
    }

    if (refs) {
      await conn.execute<ResultSetHeader>(
        `UPDATE client_invoice
         SET po_numbers = ?, grn_no = ?, grn_date = ?, jcc_no = ?, jcc_date = ?, rcm_applicable = ?
         WHERE id = ?`,
        [
          refs.poNumbers.length > 0 ? refs.poNumbers.join(",") : null,
          refs.grnNo,
          refs.grnDate,
          refs.jccNo,
          refs.jccDate,
          refs.rcmApplicable ? 1 : 0,
          input.invoiceId,
        ],
      );
    }

    if (input.lines) {
      await conn.execute(
        `DELETE FROM client_invoice_line WHERE invoice_id = ?`,
        [input.invoiceId],
      );
      for (const [index, line] of input.lines.entries()) {
        await conn.execute(
          `INSERT INTO client_invoice_line (id, invoice_id, line_type, particulars, qty, rate, amount, line_no)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            input.invoiceId,
            line.lineType ?? "charge",
            line.particulars.trim(),
            line.qty,
            line.rate,
            amounts.lineAmounts[index],
            index + 1,
          ],
        );
      }
    }

    // Re-draw the provision: refunds the old draw, then draws the new taxable total from the
    // (possibly new) month's approved provision. Same rule as create.
    const drawdown = await clientBillingProvisionService.drawDownForInvoice(conn, {
      invoiceId: input.invoiceId,
      costCentreId: String(invoice.cost_centre_id),
      financeYear,
      monthLabel,
      amount: amounts.totalAmount,
    });
    if (drawdown.used > 0) changed.push(`provision used ${drawdown.used}`);

    await conn.execute(
      `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, 'edited', ?, ?)`,
      [
        randomUUID(),
        input.invoiceId,
        input.userId,
        changed.length > 0
          ? changed.join("; ").slice(0, 2000)
          : "no field changed",
      ],
    );

    await conn.commit();
    return {
      id: input.invoiceId,
      totalAmount: amounts.totalAmount,
      igstAmount: amounts.igstAmount,
      cgstAmount: amounts.cgstAmount,
      sgstAmount: amounts.sgstAmount,
      grandTotal: amounts.grandTotal,
      gstType,
      changed,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export const clientBillingEditService = { updateProforma };
