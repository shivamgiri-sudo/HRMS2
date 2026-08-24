import { randomUUID } from 'crypto';
import { RowDataPacket } from 'mysql2/promise';
import { db } from '../../db/mysql.js';
import { getUserRoleKeys } from '../../shared/roleResolver.js';

/**
 * Asset & Material Exit Pass service — Phase 1 (create -> approve) and
 * Phase 2 (security guard exit verification).
 *
 * Phase 1: create (draft) -> submit -> Branch Head approve/reject/return ->
 * Admin approve/reject -> pass number assigned on admin approval.
 * Phase 2: an 'approved' pass can be exit-verified by security, recording
 * that the item actually left. Status only ever reaches 'exit_verified'.
 *
 * Deliberately NOT here (later phases): return verification, live QR token
 * validation, overdue tracking, exports, notifications, loss/damage
 * recovery.
 *
 * Every write path always: (a) checks segregation of duties — an approver can
 * never decide their own request (spec §18), (b) writes exit_pass_audit_logs,
 * (c) releases its connection in a finally block — see
 * hrms2-workers-share-one-pool: one leaked connection here starves the whole
 * app's pool, not just this module.
 */

export class ExitPassError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const UNRESTRICTED_ROLES = ['super_admin', 'admin', 'it_head'];
// No dedicated 'security' role_key exists live (checked mas_hrms.user_roles
// 2026-08-21). Reusing the role keys Visitor Management already grants to
// physical-security staff (navConfig.tsx), plus 'it' and 'wfm' per owner
// request 2026-08-21 — kept in sync with ASSET_EXIT_PASS_VERIFY's
// role_page_access grants in 1539, or a role that can open the page would
// 403 on every action, the exact bug branch-head-approval.routes.ts warns
// about.
const SECURITY_ROLES = ['security_head', 'visitor_security', 'branch_admin', 'it', 'wfm'];

export interface RequestingEmployee {
  employeeId: string;
  branchId: string | null;
  fullName: string;
}

export async function resolveRequestingEmployee(authUserId: string): Promise<RequestingEmployee> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_id, full_name FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [authUserId],
  );
  const row = rows[0];
  if (!row) {
    throw new ExitPassError(404, 'No active employee record is linked to this login.');
  }
  return { employeeId: String(row.id), branchId: row.branch_id ? String(row.branch_id) : null, fullName: String(row.full_name ?? '') };
}

export interface ExitPassItemInput {
  asset_id?: string | null;
  is_tagged?: boolean;
  category: string;
  item_name: string;
  serial_number?: string | null;
  make_model?: string | null;
  quantity?: number;
  unit?: string;
  condition_out?: string | null;
  remarks?: string | null;
}

export interface CreateExitPassInput {
  request_department: 'IT' | 'ADMIN';
  movement_type: 'returnable' | 'non_returnable';
  priority?: 'normal' | 'urgent' | 'emergency';
  purpose_code: string;
  purpose_details: string;
  destination_type: string;
  destination_name?: string | null;
  destination_address?: string | null;
  destination_branch_id?: string | null;
  carrier_type?: 'employee' | 'vendor' | 'courier' | 'driver' | 'other';
  carrier_employee_id?: string | null;
  carrier_name?: string | null;
  carrier_mobile?: string | null;
  carrier_company?: string | null;
  vehicle_number?: string | null;
  planned_exit_at: string;
  expected_return_at?: string | null;
  return_responsible_employee_id?: string | null;
  items: ExitPassItemInput[];
}

function assertHasItems(items: ExitPassItemInput[]): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ExitPassError(400, 'At least one item is required.');
  }
  for (const item of items) {
    if (!item.category || !item.item_name) {
      throw new ExitPassError(400, 'Each item needs a category and item name.');
    }
  }
}

