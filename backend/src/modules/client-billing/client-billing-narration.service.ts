// backend/src/modules/client-billing/client-billing-narration.service.ts
/**
 * Narration and particulars can be corrected at every stage — proforma, waiting for the bill
 * number, and after billing — but the invoice total can never move (owner feedback 2026-10-14:
 * "At every stage narration can be edited, particulars can be added, but the total amount of
 * that invoice can't be different, it should match the total amount").
 *
 * The new lines must add up (charges − deductions, to the paisa) to the stored taxable total,
 * so tax, grand total, provision draw-down, PO consumption and the bill number are untouched,
 * and an approval already given stays valid. Migrated (I-Spark) and rejected bills are not
 * editable. Every change is written to the invoice audit log.
 *
 * Owner decision (audit 2026-10-14): narration stays editable at every stage, but particulars on
 * an APPROVED bill only until it has gone out — sent to the client (last_sent_at, or a successful
 * client_invoice_submission) or exported to Tally (tally_voucher_export). After that the client /
 * Tally hold the printed lines, so particulars are refused (narration still saves).
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { computeInvoiceAmounts, toPaise, type GstType } from "./client-billing-tax.js";

export interface NarrationLineInput {
  particulars: string;
  qty: number;
  rate: number;
  lineType?: "charge" | "deduction";
}

export interface UpdateNarrationInput {
  invoiceId: string;
  userId: string;
  description?: string | null;
  lines?: NarrationLineInput[];
}

function clientError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

const EDITABLE = new Set(["proforma", "approved"]);

type Executor = { execute: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]> };

/** Why an approved bill's particulars are frozen ("sent to the client" / "exported to Tally"), or null. */
export async function billHasGoneOut(conn: Executor, invoiceId: string, lastSentAt: unknown): Promise<string | null> {
  if (lastSentAt) return "sent to the client";
  const [sent] = await conn.execute(
    `SELECT 1 AS present FROM client_invoice_submission WHERE invoice_id = ? AND send_status = 'sent' LIMIT 1`,
    [invoiceId],
  );
  if (Array.isArray(sent) && sent.length > 0) return "sent to the client";
  const [exported] = await conn.execute(
    `SELECT 1 AS present FROM tally_voucher_export WHERE source_type = 'invoice' AND source_id = ? LIMIT 1`,
    [invoiceId],
  );
  if (Array.isArray(exported) && exported.length > 0) return "exported to Tally";
  return null;
}
const rupees = (p: number) => (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function updateNarration(input: UpdateNarrationInput) {
  if (input.description === undefined && input.lines === undefined) throw clientError("Nothing to change");
  const description = input.description === undefined ? undefined : String(input.description ?? "").trim() || null;
  if (description && description.length > 255) throw clientError("Narration is at most 255 characters");
  const lines = input.lines?.map((l) => ({
    particulars: String(l.particulars ?? "").trim(),
    qty: Number(l.qty),
    rate: Number(l.rate),
    lineType: l.lineType === "deduction" ? ("deduction" as const) : ("charge" as const),
  }));
  if (lines) {
    if (!lines.some((l) => l.lineType === "charge")) throw clientError("At least one particular is required");
    for (const l of lines) {
      if (!l.particulars) throw clientError("Every line needs particulars");
      if (l.particulars.length > 255) throw clientError("Particulars are at most 255 characters");
      if (!Number.isFinite(l.qty) || l.qty <= 0) throw clientError("Line quantity must be greater than zero");
      if (!Number.isFinite(l.rate) || l.rate < 0) throw clientError("Line rate must be zero or more");
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, invoice_status, is_migrated, description, total_amount, gst_type, last_sent_at FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.invoiceId],
    );
    const inv = rows[0];
    if (!inv) throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
    if (Number(inv.is_migrated) === 1) throw clientError("I-Spark (migrated) bills cannot be edited here");
    if (!EDITABLE.has(String(inv.invoice_status))) throw clientError(`A ${inv.invoice_status} invoice cannot be edited`);
    if (lines && inv.invoice_status === "approved") {
      const gone = await billHasGoneOut(conn, input.invoiceId, inv.last_sent_at);
      if (gone) {
        throw clientError(
          `Particulars can no longer be changed: this bill has already been ${gone}. Only the narration can still be edited.`,
        );
      }
    }

    const changed: string[] = [];
    let lineAmounts: number[] = [];
    if (lines) {
      const amounts = computeInvoiceAmounts(lines, (inv.gst_type as GstType) ?? "Integrated", false);
      const want = toPaise(Number(inv.total_amount));
      const got = toPaise(amounts.totalAmount);
      if (got !== want) {
        throw clientError(
          `Particulars add up to ₹${rupees(got)} but the invoice total is ₹${rupees(want)}. The total cannot change — adjust qty / rate so they match (difference ₹${rupees(got - want)}).`,
        );
      }
      lineAmounts = amounts.lineAmounts;
      const [old] = await conn.execute<RowDataPacket[]>(
        `SELECT line_type, particulars, qty, rate FROM client_invoice_line WHERE invoice_id = ? ORDER BY COALESCE(line_no, 2147483647), created_at, id`,
        [input.invoiceId],
      );
      const sig = (ls: Array<{ line_type?: unknown; lineType?: unknown; particulars: unknown; qty: unknown; rate: unknown }>) =>
        ls.map((l) => `${l.line_type ?? l.lineType}|${String(l.particulars).trim()}|${Number(l.qty)}|${Number(l.rate)}`).join("\n");
      if (sig(old as never) !== sig(lines)) changed.push(`particulars: ${old.length} line(s) → ${lines.length} line(s), total unchanged ₹${rupees(want)}`);
    }
    if (description !== undefined && String(inv.description ?? "") !== String(description ?? "")) {
      changed.push(`narration: ${String(inv.description ?? "—")} → ${description ?? "—"}`);
    }
    if (!changed.length) {
      await conn.rollback();
      return { id: input.invoiceId, changed };
    }

    if (description !== undefined) {
      await conn.execute(`UPDATE client_invoice SET description = ? WHERE id = ?`, [description, input.invoiceId]);
    }
    if (lines) {
      await conn.execute(`DELETE FROM client_invoice_line WHERE invoice_id = ?`, [input.invoiceId]);
      for (const [i, l] of lines.entries()) {
        await conn.execute(
          `INSERT INTO client_invoice_line (id, invoice_id, line_type, particulars, qty, rate, amount, line_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), input.invoiceId, l.lineType, l.particulars, l.qty, l.rate, lineAmounts[i], i + 1],
        );
      }
    }
    await conn.execute(
      `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, 'edited', ?, ?)`,
      [randomUUID(), input.invoiceId, input.userId, `[${inv.invoice_status}] ${changed.join("; ")}`.slice(0, 2000)],
    );
    await conn.commit();
    return { id: input.invoiceId, changed };
  } catch (e) {
    try { await conn.rollback(); } catch { /* connection already gone */ }
    throw e;
  } finally {
    conn.release();
  }
}

export const clientBillingNarrationService = { updateNarration };
