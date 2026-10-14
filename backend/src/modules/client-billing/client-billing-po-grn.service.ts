/**
 * Legacy I-Spark "ADD PO", "Approve PO" and "ADD GRN" (Invoice menu).
 *
 * - ADD PO moved to client-billing-po-master.service.ts (governed: particulars, document, audit).
 * - Approve PO = legacy tbl_invoice.approve_po = 'Yes' (56 invoices in FY 2026-27): finance
 *   confirms the PO on an invoice. Only for an invoice that carries PO numbers.
 * - ADD GRN = legacy tbl_invoice.grn / grn_date, entered after billing when the client's GRN
 *   arrives (the proforma screen keeps GRN locked). Allowed on a proforma or approved invoice.
 */
import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";

function clientError(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode });
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

async function lockLiveInvoice(conn: PoolConnection, invoiceId: string) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, invoice_status, is_migrated, po_numbers, po_approved, grn_no, grn_date FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
    [invoiceId],
  );
  const inv = rows[0];
  if (!inv) throw clientError(`Invoice ${invoiceId} not found`, 404);
  if (Number(inv.is_migrated) === 1) throw clientError("A migrated historical invoice cannot be changed here");
  if (inv.invoice_status === "rejected") throw clientError("A rejected / voided invoice cannot be changed");
  return inv;
}

async function approvePo(invoiceId: string, userId: string) {
  return inTransaction(async (conn) => {
    const inv = await lockLiveInvoice(conn, invoiceId);
    if (!String(inv.po_numbers ?? "").trim()) throw clientError("This invoice has no PO number to approve — add the PO first");
    if (Number(inv.po_approved) === 1) throw clientError("PO on this invoice is already approved");
    await conn.execute(
      `UPDATE client_invoice SET po_approved = 1, po_approved_by = ?, po_approved_at = NOW() WHERE id = ?`,
      [userId, invoiceId],
    );
    await conn.execute(
      `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, 'po_approved', ?, ?)`,
      [randomUUID(), invoiceId, userId, String(inv.po_numbers)],
    );
    return { id: invoiceId, poApproved: true };
  });
}

/**
 * ADD GRN. The first GRN on a bill is simply recorded. Replacing a GRN that is already there
 * (audit 2026-10-14 M6) needs a reason of at least 5 characters, and the log keeps before -> after.
 */
async function addGrn(invoiceId: string, input: { grnNo: string; grnDate?: string | null; reason?: string | null; userId: string }) {
  const grnNo = String(input.grnNo ?? "").trim();
  if (!grnNo || grnNo.length > 60) throw clientError("GRN number is required (max 60 characters)");
  const grnDate = input.grnDate ? String(input.grnDate) : null;
  if (grnDate && !DATE_RE.test(grnDate)) throw clientError("GRN date must be YYYY-MM-DD");
  const reason = String(input.reason ?? "").trim();
  return inTransaction(async (conn) => {
    const inv = await lockLiveInvoice(conn, invoiceId);
    const label = (no: unknown, date: unknown) => `${String(no ?? "").trim() || "—"}${date ? ` (${String(date).slice(0, 10)})` : ""}`;
    const before = String(inv.grn_no ?? "").trim();
    const replacing = before !== "";
    if (replacing) {
      if (before === grnNo && String(inv.grn_date ?? "").slice(0, 10) === String(grnDate ?? "")) {
        return { id: invoiceId, grnNo, grnDate, changed: false };
      }
      if (reason.length < 5) {
        throw clientError(`This bill already has GRN ${label(inv.grn_no, inv.grn_date)} — give a reason (at least 5 characters) to change it`);
      }
    }
    await conn.execute(`UPDATE client_invoice SET grn_no = ?, grn_date = ? WHERE id = ?`, [grnNo, grnDate, invoiceId]);
    await conn.execute(
      `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, ?, ?, ?)`,
      replacing
        ? [randomUUID(), invoiceId, "grn_changed", input.userId, `${label(inv.grn_no, inv.grn_date)} → ${label(grnNo, grnDate)}: ${reason}`.slice(0, 2000)]
        : [randomUUID(), invoiceId, "grn_added", input.userId, label(grnNo, grnDate)],
    );
    return { id: invoiceId, grnNo, grnDate, changed: true };
  });
}

export const clientBillingPoGrnService = { approvePo, addGrn };