async function writeAudit(
  connOrDb: { execute: typeof db.execute },
  passId: string,
  actorEmployeeId: string | null,
  action: string,
  oldStatus: string | null,
  newStatus: string | null,
  remarks?: string | null,
): Promise<void> {
  await connOrDb.execute(
    `INSERT INTO exit_pass_audit_logs (id, exit_pass_id, actor_employee_id, action, old_status, new_status, remarks)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), passId, actorEmployeeId, action, oldStatus, newStatus, remarks ?? null],
  );
}

export async function createExitPass(input: CreateExitPassInput, requester: RequestingEmployee): Promise<{ id: string }> {
  assertHasItems(input.items);
  if (!input.planned_exit_at) throw new ExitPassError(400, 'planned_exit_at is required.');
  if (!input.purpose_details?.trim()) throw new ExitPassError(400, 'purpose_details is required.');
  // Branch is the REQUESTOR's own branch, resolved server-side from their
  // employee record — never trusted from the client. Letting the client pick
  // branch_id would let anyone file a pass, and print a letterhead, for a
  // branch they don't belong to.
  if (!requester.branchId) {
    throw new ExitPassError(422, 'Your employee record has no branch assigned. Contact Super Admin before raising a pass.');
  }
  const branchId = requester.branchId;

  const passId = randomUUID();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO exit_pass_requests (
        id, requestor_employee_id, request_department, branch_id, movement_type, priority,
        purpose_code, purpose_details, destination_type, destination_name, destination_address,
        destination_branch_id, carrier_type, carrier_employee_id, carrier_name, carrier_mobile,
        carrier_company, vehicle_number, planned_exit_at, expected_return_at,
        return_responsible_employee_id, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [
        passId, requester.employeeId, input.request_department, branchId, input.movement_type,
        input.priority ?? 'normal', input.purpose_code, input.purpose_details, input.destination_type,
        input.destination_name ?? null, input.destination_address ?? null, input.destination_branch_id ?? null,
        input.carrier_type ?? 'employee', input.carrier_employee_id ?? null, input.carrier_name ?? null,
        input.carrier_mobile ?? null, input.carrier_company ?? null, input.vehicle_number ?? null,
        input.planned_exit_at, input.expected_return_at ?? null, input.return_responsible_employee_id ?? null,
        requester.employeeId,
      ],
    );

    for (const item of input.items) {
      await conn.execute(
        `INSERT INTO exit_pass_items (id, exit_pass_id, asset_id, is_tagged, category, item_name,
          serial_number, make_model, quantity, unit, condition_out, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(), passId, item.asset_id ?? null, item.is_tagged ? 1 : 0, item.category, item.item_name,
          item.serial_number ?? null, item.make_model ?? null, item.quantity ?? 1, item.unit ?? 'Nos',
          item.condition_out ?? null, item.remarks ?? null,
        ],
      );
    }

    await writeAudit(conn, passId, requester.employeeId, 'created', null, 'draft');
    await conn.commit();
    return { id: passId };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

interface PassRow extends RowDataPacket {
  id: string;
  requestor_employee_id: string;
  branch_id: string;
  status: string;
  movement_type: 'returnable' | 'non_returnable';
  branch_head_employee_id: string | null;
  admin_employee_id: string | null;
}

async function getPassRow(passId: string): Promise<PassRow> {
  const [rows] = await db.execute<PassRow[]>(`SELECT * FROM exit_pass_requests WHERE id = ? LIMIT 1`, [passId]);
  if (!rows[0]) throw new ExitPassError(404, 'Exit pass not found.');
  return rows[0];
}

