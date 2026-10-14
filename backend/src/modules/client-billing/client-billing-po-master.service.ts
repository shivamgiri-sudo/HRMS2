// backend/src/modules/client-billing/client-billing-po-master.service.ts
/**
 * Client PO master, governed (owner feedback 2026-10-14, items 9-13):
 *  - A PO is built from particulars with qty x rate; its amount is their sum (paise-exact).
 *  - The PO number is free text: digits, letters or both, any format (no commas — invoices
 *    store their POs comma-separated).
 *  - A PDF / Word copy of the PO is required when it is created.
 *  - Period, particulars / amount, number, remarks and the document can be edited, but never
 *    below what bills have already drawn, never to a period that excludes a bill already drawn
 *    on it, and the number only while nothing references it. Every create / edit is audited.
 *  - The PO report shows amount, drawn, balance, utilisation and period status; each PO opens
 *    every invoice on it (drawn at billing, plus proformas still waiting that quote it).
 *  - Maker-checker (audit 2026-10-14): a NEW PO and any amount INCREASE start 'pending' and must be
 *    approved by someone other than the person who created / edited it. Pending and rejected POs
 *    are not offered to invoices and fail the coverage check. An edit that brings the amount back
 *    within the last approved amount returns the PO to 'approved' without a new approval.
 * Invoices are governed by client-billing-po.ts (create / edit) and approveInvoice (under locks).
 */
import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { ownCompanyCostCentreSql } from "../../shared/ownCompanyCostCentre.js";
import { fromPaise, toPaise as taxToPaise } from "./client-billing-tax.js";

function clientError(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode });
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Paise-safe (L7): the module's single rounding rule.
const toPaise = (n: unknown) => taxToPaise(Number(n ?? 0) || 0);
const rupees = (p: number) => fromPaise(Math.round(p));
const fmt = (p: number) => (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PoLineInput { particulars: string; qty: number; rate: number }
export interface PoAttachment { path: string; name: string; mime: string }

/** PO number: any letters / digits / symbols a client uses, but no comma (the invoice list separator). */
export function normalisePoNumber(raw: unknown): string {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) throw clientError("PO number is required");
  if (s.length > 60) throw clientError("PO number is at most 60 characters");
  if (s.includes(",")) throw clientError("PO number cannot contain a comma");
  if (/[\u0000-\u001f]/.test(s)) throw clientError("PO number has an invalid character");
  return s;
}

export function normaliseLines(lines: unknown): Array<PoLineInput & { amountPaise: number }> {
  if (!Array.isArray(lines) || lines.length === 0) throw clientError("Add at least one PO particular with qty and rate");
  if (lines.length > 50) throw clientError("A PO can have at most 50 particulars");
  return lines.map((l: Partial<PoLineInput>, i) => {
    const particulars = String(l?.particulars ?? "").trim();
    const qty = Number(l?.qty);
    const rate = Number(l?.rate);
    if (!particulars) throw clientError(`Particular ${i + 1}: description is required`);
    if (particulars.length > 255) throw clientError(`Particular ${i + 1}: at most 255 characters`);
    if (!Number.isFinite(qty) || qty <= 0) throw clientError(`Particular ${i + 1}: qty must be greater than zero`);
    if (!Number.isFinite(rate) || rate < 0) throw clientError(`Particular ${i + 1}: rate must be zero or more`);
    const twoDecimals = (n: number) => Math.abs(taxToPaise(n) - n * 100) < 1e-6;
    if (!twoDecimals(qty) || !twoDecimals(rate)) {
      throw clientError(`Particular ${i + 1}: qty and rate take at most 2 decimals`);
    }
    return { particulars, qty, rate, amountPaise: taxToPaise(qty * rate) };
  });
}

function assertPeriod(from: unknown, to: unknown) {
  if (!DATE_RE.test(String(from)) || !DATE_RE.test(String(to))) throw clientError("Period from and to must be dates (YYYY-MM-DD)");
  if (String(from) > String(to)) throw clientError("Period from must be on or before period to");
}

