/**
 * Client credit notes (audit 2026-10-14 H2 / H3 / H4, M1, L3, L7).
 *
 *  - Lines are validated (particulars, qty > 0, rate >= 0, at least one line, total > 0).
 *  - The invoice is locked FOR UPDATE and must be a live (not migrated) APPROVED bill.
 *  - GST follows the bill: its stored gst_type, and no tax when the bill carried none
 *    (apply_gst / apply_tax_calc); amounts use the module's single rounding rule
 *    (computeInvoiceAmounts: paise lines, whole-rupee tax).
 *  - Cap: credit grand total <= bill grand total - settled (receipts, SETTLEMENT_SQL) - every other
 *    approved or draft credit note on the bill. Re-checked at approval, under the same locks.
 *  - A draft carries NO number; the credit number is minted at approval, so a rejected draft
 *    never burns one.
 *  - Maker-checker: the creator cannot approve. A draft can be rejected (reason required) —
 *    the creator may withdraw their own draft this way.
 *  - Every create / approve / reject is written to client_credit_note_audit.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { clientBillingNumberingService } from "./client-billing-numbering.service.js";
import {
  assertMonthLabelInFinanceYear,
  computeInvoiceAmounts,
  fromPaise,
  toPaise,
  type GstType,
} from "./client-billing-tax.js";
import { assertDateInFinanceYear } from "./client-billing-validation.js";
import { SETTLEMENT_SQL } from "./client-billing-receipt.service.js";

export interface CreditNoteLineInput {
  particulars: string;
  qty: number;
  rate: number;
}

export interface CreateCreditNoteInput {
  invoiceId: string;
  category: string;
  financeYear: string;
  monthLabel: string;
  creditDate: string;
  description?: string;
  applyGst?: boolean;
  lines: CreditNoteLineInput[];
  userId: string;
}

export interface CreditNoteResult {
  id: string;
  creditNo: string | null;
  totalAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  grandTotal: number;
  creditStatus: "draft" | "approved" | "rejected";
}

export interface ApproveCreditNoteInput {
  creditNoteId: string;
  userId: string;
}

export interface RejectCreditNoteInput {
  creditNoteId: string;
  reason: string;
  userId: string;
}

type PoolConnection = Awaited<ReturnType<typeof db.getConnection>>;

function clientError(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode });
}

const rupees = (p: number) => fromPaise(p).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Validates and trims the line list (H2). */
export function normaliseCreditLines(lines: unknown): CreditNoteLineInput[] {
  if (!Array.isArray(lines) || lines.length === 0) throw clientError("At least one line item is required");
  if (lines.length > 50) throw clientError("A credit note can have at most 50 lines");
  return lines.map((l: Partial<CreditNoteLineInput>, i) => {
    const particulars = String(l?.particulars ?? "").trim();
    const qty = Number(l?.qty);
    const rate = Number(l?.rate);
    if (!particulars) throw clientError(`Line ${i + 1}: particulars are required`);
    if (particulars.length > 255) throw clientError(`Line ${i + 1}: particulars are at most 255 characters`);
    if (!Number.isFinite(qty) || qty <= 0) throw clientError(`Line ${i + 1}: quantity must be greater than zero`);
    if (!Number.isFinite(rate) || rate < 0) throw clientError(`Line ${i + 1}: rate must be zero or more`);
    return { particulars, qty, rate };
  });
}

async function audit(conn: PoolConnection, creditNoteId: string, invoiceId: string | null, action: string, actorId: string, reason: string | null) {
  await conn.execute(
    `INSERT INTO client_credit_note_audit (id, credit_note_id, invoice_id, action, actor_id, reason) VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), creditNoteId, invoiceId, action, actorId, reason ? reason.slice(0, 2000) : null],
  );
}

/**
 * What can still be credited on a bill, in paise: grand total - settled - other draft / approved
 * credit notes (excluding `exceptCreditNoteId`). Caller holds the invoice lock.
 */
async function creditableBalancePaise(conn: PoolConnection, invoiceId: string, grandTotal: unknown, exceptCreditNoteId: string | null) {
  const [settledRows] = await conn.execute<RowDataPacket[]>(
    `SELECT COALESCE(s.settled, 0) AS settled FROM (${SETTLEMENT_SQL}) s WHERE s.invoice_id = ?`,
    [invoiceId],
  );
  const [creditRows] = await conn.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(grand_total), 0) AS credited FROM client_credit_note
     WHERE invoice_id = ? AND credit_status IN ('draft', 'approved') AND id <> ?`,
    [invoiceId, exceptCreditNoteId ?? ""],
  );
  const settled = toPaise(Number(settledRows[0]?.settled ?? 0));
  const credited = toPaise(Number(creditRows[0]?.credited ?? 0));
  return { available: toPaise(Number(grandTotal ?? 0)) - settled - credited, settled, credited };
}