/** Resolves the active Branch Head assigned to a branch, if any. */
async function resolveBranchHeadEmployeeId(branchId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT bha.branch_head_id
     FROM branch_head_assignments bha
     JOIN branch_master bm ON bm.branch_name = bha.branch_name
     WHERE bm.id = ? AND bha.is_active = TRUE
     LIMIT 1`,
    [branchId],
  );
  return rows[0]?.branch_head_id ? String(rows[0].branch_head_id) : null;
}

export async function submitExitPass(passId: string, requester: RequestingEmployee): Promise<void> {
  const pass = await getPassRow(passId);
  if (pass.requestor_employee_id !== requester.employeeId) {
    throw new ExitPassError(403, 'Only the requestor can submit this pass.');
  }
  if (pass.status !== 'draft' && pass.status !== 'returned_for_correction') {
    throw new ExitPassError(409, `Pass cannot be submitted from status '${pass.status}'.`);
  }

  const branchHeadId = await resolveBranchHeadEmployeeId(pass.branch_id);
  if (!branchHeadId) {
    throw new ExitPassError(422, 'No active Branch Head is assigned for this branch. Contact Super Admin before submitting.');
  }
  if (branchHeadId === requester.employeeId) {
    throw new ExitPassError(422, 'You are the Branch Head for this branch — an alternate approver must be configured before you can submit your own request. Contact Super Admin.');
  }

  await db.execute(
    `UPDATE exit_pass_requests
     SET status = 'pending_branch_head', branch_head_employee_id = ?, submitted_at = NOW()
     WHERE id = ?`,
    [branchHeadId, passId],
  );
  await writeAudit(db, passId, requester.employeeId, 'submitted', pass.status, 'pending_branch_head');
}

export type DecisionKind = 'approved' | 'rejected' | 'returned';

async function assertCanActOnOwnBehalf(pass: PassRow, actorEmployeeId: string): Promise<void> {
  if (pass.requestor_employee_id === actorEmployeeId) {
    throw new ExitPassError(403, 'You cannot approve or reject your own request. An alternate approver is required.');
  }
}

export async function branchHeadDecision(
  passId: string,
  actor: RequestingEmployee,
  actorRoles: string[],
  decision: DecisionKind,
  remarks: string | null,
): Promise<void> {
  const pass = await getPassRow(passId);
  if (pass.status !== 'pending_branch_head') {
    throw new ExitPassError(409, `Pass is '${pass.status}', not pending Branch Head decision.`);
  }
  await assertCanActOnOwnBehalf(pass, actor.employeeId);

  const isAssignedHead = pass.branch_head_employee_id === actor.employeeId;
  const isOverride = actorRoles.some((r) => UNRESTRICTED_ROLES.includes(r));
  if (!isAssignedHead && !isOverride) {
    throw new ExitPassError(403, 'Only the assigned Branch Head (or Super Admin/Admin) can decide this pass.');
  }
  if ((decision === 'rejected' || decision === 'returned') && !remarks?.trim()) {
    throw new ExitPassError(400, 'Remarks are required for a rejection or return-for-correction.');
  }

  const nextStatus =
    decision === 'approved' ? 'pending_admin_approval' :
    decision === 'rejected' ? 'branch_head_rejected' : 'returned_for_correction';

  await db.execute(
    `UPDATE exit_pass_requests SET status = ?, branch_head_decided_at = NOW() WHERE id = ?`,
    [nextStatus, passId],
  );
  await db.execute(
    `INSERT INTO exit_pass_approvals (id, exit_pass_id, stage, approver_employee_id, decision, remarks)
     VALUES (?, ?, 'branch_head', ?, ?, ?)`,
    [randomUUID(), passId, actor.employeeId, decision, remarks ?? null],
  );
  await writeAudit(db, passId, actor.employeeId, `branch_head_${decision}`, pass.status, nextStatus, remarks);
}

async function nextPassNumber(conn: { execute: typeof db.execute }, branchId: string): Promise<string> {
  const [branchRows] = await conn.execute<RowDataPacket[]>(
    `SELECT branch_code FROM branch_master WHERE id = ? LIMIT 1`,
    [branchId],
  );
  const branchCode = String(branchRows[0]?.branch_code ?? 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'GEN';
  const year = new Date().getFullYear();
  const prefix = `GP-${branchCode}-${year}-`;
  // FOR UPDATE inside the caller's transaction serialises concurrent admin
  // approvals for the same branch so two passes never race for the same seq.
  const [countRows] = await conn.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM exit_pass_requests WHERE pass_number LIKE ? FOR UPDATE`,
    [`${prefix}%`],
  );
  const seq = Number(countRows[0]?.n ?? 0) + 1;
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

