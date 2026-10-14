/**
 * Client provision — legacy I-Spark "Provision" menu (Create Provision, Provision Approve,
 * Upload Provision, View & Edit Provision) and its draw-down by invoices.
 *
 * One provision per (cost centre, finance year, month) that is not rejected. It is raised as
 * 'pending', approved or rejected by a second person (maker-checker enforced here, and the
 * Approval Center also hides a maker's own rows), and only an APPROVED provision can be drawn
 * down. Every create / edit / approve / reject is written to client_provision_audit.
 *
 * Draw-down happens when a proforma is created or edited: the invoice's taxable total
 * (`total_amount`, before GST — the screenshot's "Total Revenue 778901") is deducted from the
 * provision for the invoice's own cost centre + finance year + month. Legacy's insufficiency
 * check was commented out (bug #2 in the replica design); here it blocks, unless
 * CLIENT_BILLING_PROVISION_REQUIRED=false, in which case a missing/short provision is drawn
 * down as far as it goes and the invoice still saves. Rejecting an invoice refunds through
 * client_provision_deduction (client-billing-approval.service.ts).
 */
import { randomUUID } from "crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { assertMonthLabelInFinanceYear, round2 } from "./client-billing-tax.js";
import { normaliseInvoiceType } from "./client-billing.service.js";

type Executor = Pick<PoolConnection, "execute">;

function clientError(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function provisionRequired(): boolean {
  return String(process.env.CLIENT_BILLING_PROVISION_REQUIRED ?? "true").toLowerCase() !== "false";
}

function assertAmount(amount: unknown): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw clientError("Provision amount must be greater than zero");
  if (n > 999_999_999_999) throw clientError("Provision amount is too large");
  return round2(n);
}

function cleanRemarks(remarks: unknown): string | null {
  const s = String(remarks ?? "").trim();
  return s ? s.slice(0, 500) : null;
}

/** Provision history row (client_provision_audit). Caller owns the transaction. */
async function audit(conn: Executor, provisionId: string, action: string, actorId: string, details: string | null) {
  await conn.execute(
    `INSERT INTO client_provision_audit (id, provision_id, action, actor_id, details) VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), provisionId, action, actorId, details ? details.slice(0, 2000) : null],
  );
}

export interface ProvisionListQuery {
  financeYear?: string;
  monthLabel?: string;
  costCentreId?: string;
  branchId?: string;
  companyName?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
  /** Branch-scoped callers: only these branch ids (null = org-wide). */
  branchIds?: string[] | null;
}

async function listProvisions(q: ProvisionListQuery) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (q.financeYear) { conditions.push("cp.finance_year = ?"); params.push(q.financeYear); }
  if (q.monthLabel) { conditions.push("cp.month_label = ?"); params.push(q.monthLabel); }
  if (q.costCentreId) { conditions.push("cp.cost_centre_id = ?"); params.push(q.costCentreId); }
  if (q.branchId) { conditions.push("cc.branch_id = ?"); params.push(q.branchId); }
  if (q.companyName) { conditions.push("cc.company_name = ?"); params.push(q.companyName); }
  if (q.branchIds) {
    if (q.branchIds.length === 0) conditions.push("1 = 0");
    else { conditions.push(`cc.branch_id IN (${q.branchIds.map(() => "?").join(",")})`); params.push(...q.branchIds); }
  }
  if (q.status === "edit_pending") {
    conditions.push("cp.edit_requested_at IS NOT NULL");
  } else if (q.status && ["pending", "approved", "rejected"].includes(q.status)) {
    conditions.push("cp.provision_status = ?");
    params.push(q.status);
  }
  if (q.search && q.search.trim()) {
    const like = `%${q.search.trim()}%`;
    conditions.push("(cc.cost_centre_code LIKE ? OR cc.billing_client_name LIKE ? OR cc.company_name LIKE ?)");
    params.push(like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const offset = (page - 1) * limit;
  // .query(): LIMIT/OFFSET cannot be bound through execute() on this server (see routes).
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT cp.*, cc.cost_centre_code, cc.company_name, cc.branch_id, b.branch_name,
            COALESCE(NULLIF(cc.billing_client_name, ''), NULLIF(cc.client_name, ''), cc.company_name) AS client_name,
            (cp.provision_amount - cp.provision_balance) AS used_amount
     FROM client_provision cp
     LEFT JOIN cost_centre_master cc ON cc.id = cp.cost_centre_id
     LEFT JOIN branch_master b ON b.id = cc.branch_id
     ${where}
     ORDER BY cp.created_at DESC, cp.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM client_provision cp
     LEFT JOIN cost_centre_master cc ON cc.id = cp.cost_centre_id ${where}`,
    params,
  );
  return { rows, total: Number(countRows[0]?.total ?? 0), page, limit };
}

