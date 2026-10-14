/**
 * Legacy I-Spark "ADD PO", "Approve PO" and "ADD GRN" (Invoice menu).
 *
 * - ADD PO = the PO master (legacy po_number: branch, cost centre, period from/to, PO number,
 *   amount, balance). Invoices draw it down at Invoice Approval (approveInvoice).
 * - Approve PO = legacy tbl_invoice.approve_po = 'Yes' (56 invoices in FY 2026-27): finance
 *   confirms the PO on an invoice. Only for an invoice that carries PO numbers.
 * - ADD GRN = legacy tbl_invoice.grn / grn_date, entered after billing when the client's GRN
 *   arrives (the proforma screen keeps GRN locked). Allowed on a proforma or approved invoice.
 */
import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { round2 } from "./client-billing-tax.js";

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

export interface CreatePoInput {
  costCentreId: string;
  poNumber: string;
  periodFrom: string;
  periodTo: string;
  amount: number;
  userId: string;
}

async function createPo(input: CreatePoInput) {
  const poNumber = String(input.poNumber ?? "").trim();
  if (!poNumber || poNumber.length > 60) throw clientError("PO number is required (max 60 characters)");
  if (!DATE_RE.test(String(input.periodFrom)) || !DATE_RE.test(String(input.periodTo))) {
    throw clientError("Period from and to must be YYYY-MM-DD dates");
  }
  if (input.periodFrom > input.periodTo) throw clientError("Period from must be on or before period to");
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw clientError("PO amount must be greater than zero");
  return inTransaction(async (conn) => {
    const [cc] = await conn.execute<RowDataPacket[]>(`SELECT id FROM cost_centre_master WHERE id = ? LIMIT 1`, [input.costCentreId]);
    if (!cc[0]) throw clientError(`Cost centre ${input.costCentreId} not found`);
    const [dup] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM client_po_number WHERE cost_centre_id = ? AND po_number = ? LIMIT 1 FOR UPDATE`,
      [input.costCentreId, poNumber],
    );
    if (dup[0]) throw clientError(`PO ${poNumber} already exists for this cost centre`, 409);
    const id = randomUUID();
    await conn.execute(
      `INSERT INTO client_po_number (id, cost_centre_id, po_number, period_from, period_to, total_amount, balance_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.costCentreId, poNumber, input.periodFrom, input.periodTo, amount, amount],
    );
    return { id, poNumber };
  });
}

async function listPos(q: { costCentreId?: string; branchId?: string; companyName?: string; search?: string }) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (q.costCentreId) { conditions.push("po.cost_centre_id = ?"); params.push(q.costCentreId); }
  if (q.branchId) { conditions.push("cc.branch_id = ?"); params.push(q.branchId); }
  if (q.companyName) { conditions.push("cc.company_name = ?"); params.push(q.companyName); }
  if (q.search && q.search.trim()) { conditions.push("po.po_number LIKE ?"); params.push(`%${q.search.trim()}%`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT po.*, cc.cost_centre_code, b.branch_name,
            COALESCE(NULLIF(cc.billing_client_name, ''), cc.company_name) AS client_name
     FROM client_po_number po
     LEFT JOIN cost_centre_master cc ON cc.id = po.cost_centre_id
     LEFT JOIN branch_master b ON b.id = cc.branch_id
     ${where}
     ORDER BY po.created_at DESC, po.id DESC
     LIMIT 500`,
    params,
  );
  return rows;
}

async function lockLiveInvoice(conn: PoolConnection, invoiceId: string) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, invoice_status, is_migrated, po_numbers, po_approved FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
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

async function addGrn(invoiceId: string, input: { grnNo: string; grnDate?: string | null; userId: string }) {
  const grnNo = String(input.grnNo ?? "").trim();
  if (!grnNo || grnNo.length > 60) throw clientError("GRN number is required (max 60 characters)");
  const grnDate = input.grnDate ? String(input.grnDate) : null;
  if (grnDate && !DATE_RE.test(grnDate)) throw clientError("GRN date must be YYYY-MM-DD");
  return inTransaction(async (conn) => {
    await lockLiveInvoice(conn, invoiceId);
    await conn.execute(`UPDATE client_invoice SET grn_no = ?, grn_date = ? WHERE id = ?`, [grnNo, grnDate, invoiceId]);
    await conn.execute(
      `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, 'grn_added', ?, ?)`,
      [randomUUID(), invoiceId, input.userId, `${grnNo}${grnDate ? ` (${grnDate})` : ""}`],
    );
    return { id: invoiceId, grnNo, grnDate };
  });
}

export const clientBillingPoGrnService = { createPo, listPos, approvePo, addGrn };