export async function adminDecision(
  passId: string,
  actor: RequestingEmployee,
  actorRoles: string[],
  decision: 'approved' | 'rejected',
  remarks: string | null,
): Promise<{ passNumber: string | null }> {
  const pass = await getPassRow(passId);
  if (pass.status !== 'pending_admin_approval') {
    throw new ExitPassError(409, `Pass is '${pass.status}', not pending Admin decision.`);
  }
  await assertCanActOnOwnBehalf(pass, actor.employeeId);

  const isOverride = actorRoles.some((r) => UNRESTRICTED_ROLES.includes(r));
  const isBranchAdmin = actorRoles.includes('branch_admin') && actor.branchId === pass.branch_id;
  if (!isOverride && !isBranchAdmin) {
    throw new ExitPassError(403, 'Only Admin, IT Head, Super Admin, or this branch\'s Branch Admin can decide this pass.');
  }
  if (decision === 'rejected' && !remarks?.trim()) {
    throw new ExitPassError(400, 'Remarks are required for a rejection.');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let passNumber: string | null = null;
    if (decision === 'approved') {
      passNumber = await nextPassNumber(conn, pass.branch_id);
      await conn.execute(
        `UPDATE exit_pass_requests
         SET status = 'approved', admin_employee_id = ?, admin_decided_at = NOW(), approved_at = NOW(), pass_number = ?
         WHERE id = ?`,
        [actor.employeeId, passNumber, passId],
      );
    } else {
      await conn.execute(
        `UPDATE exit_pass_requests SET status = 'admin_rejected', admin_employee_id = ?, admin_decided_at = NOW() WHERE id = ?`,
        [actor.employeeId, passId],
      );
    }
    await conn.execute(
      `INSERT INTO exit_pass_approvals (id, exit_pass_id, stage, approver_employee_id, decision, remarks)
       VALUES (?, ?, 'admin', ?, ?, ?)`,
      [randomUUID(), passId, actor.employeeId, decision, remarks ?? null],
    );
    await writeAudit(conn, passId, actor.employeeId, `admin_${decision}`, pass.status, decision === 'approved' ? 'approved' : 'admin_rejected', remarks);
    await conn.commit();
    return { passNumber };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function assertCanView(passBranchId: string, requestorEmployeeId: string, passStatus: string, actor: RequestingEmployee, actorRoles: string[]): Promise<void> {
  // Drafts are always private to their creator, regardless of role.
  if (passStatus === 'draft' && actor.employeeId !== requestorEmployeeId) {
    throw new ExitPassError(403, 'You do not have access to this exit pass.');
  }
  const isOverride = actorRoles.some((r) => UNRESTRICTED_ROLES.includes(r));
  if (isOverride) return;
  if (actor.employeeId === requestorEmployeeId) return;
  if (actor.branchId && actor.branchId === passBranchId) return;
  throw new ExitPassError(403, 'You do not have access to this exit pass.');
}

export async function getExitPass(passId: string, actor: RequestingEmployee, actorRoles: string[]) {
  const pass = await getPassRow(passId);
  await assertCanView(pass.branch_id, pass.requestor_employee_id, pass.status, actor, actorRoles);

  // Letterhead fields for the printable pass: falls back to city/state when
  // address is unset — verified live 2026-08-21 that only 4 of 45 branch_master
  // rows carry a street address, so this fallback is the normal case, not the
  // exception.
  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT bm.branch_name, bm.branch_code, bm.city, bm.state, bm.address,
            req.full_name AS requestor_name
     FROM exit_pass_requests epr
     JOIN branch_master bm ON bm.id = epr.branch_id
     JOIN employees req ON req.id = epr.requestor_employee_id
     WHERE epr.id = ? LIMIT 1`,
    [passId],
  );
  const letterhead = branchRows[0] ?? null;

  const [items] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM exit_pass_items WHERE exit_pass_id = ? ORDER BY created_at ASC`,
    [passId],
  );
  const [approvals] = await db.execute<RowDataPacket[]>(
    `SELECT ea.*, e.full_name AS approver_name
     FROM exit_pass_approvals ea
     JOIN employees e ON e.id = ea.approver_employee_id
     WHERE ea.exit_pass_id = ? ORDER BY ea.decided_at ASC`,
    [passId],
  );
  return { ...pass, items, approvals, letterhead };
}

// ─── Phase 2: security guard exit verification ─────────────────────────────

/** Guard's "enter pass number" lookup. Deliberately returns only what a gate check needs. */
export async function findPassForVerification(passNumber: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT epr.id, epr.pass_number, epr.status, epr.movement_type, epr.priority,
            epr.branch_id, bm.branch_name, req.full_name AS requestor_name,
            epr.carrier_name, epr.carrier_type, epr.planned_exit_at, epr.expected_return_at,
            epr.exit_verified_at, epr.exit_gate
     FROM exit_pass_requests epr
     JOIN branch_master bm ON bm.id = epr.branch_id
     JOIN employees req ON req.id = epr.requestor_employee_id
     WHERE epr.pass_number = ? LIMIT 1`,
    [passNumber],
  );
  const pass = rows[0];
  if (!pass) throw new ExitPassError(404, 'No pass found with that number.');

  const [items] = await db.execute<RowDataPacket[]>(
    `SELECT id, category, item_name, asset_id, quantity FROM exit_pass_items WHERE exit_pass_id = ? ORDER BY created_at ASC`,
    [pass.id],
  );

  // 'outside_premises' (Phase 3): a returnable pass that has exited and is
  // due back. Overdue is derived here, not stored — a pass doesn't need a
  // background job to "become" overdue.
  const isOverdue = pass.status === 'outside_premises'
    && !!pass.expected_return_at
    && new Date(String(pass.expected_return_at)).getTime() < Date.now();

  const verdict =
    pass.status === 'approved' ? 'valid' :
    pass.status === 'outside_premises' ? 'valid_return' :
    pass.status === 'closed' || pass.status === 'exit_verified' ? 'already_used' :
    ['branch_head_rejected', 'admin_rejected', 'cancelled', 'void'].includes(String(pass.status)) ? 'invalid' :
    'not_ready';

  return { ...pass, items, verdict, is_overdue: isOverdue };
}

export async function verifyExit(
  passNumber: string,
  actor: RequestingEmployee,
  actorRoles: string[],
  input: { gate: string; method: 'qr' | 'manual'; remarks?: string | null },
): Promise<void> {
  const isAllowed = actorRoles.some((r) => UNRESTRICTED_ROLES.includes(r) || SECURITY_ROLES.includes(r));
  if (!isAllowed) {
    throw new ExitPassError(403, 'Only Security or Admin roles can verify an exit.');
  }
  if (!input.gate?.trim()) {
    throw new ExitPassError(400, 'gate is required.');
  }

  const [rows] = await db.execute<PassRow[]>(`SELECT * FROM exit_pass_requests WHERE pass_number = ? LIMIT 1`, [passNumber]);
  const pass = rows[0];
  if (!pass) throw new ExitPassError(404, 'No pass found with that number.');
  if (pass.status !== 'approved') {
    throw new ExitPassError(409, `Pass is '${pass.status}', not approved — cannot verify exit.`);
  }

  // Non-returnable material has nothing to bring back — it closes the moment
  // it leaves. Returnable moves to outside_premises for Phase 3's return flow.
  const nextStatus = pass.movement_type === 'non_returnable' ? 'closed' : 'outside_premises';

  await db.execute(
    `UPDATE exit_pass_requests
     SET status = ?, exit_verified_by = ?, exit_verified_at = NOW(), exit_gate = ?, exit_verification_method = ?
     WHERE id = ?`,
    [nextStatus, actor.employeeId, input.gate, input.method, pass.id],
  );
  await writeAudit(db, pass.id, actor.employeeId, 'exit_verified', pass.status, nextStatus, input.remarks ?? `Gate: ${input.gate}, method: ${input.method}`);
}

// ─── Phase 3: return verification ──────────────────────────────────────────

export interface ReturnItemInput {
  id: string;
  condition_in: string;
  has_damage: boolean;
  missing: boolean;
}

export async function verifyReturn(
  passNumber: string,
  actor: RequestingEmployee,
  actorRoles: string[],
  input: { items: ReturnItemInput[]; remarks?: string | null },
): Promise<void> {
  const isAllowed = actorRoles.some((r) => UNRESTRICTED_ROLES.includes(r) || SECURITY_ROLES.includes(r));
  if (!isAllowed) {
    throw new ExitPassError(403, 'Only Security, IT, WFM, or Admin roles can verify a return.');
  }

  const [rows] = await db.execute<PassRow[]>(`SELECT * FROM exit_pass_requests WHERE pass_number = ? LIMIT 1`, [passNumber]);
  const pass = rows[0];
  if (!pass) throw new ExitPassError(404, 'No pass found with that number.');
  if (pass.status !== 'outside_premises') {
    throw new ExitPassError(409, `Pass is '${pass.status}', not outside premises — cannot verify return.`);
  }
  if (!input.items?.length) {
    throw new ExitPassError(400, 'At least one item condition is required.');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const item of input.items) {
      await conn.execute(
        `UPDATE exit_pass_items SET condition_in = ?, has_damage = ?, missing = ? WHERE id = ? AND exit_pass_id = ?`,
        [item.condition_in, item.has_damage ? 1 : 0, item.missing ? 1 : 0, item.id, pass.id],
      );
    }
    await conn.execute(
      `UPDATE exit_pass_requests
       SET status = 'closed', return_verified_by = ?, return_verified_at = NOW(), return_remarks = ?
       WHERE id = ?`,
      [actor.employeeId, input.remarks ?? null, pass.id],
    );
    await writeAudit(conn, pass.id, actor.employeeId, 'return_verified', pass.status, 'closed', input.remarks);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export interface ListFilters {
  status?: string | null;
  limit: number;
  offset: number;
}

export async function listExitPasses(actor: RequestingEmployee, actorRoles: string[], filters: ListFilters) {
  const isOverride = actorRoles.some((r) => UNRESTRICTED_ROLES.includes(r));
  const clauses: string[] = [];
  const params: unknown[] = [];

  // Drafts are always private to their creator — even override roles cannot see another person's draft.
  clauses.push('(status <> \'draft\' OR requestor_employee_id = ?)');
  params.push(actor.employeeId);

  if (!isOverride) {
    clauses.push('(requestor_employee_id = ? OR branch_id = ?)');
    params.push(actor.employeeId, actor.branchId ?? '');
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT epr.*, req.full_name AS requestor_name, bm.branch_name,
            (epr.status = 'outside_premises' AND epr.expected_return_at IS NOT NULL AND epr.expected_return_at < NOW()) AS is_overdue
     FROM exit_pass_requests epr
     JOIN employees req ON req.id = epr.requestor_employee_id
     JOIN branch_master bm ON bm.id = epr.branch_id
     ${where}
     ORDER BY epr.created_at DESC
     LIMIT ? OFFSET ?`,
    // mysql2's execute() (prepared-statement protocol) rejects LIMIT/OFFSET
    // bound as JS numbers against this server — ER_WRONG_ARGUMENTS /
    // "Incorrect arguments to mysqld_stmt_execute" (verified live
    // 2026-08-21). String form works; both are already integers by
    // construction (route clamps/Number()s them), so this is a safe cast,
    // not a validation gap.
    [...params, String(filters.limit), String(filters.offset)],
  );
  return rows;
}