function assertWithinCap(grandPaise: number, cap: { available: number; settled: number; credited: number }) {
  if (grandPaise > cap.available) {
    throw clientError(
      `Credit note ₹${rupees(grandPaise)} is more than what can still be credited on this bill (₹${rupees(Math.max(0, cap.available))}: bill total less ₹${rupees(cap.settled)} received / TDS / deductions and ₹${rupees(cap.credited)} in other credit notes)`,
    );
  }
}

async function lockLiveApprovedInvoice(conn: PoolConnection, invoiceId: string) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, invoice_status, cost_centre_id, finance_year, is_migrated, gst_type, apply_gst, apply_tax_calc, grand_total
     FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
    [invoiceId],
  );
  const invoice = rows[0];
  if (!invoice) throw clientError(`Invoice ${invoiceId} not found`, 404);
  // design §3: a migrated historical invoice is read-only — the live workflow never attaches a NEW
  // credit note to it (historical ones came in through the cutover load).
  if (Number(invoice.is_migrated) === 1) {
    throw clientError(`Invoice ${invoiceId} is a migrated historical record (is_migrated=1) — a new credit note cannot be issued against it through the live workflow`);
  }
  if (invoice.invoice_status !== "approved") {
    throw clientError(`Invoice ${invoiceId} is not approved (currently: ${invoice.invoice_status}) — a credit note can only be issued against an approved invoice`);
  }
  return invoice;
}

async function inTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function createCreditNote(input: CreateCreditNoteInput): Promise<CreditNoteResult> {
  const lines = normaliseCreditLines(input.lines);
  assertMonthLabelInFinanceYear(input.monthLabel, input.financeYear);
  assertDateInFinanceYear(input.creditDate, input.financeYear, "Credit date");
  const category = String(input.category ?? "").trim();
  if (!category || category.length > 50) throw clientError("category is required (max 50 characters)");
  const description = String(input.description ?? "").trim() || null;
  if (description && description.length > 255) throw clientError("Description is at most 255 characters");

  const creditNoteId = randomUUID();
  return inTransaction(async (conn) => {
    const invoice = await lockLiveApprovedInvoice(conn, input.invoiceId);

    const [costCentreRows] = await conn.execute<RowDataPacket[]>(
      `SELECT cc.tally_head AS tallyHead, cc.billing_client_name AS clientTallyName
       FROM cost_centre_master cc WHERE cc.id = ?`,
      [invoice.cost_centre_id],
    );
    const costCentre = costCentreRows[0] as { tallyHead: string | null; clientTallyName: string | null } | undefined;

    // GST follows the bill (H4): its stored type, and no tax when the bill was raised without it.
    const gstType: GstType = invoice.gst_type === "Intrastate" ? "Intrastate" : "Integrated";
    const billTaxed = Number(invoice.apply_gst ?? 1) === 1 && Number(invoice.apply_tax_calc ?? 1) === 1;
    const applyGst = billTaxed && (input.applyGst ?? true);
    const amounts = computeInvoiceAmounts(lines, gstType, applyGst);
    const grandPaise = toPaise(amounts.grandTotal);
    if (toPaise(amounts.totalAmount) <= 0) throw clientError("The credit note total must be greater than zero");

    assertWithinCap(grandPaise, await creditableBalancePaise(conn, input.invoiceId, invoice.grand_total, null));

    await conn.execute(
      `INSERT INTO client_credit_note
         (id, invoice_id, cost_centre_id, category, finance_year, month_label, credit_date,
          description, credit_no, credit_status, gst_type, apply_gst, total_amount, igst_amount,
          cgst_amount, sgst_amount, grand_total, created_by, tally_head, client_tally_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        creditNoteId, input.invoiceId, invoice.cost_centre_id, category, input.financeYear,
        input.monthLabel, input.creditDate, description, gstType,
        applyGst ? 1 : 0, amounts.totalAmount, amounts.igstAmount, amounts.cgstAmount, amounts.sgstAmount,
        amounts.grandTotal, input.userId,
        // Legacy tbl_credit_note never had TallyHead / client_tally_name — resolved live here.
        costCentre?.tallyHead ?? null, costCentre?.clientTallyName ?? null,
      ],
    );
    for (const [i, line] of lines.entries()) {
      await conn.execute(
        `INSERT INTO client_credit_note_line (id, credit_note_id, particulars, qty, rate, amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), creditNoteId, line.particulars, line.qty, line.rate, amounts.lineAmounts[i]],
      );
    }
    await audit(conn, creditNoteId, input.invoiceId, "created", input.userId, `₹${rupees(grandPaise)}, ${lines.length} line(s)`);
    return {
      id: creditNoteId, creditNo: null, totalAmount: amounts.totalAmount, igstAmount: amounts.igstAmount,
      cgstAmount: amounts.cgstAmount, sgstAmount: amounts.sgstAmount, grandTotal: amounts.grandTotal, creditStatus: "draft",
    };
  });
}