export interface CreateProvisionInput {
  costCentreId: string;
  financeYear: string;
  monthLabel: string;
  amount: number;
  remarks?: string | null;
  invoiceType?: string | null;
  userId: string;
}

async function insertProvision(conn: Executor, input: CreateProvisionInput): Promise<{ id: string }> {
  assertMonthLabelInFinanceYear(input.monthLabel, input.financeYear);
  const amount = assertAmount(input.amount);
  const invoiceType = normaliseInvoiceType(input.invoiceType);
  const [cc] = await conn.execute<RowDataPacket[]>(
    `SELECT id FROM cost_centre_master WHERE id = ? LIMIT 1`,
    [input.costCentreId],
  );
  if (!cc[0]) throw clientError(`Cost centre ${input.costCentreId} not found`);
  const [dup] = await conn.execute<RowDataPacket[]>(
    `SELECT id, provision_status FROM client_provision
     WHERE cost_centre_id = ? AND finance_year = ? AND month_label = ? AND provision_status <> 'rejected'
     LIMIT 1 FOR UPDATE`,
    [input.costCentreId, input.financeYear, input.monthLabel],
  );
  if (dup[0]) {
    throw clientError(
      `A ${dup[0].provision_status} provision already exists for this cost centre and ${input.monthLabel} — edit it instead`,
      409,
    );
  }
  const id = randomUUID();
  await conn.execute<ResultSetHeader>(
    `INSERT INTO client_provision
       (id, cost_centre_id, finance_year, month_label, provision_amount, provision_balance,
        provision_status, remarks, created_by, invoice_type)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [id, input.costCentreId, input.financeYear, input.monthLabel, amount, amount,
      cleanRemarks(input.remarks), input.userId, invoiceType],
  );
  await audit(conn, id, "created", input.userId, `${input.monthLabel} ${input.financeYear}: ${amount}`);
  return { id };
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

async function createProvision(input: CreateProvisionInput) {
  return inTransaction((conn) => insertProvision(conn, input));
}

export interface UploadProvisionRow {
  costCentreCode: string;
  financeYear: string;
  monthLabel: string;
  amount: number;
  remarks?: string | null;
  invoiceType?: string | null;
}

export interface UploadProvisionResult {
  row: number;
  costCentreCode: string;
  ok: boolean;
  id?: string;
  error?: string;
}

const UPLOAD_MAX_ROWS = 1000;

/** Upload Provision: each row is its own transaction, so one bad row never blocks the rest. */
async function uploadProvisions(
  rows: UploadProvisionRow[],
  userId: string,
  branchIds: string[] | null = null,
): Promise<UploadProvisionResult[]> {
  if (!Array.isArray(rows) || rows.length === 0) throw clientError("rows must be a non-empty array");
  if (rows.length > UPLOAD_MAX_ROWS) throw clientError(`At most ${UPLOAD_MAX_ROWS} rows per upload`);
  const results: UploadProvisionResult[] = [];
  for (const [index, row] of rows.entries()) {
    const code = String(row?.costCentreCode ?? "").trim();
    try {
      if (!code) throw clientError("cost centre code is required");
      const [cc] = await db.execute<RowDataPacket[]>(
        `SELECT id, branch_id FROM cost_centre_master WHERE cost_centre_code = ? LIMIT 2`,
        [code],
      );
      if (cc.length === 0) throw clientError(`cost centre ${code} not found`);
      if (cc.length > 1) throw clientError(`cost centre code ${code} matches more than one cost centre`);
      // Branch-scoped uploaders: each row's cost centre must be in their own branch.
      if (branchIds && !(cc[0].branch_id && branchIds.includes(String(cc[0].branch_id)))) {
        throw clientError(`cost centre ${code} is outside your branch`, 403);
      }
      const created = await inTransaction((conn) => insertProvision(conn, {
        costCentreId: String(cc[0].id),
        financeYear: String(row.financeYear ?? "").trim(),
        monthLabel: String(row.monthLabel ?? "").trim(),
        amount: Number(row.amount),
        remarks: row.remarks,
        invoiceType: row.invoiceType,
        userId,
      }));
      results.push({ row: index + 1, costCentreCode: code, ok: true, id: created.id });
    } catch (error) {
      results.push({
        row: index + 1,
        costCentreCode: code,
        ok: false,
        error: error instanceof Error ? error.message : "Upload failed",
      });
    }
  }
  return results;
}

async function lockProvision(conn: Executor, id: string) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT * FROM client_provision WHERE id = ? LIMIT 1 FOR UPDATE`,
    [id],
  );
  const row = rows[0];
  if (!row) throw clientError(`Provision ${id} not found`, 404);
  return row;
}