/** Pending-Branch-Head queue for the calling employee (their own assignments only, unless override). */
export async function listPendingBranchHead(actor: RequestingEmployee, actorRoles: string[]) {
  const isOverride = actorRoles.some((r) => UNRESTRICTED_ROLES.includes(r));
  const where = isOverride ? `status = 'pending_branch_head'` : `status = 'pending_branch_head' AND branch_head_employee_id = ?`;
  const params = isOverride ? [] : [actor.employeeId];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT epr.*, req.full_name AS requestor_name, bm.branch_name
     FROM exit_pass_requests epr
     JOIN employees req ON req.id = epr.requestor_employee_id
     JOIN branch_master bm ON bm.id = epr.branch_id
     WHERE ${where}
     ORDER BY epr.submitted_at ASC`,
    params,
  );
  return rows;
}

/** Pending-Admin queue: Super Admin/Admin/IT Head see all branches; branch_admin sees only their own. */
export async function listPendingAdmin(actor: RequestingEmployee, actorRoles: string[]) {
  const isOverride = actorRoles.some((r) => UNRESTRICTED_ROLES.includes(r));
  const isBranchAdmin = actorRoles.includes('branch_admin');
  if (!isOverride && !isBranchAdmin) return [];

  const where = isOverride ? `status = 'pending_admin_approval'` : `status = 'pending_admin_approval' AND epr.branch_id = ?`;
  const params = isOverride ? [] : [actor.branchId ?? ''];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT epr.*, req.full_name AS requestor_name, bm.branch_name
     FROM exit_pass_requests epr
     JOIN employees req ON req.id = epr.requestor_employee_id
     JOIN branch_master bm ON bm.id = epr.branch_id
     WHERE ${where}
     ORDER BY epr.branch_head_decided_at ASC`,
    params,
  );
  return rows;
}

