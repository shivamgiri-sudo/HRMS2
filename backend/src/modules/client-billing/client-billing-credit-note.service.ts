import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { clientBillingNumberingService } from "./client-billing-numbering.service.js";

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
  creditStatus: "draft" | "approved";
}

export interface ApproveCreditNoteInput {
  creditNoteId: string;
  userId: string;
}

function clientError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeGst(baseAmount: number, gstType: string, applyGst: boolean) {
  if (!applyGst) return { igst: 0, cgst: 0, sgst: 0 };
  if (gstType === "Integrated") {
    return { igst: round2(baseAmount * 0.18), cgst: 0, sgst: 0 };
  }
  const half = round2(baseAmount * 0.09);
  return { igst: 0, cgst: half, sgst: half };
}

async function createCreditNote(input: CreateCreditNoteInput): Promise<CreditNoteResult> {
  if (input.lines.length === 0) {
    throw clientError("At least one line item is required");
  }

  const conn = await db.getConnection();
  const creditNoteId = randomUUID();
  try {
    await conn.beginTransaction();

    const [invoiceRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, invoice_status, cost_centre_id, finance_year, is_migrated FROM client_invoice WHERE id = ? LIMIT 1`,
      [input.invoiceId]
    );
    const invoice = invoiceRows[0] as
      | { id: string; invoice_status: string; cost_centre_id: string; finance_year: string; is_migrated: number }
      | undefined;
    if (!invoice) {
      throw clientError(`Invoice ${input.invoiceId} not found`);
    }
    // design §3: a migrated historical invoice is a read-only record — the live
    // create-credit-note workflow must never attach a NEW credit note to it (that
    // is what the cutover's own load.ts does directly, via A4's proforma_bill_no
    // matching, for genuinely historical credit notes — this guard is only about
    // the live UI/API path issuing a brand-new one going forward).
    if (invoice.is_migrated) {
      throw clientError(`Invoice ${input.invoiceId} is a migrated historical record (is_migrated=1) — a new credit note cannot be issued against it through the live workflow`);
    }
    if (invoice.invoice_status !== "approved") {
      throw clientError(`Invoice ${input.invoiceId} is not approved (currently: ${invoice.invoice_status}) — a credit note can only be issued against an approved invoice`);
    }

    const [costCentreRows] = await conn.execute<RowDataPacket[]>(
      `SELECT cc.company_name AS companyName, cc.gst_type AS gstType, b.gst_state_code AS stateCode,
              cc.tally_head AS tallyHead, cc.billing_client_name AS clientTallyName
       FROM cost_centre_master cc
       LEFT JOIN branch_master b ON b.id = cc.branch_id
       WHERE cc.id = ?`,
      [invoice.cost_centre_id]
    );
    const costCentre = costCentreRows[0] as {
      companyName: string; gstType: string; stateCode: string | null;
      tallyHead: string | null; clientTallyName: string | null;
    } | undefined;
    if (!costCentre || !costCentre.stateCode) {
      throw clientError(`Cost centre ${invoice.cost_centre_id} has no branch GST state code — cannot mint a credit note number`);
    }

    const applyGst = input.applyGst ?? true;
    const totalAmount = round2(input.lines.reduce((sum, line) => sum + round2(line.qty * line.rate), 0));
    const { igst, cgst, sgst } = computeGst(totalAmount, costCentre.gstType, applyGst);
    const grandTotal = round2(totalAmount + igst + cgst + sgst);

    const creditNo = await clientBillingNumberingService.mintCreditNoteNumber(
      costCentre.stateCode, costCentre.companyName, input.financeYear, conn
    );

    await conn.execute(
      `INSERT INTO client_credit_note
         (id, invoice_id, cost_centre_id, category, finance_year, month_label, credit_date,
          description, credit_no, credit_status, gst_type, apply_gst, total_amount, igst_amount,
          cgst_amount, sgst_amount, grand_total, created_by, tally_head, client_tally_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        creditNoteId, input.invoiceId, invoice.cost_centre_id, input.category, input.financeYear,
        input.monthLabel, input.creditDate, input.description ?? null, creditNo, costCentre.gstType,
        applyGst ? 1 : 0, totalAmount, igst, cgst, sgst, grandTotal, input.userId,
        // Legacy tbl_credit_note never had a TallyHead/client_tally_name column at all — this
        // is new coverage, resolved live from cost_centre_master (no historical snapshot to
        // match, unlike client_invoice's backfill from the cutover's own staging data).
        costCentre.tallyHead ?? null, costCentre.clientTallyName ?? null,
      ]
    );

    for (const line of input.lines) {
      await conn.execute(
        `INSERT INTO client_credit_note_line (id, credit_note_id, particulars, qty, rate, amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), creditNoteId, line.particulars, line.qty, line.rate, round2(line.qty * line.rate)]
      );
    }

    await conn.commit();
    return { id: creditNoteId, creditNo, totalAmount, igstAmount: igst, cgstAmount: cgst, sgstAmount: sgst, grandTotal, creditStatus: "draft" };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function approveCreditNote(input: ApproveCreditNoteInput): Promise<CreditNoteResult> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, credit_status, credit_no, total_amount, igst_amount, cgst_amount, sgst_amount, grand_total, is_migrated
       FROM client_credit_note WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.creditNoteId]
    );
    const creditNote = rows[0] as
      | {
          id: string; credit_status: string; credit_no: string; total_amount: number; igst_amount: number;
          cgst_amount: number; sgst_amount: number; grand_total: number; is_migrated: number;
        }
      | undefined;
    if (!creditNote) {
      throw clientError(`Credit note ${input.creditNoteId} not found`);
    }
    // design §3: a migrated historical credit note is read-only through the live workflow.
    if (creditNote.is_migrated) {
      throw clientError(`Credit note ${input.creditNoteId} is a migrated historical record (is_migrated=1) and cannot be approved through the live workflow`);
    }
    if (creditNote.credit_status === "approved") {
      throw clientError(`Credit note ${input.creditNoteId} is already approved`);
    }

    await conn.execute(
      `UPDATE client_credit_note SET credit_status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`,
      [input.userId, input.creditNoteId]
    );

    await conn.commit();
    return {
      id: creditNote.id, creditNo: creditNote.credit_no, totalAmount: Number(creditNote.total_amount),
      igstAmount: Number(creditNote.igst_amount), cgstAmount: Number(creditNote.cgst_amount),
      sgstAmount: Number(creditNote.sgst_amount), grandTotal: Number(creditNote.grand_total),
      creditStatus: "approved",
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export const clientBillingCreditNoteService = { createCreditNote, approveCreditNote };