export interface UpdateProvisionInput {
  id: string;
  amount?: number;
  remarks?: string | null;
  userId: string;
}

/**
 * View & Edit Provision. A PENDING provision is changed in place (nobody has approved it yet).
 * An APPROVED provision is not changed here: the new amount/remarks are parked as an edit
 * request and applied only when a second person approves it — legacy
 * provision_master_edit_request. The new amount can never drop below what invoices already used.
 * A rejected provision is read-only (raise a new one).
 */
async function updateProvision(input: UpdateProvisionInput) {
  return inTransaction(async (conn) => {
    const row = await lockProvision(conn, input.id);
    if (row.provision_status === "rejected") throw clientError("A rejected provision cannot be edited — create a new one");
    const amount = input.amount === undefined ? Number(row.provision_amount) : assertAmount(input.amount);
    const used = round2(Number(row.provision_amount) - Number(row.provision_balance));
    if (amount < used) {
      throw clientError(`Amount cannot be less than what invoices already used (${used})`);
    }
    const remarks = input.remarks === undefined ? row.remarks : cleanRemarks(input.remarks);
    if (row.provision_status === "approved") {
      if (row.edit_requested_at) throw clientError("An edit of this provision is already waiting for approval");
      await conn.execute(
        `UPDATE client_provision SET edit_amount = ?, edit_remarks = ?, edit_requested_by = ?, edit_requested_at = NOW() WHERE id = ?`,
        [amount, remarks == null ? null : String(remarks), input.userId, input.id],
      );
      await audit(conn, input.id, "edit_requested", input.userId, `${Number(row.provision_amount)} → ${amount}`);
      return { id: input.id, editPending: true, provisionAmount: Number(row.provision_amount), provisionBalance: Number(row.provision_balance) };
    }
    await applyAmount(conn, input.id, amount, remarks == null ? null : String(remarks));
    await audit(conn, input.id, "edited", input.userId, `${Number(row.provision_amount)} → ${amount}`);
    return { id: input.id, editPending: false, provisionAmount: amount, provisionBalance: round2(amount - used) };
  });
}

// Balance first: MySQL applies single-table SET assignments left to right, so a later
// assignment sees the earlier one's new value — amount first would make the delta 0.
async function applyAmount(conn: Executor, id: string, amount: number, remarks: string | null) {
  await conn.execute(
    `UPDATE client_provision
     SET provision_balance = provision_balance + (? - provision_amount), provision_amount = ?, remarks = ?
     WHERE id = ?`,
    [amount, amount, remarks ?? null, id],
  );
}

/** Approve / decline a pending edit of an approved provision. The requester cannot decide it. */
async function decideProvisionEdit(id: string, decision: "approve" | "decline", userId: string) {
  return inTransaction(async (conn) => {
    const row = await lockProvision(conn, id);
    if (!row.edit_requested_at) throw clientError("No edit of this provision is waiting for approval");
    if (String(row.edit_requested_by) === String(userId)) {
      throw clientError("The person who asked for the edit cannot approve it", 403);
    }
    if (decision === "approve") {
      const used = round2(Number(row.provision_amount) - Number(row.provision_balance));
      const amount = Number(row.edit_amount);
      if (amount < used) throw clientError(`Amount cannot be less than what invoices already used (${used})`);
      await applyAmount(conn, id, amount, row.edit_remarks == null ? null : String(row.edit_remarks));
    }
    await conn.execute(
      `UPDATE client_provision SET edit_amount = NULL, edit_remarks = NULL, edit_requested_by = NULL, edit_requested_at = NULL WHERE id = ?`,
      [id],
    );
    await audit(conn, id, decision === "approve" ? "edit_approved" : "edit_declined", userId,
      `${Number(row.provision_amount)} → ${Number(row.edit_amount)}`);
    return { id, decision };
  });
}

/** H5 maker-checker: whoever raised a provision neither approves nor rejects it. */
function assertNotProvisionMaker(row: RowDataPacket, userId: string, verb: "approve" | "reject") {
  if (row.created_by && String(row.created_by) === String(userId)) {
    throw clientError(`You created this provision — another approver must ${verb} it`, 403);
  }
}