export async function getActorRoles(authUserId: string): Promise<string[]> {
  return getUserRoleKeys(authUserId);
}

// ─── Form autofill helpers ──────────────────────────────────────────────────

/**
 * Carrier-picker search for the raise-pass form. Deliberately its own endpoint
 * rather than reusing /api/employees/hr-hub — that route is gated to
 * super_admin/admin/hr/payroll_head/payroll_admin/wfm, which excludes most of
 * this module's own users (it, branch_admin, branch_head, employee), so it
 * would 403 for exactly the people raising most requests. Scoped to the same
 * role set already on this router instead of loosening hr-hub's RBAC.
 */
export async function cancelExitPass(passId: string, requester: RequestingEmployee): Promise<void> {
  const pass = await getPassRow(passId);
  if (pass.requestor_employee_id !== requester.employeeId) {
    throw new ExitPassError(403, 'Only the requestor can cancel this pass.');
  }
  if (!['draft', 'returned_for_correction'].includes(String(pass.status))) {
    throw new ExitPassError(409, `Pass cannot be cancelled from status '${pass.status}'.`);
  }
  await db.execute(`UPDATE exit_pass_requests SET status = 'cancelled' WHERE id = ?`, [passId]);
  await writeAudit(db, passId, requester.employeeId, 'cancelled', pass.status, 'cancelled');
}

export async function searchEmployeesForCarrier(q: string): Promise<RowDataPacket[]> {
  const term = `%${q.trim()}%`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, full_name, mobile, branch_id
     FROM employees
     WHERE active_status = 1
       AND (full_name LIKE ? OR employee_code LIKE ?)
     ORDER BY full_name ASC
     LIMIT 20`,
    [term, term],
  );
  return rows;
}