async function inTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function writeLines(conn: PoolConnection, poId: string, lines: ReturnType<typeof normaliseLines>) {
  await conn.execute(`DELETE FROM client_po_line WHERE po_id = ?`, [poId]);
  for (const [i, l] of lines.entries()) {
    await conn.execute(
      `INSERT INTO client_po_line (id, po_id, line_no, particulars, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), poId, i + 1, l.particulars, l.qty, l.rate, rupees(l.amountPaise)],
    );
  }
}

async function audit(conn: PoolConnection, poId: string, action: string, actorId: string, changes: string) {
  await conn.execute(
    `INSERT INTO client_po_audit (id, po_id, action, actor_id, changes) VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), poId, action, actorId, changes.slice(0, 2000)],
  );
}

export interface CreatePoInput {
  costCentreId: string;
  poNumber: string;
  periodFrom: string;
  periodTo: string;
  lines: PoLineInput[];
  remarks?: string | null;
  attachment: PoAttachment | null;
  userId: string;
}

async function createPo(input: CreatePoInput) {
  const poNumber = normalisePoNumber(input.poNumber);
  assertPeriod(input.periodFrom, input.periodTo);
  const lines = normaliseLines(input.lines);
  const totalPaise = lines.reduce((s, l) => s + l.amountPaise, 0);
  if (totalPaise <= 0) throw clientError("PO amount must be greater than zero");
  const doc = input.attachment;
  if (!doc) throw clientError("Attach the PO document — a PDF or Word (.doc / .docx) file up to 20 MB is required");
  const remarks = String(input.remarks ?? "").trim().slice(0, 500) || null;
  return inTransaction(async (conn) => {
    const [cc] = await conn.execute<RowDataPacket[]>(`SELECT id FROM cost_centre_master WHERE id = ? LIMIT 1`, [input.costCentreId]);
    if (!cc[0]) throw clientError("Cost centre not found");
    const [dup] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM client_po_number WHERE cost_centre_id = ? AND po_number = ? LIMIT 1 FOR UPDATE`,
      [input.costCentreId, poNumber],
    );
    if (dup[0]) throw clientError(`PO ${poNumber} already exists for this cost centre`, 409);
    const id = randomUUID();
    const amount = rupees(totalPaise);
    await conn.execute(
      `INSERT INTO client_po_number (id, cost_centre_id, po_number, period_from, period_to, total_amount, balance_amount,
         attachment_path, attachment_name, attachment_mime, remarks, created_by,
         approval_status, approved_amount, approval_requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
      [id, input.costCentreId, poNumber, input.periodFrom, input.periodTo, amount, amount,
        doc.path, doc.name, doc.mime, remarks, input.userId, input.userId],
    );
    await writeLines(conn, id, lines);
    await audit(conn, id, "created", input.userId, `PO ${poNumber}, ${input.periodFrom} to ${input.periodTo}, ₹${fmt(totalPaise)}, ${lines.length} particular(s) — waiting for approval`);
    return { id, poNumber, amount, approvalStatus: "pending" as const };
  });
}

export interface UpdatePoInput {
  id: string;
  poNumber?: string;
  periodFrom?: string;
  periodTo?: string;
  lines?: PoLineInput[];
  remarks?: string | null;
  attachment?: PoAttachment | null;
  userId: string;
}