async function lockDraft(conn: PoolConnection, creditNoteId: string, verb: "approved" | "rejected") {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, invoice_id, cost_centre_id, finance_year, credit_status, credit_no, created_by, is_migrated,
            total_amount, igst_amount, cgst_amount, sgst_amount, grand_total
     FROM client_credit_note WHERE id = ? LIMIT 1 FOR UPDATE`,
    [creditNoteId],
  );
  const cn = rows[0];
  if (!cn) throw clientError(`Credit note ${creditNoteId} not found`, 404);
  // design §3: a migrated historical credit note is read-only through the live workflow.
  if (Number(cn.is_migrated) === 1) {
    throw clientError(`Credit note ${creditNoteId} is a migrated historical record (is_migrated=1) and cannot be ${verb} through the live workflow`);
  }
  if (cn.credit_status === "approved") throw clientError(`Credit note ${creditNoteId} is already approved`);
  if (cn.credit_status === "rejected") throw clientError(`Credit note ${creditNoteId} is already rejected`);
  return cn;
}

const toResult = (cn: RowDataPacket, creditNo: string | null, status: CreditNoteResult["creditStatus"]): CreditNoteResult => ({
  id: String(cn.id), creditNo, totalAmount: Number(cn.total_amount), igstAmount: Number(cn.igst_amount),
  cgstAmount: Number(cn.cgst_amount), sgstAmount: Number(cn.sgst_amount), grandTotal: Number(cn.grand_total),
  creditStatus: status,
});

async function approveCreditNote(input: ApproveCreditNoteInput): Promise<CreditNoteResult> {
  return inTransaction(async (conn) => {
    const cn = await lockDraft(conn, input.creditNoteId, "approved");
    if (cn.created_by && String(cn.created_by) === String(input.userId)) {
      throw clientError("You created this credit note — another approver must approve it", 403);
    }
    const invoice = await lockLiveApprovedInvoice(conn, String(cn.invoice_id));
    assertWithinCap(toPaise(Number(cn.grand_total)), await creditableBalancePaise(conn, String(cn.invoice_id), invoice.grand_total, String(cn.id)));

    const [ccRows] = await conn.execute<RowDataPacket[]>(
      `SELECT cc.company_name AS companyName, b.gst_state_code AS stateCode
       FROM cost_centre_master cc LEFT JOIN branch_master b ON b.id = cc.branch_id WHERE cc.id = ?`,
      [cn.cost_centre_id],
    );
    const cc = ccRows[0] as { companyName: string; stateCode: string | null } | undefined;
    if (!cc?.stateCode) throw clientError(`Cost centre ${cn.cost_centre_id} has no branch GST state code — cannot mint a credit note number`);
    // Numbered at approval (H11), so a rejected draft never burns a number.
    const creditNo = await clientBillingNumberingService.mintCreditNoteNumber(cc.stateCode, cc.companyName, String(cn.finance_year), conn);

    await conn.execute(
      `UPDATE client_credit_note SET credit_status = 'approved', credit_no = ?, approved_by = ?, approved_at = NOW() WHERE id = ?`,
      [creditNo, input.userId, input.creditNoteId],
    );
    await audit(conn, String(cn.id), String(cn.invoice_id), "approved", input.userId, creditNo);
    return toResult(cn, creditNo, "approved");
  });
}

async function rejectCreditNote(input: RejectCreditNoteInput): Promise<CreditNoteResult> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 5) throw clientError("A reason of at least 5 characters is required");
  return inTransaction(async (conn) => {
    const cn = await lockDraft(conn, input.creditNoteId, "rejected");
    await conn.execute(
      `UPDATE client_credit_note SET credit_status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejected_reason = ? WHERE id = ?`,
      [input.userId, reason.slice(0, 500), input.creditNoteId],
    );
    await audit(conn, String(cn.id), String(cn.invoice_id), "rejected", input.userId, reason);
    return toResult(cn, null, "rejected");
  });
}

export const clientBillingCreditNoteService = { createCreditNote, approveCreditNote, rejectCreditNote };