async function approveProvision(id: string, userId: string) {
  return inTransaction(async (conn) => {
    const row = await lockProvision(conn, id);
    if (row.provision_status !== "pending") {
      throw clientError(`Provision is ${row.provision_status}, only a pending provision can be approved`);
    }
    assertNotProvisionMaker(row, userId, "approve");
    await conn.execute(
      `UPDATE client_provision SET provision_status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`,
      [userId, id],
    );
    await audit(conn, id, "approved", userId, null);
    return { id, provisionStatus: "approved" as const };
  });
}

async function rejectProvision(id: string, reason: string, userId: string) {
  const why = String(reason ?? "").trim();
  if (!why) throw clientError("reason is required");
  return inTransaction(async (conn) => {
    const row = await lockProvision(conn, id);
    if (row.provision_status !== "pending") {
      throw clientError(`Provision is ${row.provision_status}, only a pending provision can be rejected`);
    }
    assertNotProvisionMaker(row, userId, "reject");
    // H5: the rejecter goes into rejected_by / rejected_at; approved_by stays for real approvals.
    await conn.execute(
      `UPDATE client_provision
       SET provision_status = 'rejected', rejected_reason = ?, rejected_by = ?, rejected_at = NOW()
       WHERE id = ?`,
      [why.slice(0, 500), userId, id],
    );
    await audit(conn, id, "rejected", userId, why);
    return { id, provisionStatus: "rejected" as const };
  });
}

/** Approved provision (if any) for a scope — what the proforma form shows as "Total Revenue". */
async function getProvisionForScope(costCentreId: string, financeYear: string, monthLabel: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, provision_status, provision_amount, provision_balance, remarks
     FROM client_provision
     WHERE cost_centre_id = ? AND finance_year = ? AND month_label = ? AND provision_status <> 'rejected'
     ORDER BY FIELD(provision_status, 'approved', 'pending'), created_at DESC
     LIMIT 1`,
    [costCentreId, financeYear, monthLabel],
  );
  return rows[0] ?? null;
}

/** Gives back everything an invoice drew from provisions. Caller owns the transaction. */
async function refundInvoiceDrawdown(conn: Executor, invoiceId: string): Promise<void> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, provision_id, amount_used FROM client_provision_deduction WHERE invoice_id = ? FOR UPDATE`,
    [invoiceId],
  );
  for (const d of rows) {
    await conn.execute(
      `UPDATE client_provision SET provision_balance = provision_balance + ? WHERE id = ?`,
      [d.amount_used, d.provision_id],
    );
    await conn.execute(`DELETE FROM client_provision_deduction WHERE id = ?`, [d.id]);
  }
}

export interface DrawdownInput {
  invoiceId: string;
  costCentreId: string;
  financeYear: string;
  monthLabel: string;
  amount: number;
}

/**
 * (Re)draws an invoice's taxable total from the matching approved provision. Refunds the
 * invoice's previous draw first, so create and edit share one path. Caller owns the transaction.
 */
async function drawDownForInvoice(conn: Executor, input: DrawdownInput): Promise<{ provisionId: string | null; used: number }> {
  await refundInvoiceDrawdown(conn, input.invoiceId);
  const amount = round2(input.amount);
  if (amount <= 0) return { provisionId: null, used: 0 };
  const required = provisionRequired();
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, provision_balance FROM client_provision
     WHERE cost_centre_id = ? AND finance_year = ? AND month_label = ? AND provision_status = 'approved'
     ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
    [input.costCentreId, input.financeYear, input.monthLabel],
  );
  const provision = rows[0];
  if (!provision) {
    if (required) {
      throw clientError(
        `No approved provision for this cost centre for ${input.monthLabel} (${input.financeYear}). Create the provision and get it approved first.`,
      );
    }
    return { provisionId: null, used: 0 };
  }
  const balance = Number(provision.provision_balance);
  if (balance < amount && required) {
    throw clientError(
      `Provision balance for ${input.monthLabel} is ${balance}, less than the invoice total ${amount}. Edit the provision amount first.`,
    );
  }
  const used = round2(Math.min(balance, amount));
  if (used <= 0) return { provisionId: String(provision.id), used: 0 };
  await conn.execute(
    `UPDATE client_provision SET provision_balance = provision_balance - ? WHERE id = ?`,
    [used, provision.id],
  );
  await conn.execute(
    `INSERT INTO client_provision_deduction (id, provision_id, invoice_id, amount_used) VALUES (?, ?, ?, ?)`,
    [randomUUID(), provision.id, input.invoiceId, used],
  );
  return { provisionId: String(provision.id), used };
}

export const clientBillingProvisionService = {
  listProvisions,
  createProvision,
  uploadProvisions,
  updateProvision,
  decideProvisionEdit,
  approveProvision,
  rejectProvision,
  getProvisionForScope,
  drawDownForInvoice,
  refundInvoiceDrawdown,
};