async function updatePo(input: UpdatePoInput) {
  return inTransaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(`SELECT * FROM client_po_number WHERE id = ? LIMIT 1 FOR UPDATE`, [input.id]);
    const po = rows[0];
    if (!po) throw clientError("PO not found", 404);
    const changes: string[] = [];
    const note = (label: string, a: unknown, b: unknown) => { if (String(a ?? "") !== String(b ?? "")) changes.push(`${label}: ${a ?? "—"} → ${b ?? "—"}`); };

    const drawnPaise = toPaise(po.total_amount) - toPaise(po.balance_amount);
    const [drawRows] = await conn.execute<RowDataPacket[]>(
      `SELECT ci.bill_no, ci.invoice_date FROM client_po_particular pp JOIN client_invoice ci ON ci.id = pp.invoice_id
       WHERE pp.po_id = ? AND ci.invoice_status = 'approved'`,
      [input.id],
    );
    const [quoting] = await conn.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM client_invoice WHERE cost_centre_id = ? AND invoice_status IN ('proforma', 'approved')
         AND FIND_IN_SET(?, REPLACE(COALESCE(po_numbers, ''), ', ', ',')) > 0`,
      [po.cost_centre_id, po.po_number],
    );

    let poNumber = String(po.po_number);
    if (input.poNumber !== undefined) {
      poNumber = normalisePoNumber(input.poNumber);
      if (poNumber !== po.po_number) {
        if (drawRows.length || Number(quoting[0]?.n ?? 0) > 0) {
          throw clientError(`PO ${po.po_number} is already used on invoices — its number cannot change`);
        }
        const [dup] = await conn.execute<RowDataPacket[]>(
          `SELECT id FROM client_po_number WHERE cost_centre_id = ? AND po_number = ? AND id <> ? LIMIT 1`,
          [po.cost_centre_id, poNumber, input.id],
        );
        if (dup[0]) throw clientError(`PO ${poNumber} already exists for this cost centre`, 409);
        note("PO number", po.po_number, poNumber);
      }
    }

    const from = input.periodFrom ?? String(po.period_from).slice(0, 10);
    const to = input.periodTo ?? String(po.period_to).slice(0, 10);
    assertPeriod(from, to);
    const outside = drawRows.filter((r) => String(r.invoice_date).slice(0, 10) < from || String(r.invoice_date).slice(0, 10) > to);
    if (outside.length) {
      throw clientError(`The new period ${from} to ${to} leaves out bill(s) already drawn on this PO: ${outside.map((r) => `${r.bill_no} (${String(r.invoice_date).slice(0, 10)})`).join(", ")}`);
    }
    note("period from", String(po.period_from).slice(0, 10), from);
    note("period to", String(po.period_to).slice(0, 10), to);

    let totalPaise = toPaise(po.total_amount);
    if (input.lines !== undefined) {
      const lines = normaliseLines(input.lines);
      totalPaise = lines.reduce((s, l) => s + l.amountPaise, 0);
      if (totalPaise < drawnPaise) {
        throw clientError(`PO amount ₹${fmt(totalPaise)} is below ₹${fmt(drawnPaise)} already drawn by bills on it`);
      }
      if (totalPaise <= 0) throw clientError("PO amount must be greater than zero");
      await writeLines(conn, input.id, lines);
      note("amount", fmt(toPaise(po.total_amount)), fmt(totalPaise));
      changes.push(`particulars replaced (${lines.length})`);
    }
    const remarks = input.remarks === undefined ? po.remarks : String(input.remarks ?? "").trim().slice(0, 500) || null;
    note("remarks", po.remarks, remarks);
    const att = input.attachment ?? null;
    if (att) note("document", po.attachment_name, att.name);
    if (!changes.length) return { id: input.id, changed: [] as string[], approvalStatus: String(po.approval_status ?? "approved") };

    const next = nextApprovalState(po, totalPaise, input.userId);
    if (next.status !== String(po.approval_status ?? "approved")) changes.push(`approval: ${po.approval_status ?? "approved"} → ${next.status}`);
    await conn.execute(
      `UPDATE client_po_number SET po_number = ?, period_from = ?, period_to = ?, total_amount = ?, balance_amount = ?,
         remarks = ?, attachment_path = COALESCE(?, attachment_path), attachment_name = COALESCE(?, attachment_name),
         attachment_mime = COALESCE(?, attachment_mime), updated_by = ?,
         approval_status = ?, approval_requested_by = ?
       WHERE id = ?`,
      [poNumber, from, to, rupees(totalPaise), rupees(totalPaise - drawnPaise), remarks,
        att?.path ?? null, att?.name ?? null, att?.mime ?? null, input.userId,
        next.status, next.requestedBy, input.id],
    );
    await audit(conn, input.id, "edited", input.userId, changes.join("; "));
    return { id: input.id, changed: changes, approvalStatus: next.status };
  });
}

/** Last approved PO amount in paise; legacy rows (approved_amount NULL) count their current amount. */
function approvedPaise(po: RowDataPacket): number {
  if (po.approved_amount === null || po.approved_amount === undefined) {
    return String(po.approval_status ?? "approved") === "approved" ? toPaise(po.total_amount) : 0;
  }
  return toPaise(po.approved_amount);
}

/**
 * Approval state after an edit that leaves the PO at `newTotalPaise`:
 *  - above the last approved amount -> pending (the editor becomes the requester);
 *  - still pending / rejected and within an approved amount > 0 -> approved again;
 *  - pending (never approved) stays pending, with the editor as requester;
 *  - otherwise unchanged.
 */
export function nextApprovalState(po: RowDataPacket, newTotalPaise: number, editorId: string): { status: string; requestedBy: string | null } {
  const current = String(po.approval_status ?? "approved");
  const approved = approvedPaise(po);
  if (newTotalPaise > approved) return { status: "pending", requestedBy: editorId };
  if (current !== "approved") {
    if (approved > 0) return { status: "approved", requestedBy: null };
    return { status: "pending", requestedBy: editorId };
  }
  return { status: "approved", requestedBy: po.approval_requested_by ? String(po.approval_requested_by) : null };
}

/** Approve / reject a pending PO (or a pending amount increase). The creator / editor cannot decide it. */
async function decidePo(id: string, decision: "approve" | "reject", userId: string, note?: string | null) {
  const why = String(note ?? "").trim();
  if (decision === "reject" && why.length < 5) throw clientError("A reason of at least 5 characters is required to reject a PO");
  return inTransaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(`SELECT * FROM client_po_number WHERE id = ? LIMIT 1 FOR UPDATE`, [id]);
    const po = rows[0];
    if (!po) throw clientError("PO not found", 404);
    if (String(po.approval_status ?? "approved") !== "pending") {
      throw clientError(`PO ${po.po_number} is ${po.approval_status ?? "approved"} — only a pending PO can be ${decision === "approve" ? "approved" : "rejected"}`);
    }
    const maker = String(po.approval_requested_by ?? "") === String(userId)
      || (approvedPaise(po) === 0 && String(po.created_by ?? "") === String(userId));
    if (maker) throw clientError(`You created or changed this PO — another approver must ${decision} it`, 403);
    const status = decision === "approve" ? "approved" : "rejected";
    await conn.execute(
      `UPDATE client_po_number SET approval_status = ?, approved_amount = IF(? = 'approved', total_amount, approved_amount),
         approval_decided_by = ?, approval_decided_at = NOW(), approval_note = ?
       WHERE id = ?`,
      [status, status, userId, why ? why.slice(0, 500) : null, id],
    );
    await audit(conn, id, status, userId, `${status === "approved" ? "Approved" : "Rejected"} at ₹${fmt(toPaise(po.total_amount))}${why ? `: ${why}` : ""}`);
    return { id, approvalStatus: status };
  });
}

export interface PoReportQuery {
  costCentreId?: string; branchId?: string; companyName?: string; search?: string;
  status?: "active" | "expired" | "upcoming" | "exhausted";
  branchIds?: string[] | null;
  today?: string;
}

/** The governed PO report: every MAS PO with drawn / balance / utilisation / period status. */
async function report(q: PoReportQuery) {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const where = [ownCompanyCostCentreSql("cc")];
  const params: unknown[] = [];
  if (q.costCentreId) { where.push("po.cost_centre_id = ?"); params.push(q.costCentreId); }
  if (q.branchId) { where.push("cc.branch_id = ?"); params.push(q.branchId); }
  if (q.companyName) { where.push("cc.company_name = ?"); params.push(q.companyName); }
  if (q.search?.trim()) { where.push("(po.po_number LIKE ? OR cc.cost_centre_code LIKE ?)"); params.push(`%${q.search.trim()}%`, `%${q.search.trim()}%`); }
  if (q.branchIds) {
    if (!q.branchIds.length) where.push("1 = 0");
    else { where.push(`cc.branch_id IN (${q.branchIds.map(() => "?").join(",")})`); params.push(...q.branchIds); }
  }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT po.id, po.po_number, po.period_from, po.period_to, po.total_amount, po.balance_amount, po.remarks,
            po.attachment_name, po.created_at, po.cost_centre_id, cc.cost_centre_code, cc.branch_id, b.branch_name,
            po.approval_status, po.approved_amount, po.approval_requested_by, po.created_by,
            COALESCE(NULLIF(cc.billing_client_name, ''), NULLIF(cc.client_name, ''), cc.company_name) AS client_name,
            (SELECT COUNT(*) FROM client_po_line l WHERE l.po_id = po.id) AS line_count,
            (SELECT COUNT(DISTINCT pp.invoice_id) FROM client_po_particular pp JOIN client_invoice ci ON ci.id = pp.invoice_id
              WHERE pp.po_id = po.id AND ci.invoice_status = 'approved') AS bill_count
     FROM client_po_number po
     JOIN cost_centre_master cc ON cc.id = po.cost_centre_id
     LEFT JOIN branch_master b ON b.id = cc.branch_id
     WHERE ${where.join(" AND ")}
     ORDER BY po.created_at DESC, po.id DESC
     LIMIT 2000`,
    params,
  );
  const out = rows.map((r) => {
    const total = toPaise(r.total_amount);
    const balance = toPaise(r.balance_amount);
    const from = String(r.period_from ?? "").slice(0, 10);
    const to = String(r.period_to ?? "").slice(0, 10);
    const status = balance <= 0 ? "exhausted" : today < from ? "upcoming" : today > to ? "expired" : "active";
    return {
      id: String(r.id), poNumber: String(r.po_number), costCentreId: String(r.cost_centre_id), costCentre: String(r.cost_centre_code ?? ""),
      branch: String(r.branch_name ?? ""), client: String(r.client_name ?? ""), periodFrom: from, periodTo: to,
      amount: rupees(total), drawn: rupees(total - balance), balance: rupees(balance),
      utilisation: total > 0 ? Math.round(((total - balance) / total) * 1000) / 10 : 0,
      status, bills: Number(r.bill_count ?? 0), lines: Number(r.line_count ?? 0),
      hasDocument: Boolean(r.attachment_name), remarks: r.remarks ? String(r.remarks) : null,
      approvalStatus: String(r.approval_status ?? "approved"),
      approvalRequestedBy: r.approval_requested_by ? String(r.approval_requested_by) : (String(r.approval_status ?? "approved") === "pending" && r.created_by ? String(r.created_by) : null),
    };
  });
  return q.status ? out.filter((r) => r.status === q.status) : out;
}

/** One PO: its particulars, every invoice on it, and its edit history. */
async function detail(id: string) {
  const [[po]] = await db.query<RowDataPacket[]>(
    `SELECT po.*, cc.cost_centre_code, cc.branch_id, b.branch_name, COALESCE(NULLIF(cc.billing_client_name, ''), NULLIF(cc.client_name, ''), cc.company_name) AS client_name,
            COALESCE(ar.email, ac.email) AS approval_requested_by_email
     FROM client_po_number po JOIN cost_centre_master cc ON cc.id = po.cost_centre_id LEFT JOIN branch_master b ON b.id = cc.branch_id
     LEFT JOIN auth_user ar ON ar.id = po.approval_requested_by
     LEFT JOIN auth_user ac ON ac.id = po.created_by
     WHERE po.id = ?`,
    [id],
  );
  if (!po) throw clientError("PO not found", 404);
  const [lines] = await db.query<RowDataPacket[]>(
    `SELECT line_no, particulars, qty, rate, amount FROM client_po_line WHERE po_id = ? ORDER BY line_no`, [id]);
  const [drawn] = await db.query<RowDataPacket[]>(
    `SELECT ci.id, ci.bill_no, ci.proforma_no, ci.invoice_date, ci.month_label, ci.grand_total, ci.invoice_status,
            SUM(pp.amount_consumed) AS drawn
     FROM client_po_particular pp JOIN client_invoice ci ON ci.id = pp.invoice_id
     WHERE pp.po_id = ?
     GROUP BY ci.id, ci.bill_no, ci.proforma_no, ci.invoice_date, ci.month_label, ci.grand_total, ci.invoice_status
     ORDER BY ci.invoice_date, ci.bill_no`,
    [id],
  );
  const [pending] = await db.query<RowDataPacket[]>(
    `SELECT ci.id, ci.bill_no, ci.proforma_no, ci.invoice_date, ci.month_label, ci.grand_total, ci.invoice_status
     FROM client_invoice ci
     WHERE ci.cost_centre_id = ? AND ci.invoice_status = 'proforma'
       AND FIND_IN_SET(?, REPLACE(COALESCE(ci.po_numbers, ''), ', ', ',')) > 0
     ORDER BY ci.invoice_date`,
    [po.cost_centre_id, po.po_number],
  );
  const [history] = await db.query<RowDataPacket[]>(
    `SELECT a.action, a.changes, a.created_at, COALESCE(au.email, a.actor_id) AS actor
     FROM client_po_audit a LEFT JOIN auth_user au ON au.id = a.actor_id WHERE a.po_id = ? ORDER BY a.created_at DESC`,
    [id],
  );
  const inv = (r: RowDataPacket, stage: "billed" | "waiting") => ({
    id: String(r.id), number: String(r.bill_no || r.proforma_no || ""), date: String(r.invoice_date ?? "").slice(0, 10),
    month: String(r.month_label ?? ""), grandTotal: rupees(toPaise(r.grand_total)), status: String(r.invoice_status),
    drawn: stage === "billed" ? rupees(toPaise(r.drawn)) : 0, stage,
  });
  return {
    po: {
      id: String(po.id), poNumber: String(po.po_number), costCentreId: String(po.cost_centre_id), costCentre: String(po.cost_centre_code ?? ""),
      branchId: po.branch_id ? String(po.branch_id) : null, branch: String(po.branch_name ?? ""), client: String(po.client_name ?? ""),
      periodFrom: String(po.period_from ?? "").slice(0, 10), periodTo: String(po.period_to ?? "").slice(0, 10),
      amount: rupees(toPaise(po.total_amount)), balance: rupees(toPaise(po.balance_amount)),
      drawn: rupees(toPaise(po.total_amount) - toPaise(po.balance_amount)), remarks: po.remarks ? String(po.remarks) : null,
      document: po.attachment_name ? { name: String(po.attachment_name), mime: String(po.attachment_mime ?? "") } : null,
      approvalStatus: String(po.approval_status ?? "approved"),
      approvedAmount: po.approved_amount === null || po.approved_amount === undefined ? null : rupees(toPaise(po.approved_amount)),
      approvalRequestedBy: po.approval_requested_by_email ? String(po.approval_requested_by_email) : po.approval_requested_by ? String(po.approval_requested_by) : null,
      approvalNote: po.approval_note ? String(po.approval_note) : null,
    },
    lines: lines.map((l) => ({ lineNo: Number(l.line_no), particulars: String(l.particulars), qty: Number(l.qty), rate: Number(l.rate), amount: Number(l.amount) })),
    invoices: [...drawn.map((r) => inv(r, "billed")), ...pending.map((r) => inv(r, "waiting"))],
    history: history.map((h) => ({ action: String(h.action), changes: h.changes ? String(h.changes) : "", at: String(h.created_at), actor: String(h.actor ?? "") })),
  };
}

async function attachmentOf(id: string): Promise<{ path: string; name: string; mime: string; branchId: string | null } | null> {
  const [[r]] = await db.query<RowDataPacket[]>(
    `SELECT po.attachment_path, po.attachment_name, po.attachment_mime, cc.branch_id FROM client_po_number po
     JOIN cost_centre_master cc ON cc.id = po.cost_centre_id WHERE po.id = ?`, [id]);
  if (!r?.attachment_path) return null;
  return { path: String(r.attachment_path), name: String(r.attachment_name ?? "po"), mime: String(r.attachment_mime ?? ""), branchId: r.branch_id ? String(r.branch_id) : null };
}

/** Branch of the PO's cost centre (for branch-scoped callers). */
async function branchOf(id: string): Promise<string | null | undefined> {
  const [[r]] = await db.query<RowDataPacket[]>(
    `SELECT cc.branch_id FROM client_po_number po JOIN cost_centre_master cc ON cc.id = po.cost_centre_id WHERE po.id = ?`, [id]);
  return r ? (r.branch_id ? String(r.branch_id) : null) : undefined;
}

export const clientPoMasterService = { createPo, updatePo, decidePo, report, detail, attachmentOf, branchOf };
