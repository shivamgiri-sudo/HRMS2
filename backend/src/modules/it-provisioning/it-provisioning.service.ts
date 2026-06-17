import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { inboxService } from '../inbox/inbox.service.js';
import { emailService } from '../communication/email.service.js';
import { logSensitiveAction } from '../../shared/auditLog.js';

const OFFICIAL_EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@(teammas\.in|teammas\.co\.in)$/;
export { OFFICIAL_EMAIL_REGEX };

// ── Types ──────────────────────────────────────────────────────────────────────

interface ResolvedUser {
  userId: string;
  email: string | null;
}

interface ProvisioningTask {
  taskCode: string;
  assignedRole: string;
  titleFn: (name: string, code: string, lwd?: string | null) => string;
  descFn: (name: string, code: string, lwd?: string | null) => string;
}

// ── User lookup helpers ────────────────────────────────────────────────────────

async function getUsersForBranchRole(roleKey: string, branchId: string): Promise<ResolvedUser[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT e.user_id AS userId, au.email
     FROM user_assignment_scope uas
     JOIN employees e ON e.id = uas.manager_employee_id
     JOIN auth_user au ON au.id = e.user_id
     WHERE uas.role_key = ?
       AND uas.branch_id = ?
       AND uas.active_status = 1
       AND e.active_status = 1
       AND e.user_id IS NOT NULL`,
    [roleKey, branchId],
  );
  return (rows as any[]).map((r) => ({ userId: r.userId, email: r.email ?? null }));
}

async function getUsersForGlobalRole(roleKey: string): Promise<ResolvedUser[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT ur.user_id AS userId, au.email
     FROM user_roles ur
     JOIN auth_user au ON au.id = ur.user_id
     WHERE ur.role_key = ?
       AND ur.active_status = 1
       AND ur.user_id IS NOT NULL`,
    [roleKey],
  );
  return (rows as any[]).map((r) => ({ userId: r.userId, email: r.email ?? null }));
}

async function resolveUsers(assignedRole: string, branchId: string | null): Promise<ResolvedUser[]> {
  if (!branchId || assignedRole === 'admin') {
    return getUsersForGlobalRole(assignedRole);
  }
  const scoped = await getUsersForBranchRole(assignedRole, branchId);
  // Fallback: if no scoped users, try global (e.g. branch_it not yet scoped)
  if (scoped.length === 0) return getUsersForGlobalRole(assignedRole);
  return scoped;
}

// ── Notification dispatch ──────────────────────────────────────────────────────

async function dispatchNotifications(
  users: ResolvedUser[],
  type: string,
  title: string,
  description: string,
  entityId: string,
  actionUrl: string,
): Promise<void> {
  for (const user of users) {
    await inboxService.createItem({
      user_id: user.userId,
      type,
      title,
      description,
      entity_type: 'it_provisioning_request',
      entity_id: entityId,
      action_url: actionUrl,
      priority: 'high',
    }).catch((err: unknown) => console.error('[it-provisioning] inbox create failed:', err));

    if (user.email) {
      await emailService.send({
        to: user.email,
        subject: title,
        html: `<p>${description}</p><p><a href="${process.env.APP_URL ?? ''}/it-provisioning">View in HRMS Portal</a></p>`,
        text: `${description}\n\nView: ${process.env.APP_URL ?? ''}/it-provisioning`,
      }).catch((err: unknown) => console.error('[it-provisioning] email send failed:', err));
    }
  }
}

// ── Create one provisioning request row ───────────────────────────────────────

async function createRequest(params: {
  employeeId: string;
  requestType: 'join' | 'exit';
  taskCode: string;
  assignedRole: string;
  assignedUserId?: string | null;
  triggerEventId?: string | null;
  actorUserId: string;
}): Promise<string> {
  const [result] = await db.execute(
    `INSERT INTO it_provisioning_request
       (employee_id, request_type, task_code, assigned_role, assigned_user_id,
        trigger_event_id, status, locked)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)`,
    [
      params.employeeId,
      params.requestType,
      params.taskCode,
      params.assignedRole,
      params.assignedUserId ?? null,
      params.triggerEventId ?? null,
    ],
  );
  const insertId = (result as any).insertId;

  // Fetch the UUID that MySQL generated (insertId is 0 for UUID PKs — look it up)
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM it_provisioning_request
     WHERE employee_id = ? AND task_code = ? AND request_type = ?
     ORDER BY created_at DESC LIMIT 1`,
    [params.employeeId, params.taskCode, params.requestType],
  );
  const newId = (rows[0] as any)?.id ?? String(insertId);

  await logSensitiveAction({
    actor_user_id: params.actorUserId,
    action_type: 'it_provisioning_task_created',
    module_key: 'it_provisioning',
    entity_type: 'it_provisioning_request',
    entity_id: newId,
    change_summary: {
      employee_id: params.employeeId,
      task_code: params.taskCode,
      request_type: params.requestType,
      assigned_role: params.assignedRole,
      trigger_event_id: params.triggerEventId ?? null,
    },
  });

  return newId;
}

// ── JOIN trigger ───────────────────────────────────────────────────────────────

const JOIN_TASKS: ProvisioningTask[] = [
  {
    taskCode: 'domain_create',
    assignedRole: 'branch_it',
    titleFn: (name, code) => `IT Action: Create domain account + official email for ${name} [${code}]`,
    descFn: (name, code) =>
      `New employee ${name} (${code}) has joined. Please create their domain account and official email ID (@teammas.in / @teammas.co.in) and update it in the HRMS portal.`,
  },
  {
    taskCode: 'biometric_enroll',
    assignedRole: 'admin',
    titleFn: (name, code) => `Biometric: Enroll ${name} [${code}] in biometric system`,
    descFn: (name, code) =>
      `New employee ${name} (${code}) has joined. Please enroll them in the biometric attendance system at their branch.`,
  },
];

export async function dispatchJoinProvisioningTasks(params: {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchId: string | null;
  actorUserId: string;
  triggerEventId?: string | null;
}): Promise<void> {
  const { employeeId, employeeCode, employeeName, branchId, actorUserId, triggerEventId } = params;

  for (const task of JOIN_TASKS) {
    const users = await resolveUsers(task.assignedRole, branchId);
    const title = task.titleFn(employeeName, employeeCode);
    const desc = task.descFn(employeeName, employeeCode);

    const requestId = await createRequest({
      employeeId,
      requestType: 'join',
      taskCode: task.taskCode,
      assignedRole: task.assignedRole,
      assignedUserId: users[0]?.userId ?? null,
      triggerEventId: triggerEventId ?? null,
      actorUserId,
    });

    await dispatchNotifications(users, 'it_provisioning', title, desc, requestId, '/it-provisioning');
  }
}

// ── EXIT trigger ───────────────────────────────────────────────────────────────

const EXIT_TASKS: ProvisioningTask[] = [
  {
    taskCode: 'domain_delete',
    assignedRole: 'branch_it',
    titleFn: (name, code, lwd) => `IT Action: Delete domain account for ${name} [${code}]${lwd ? ` (LWD: ${lwd})` : ''}`,
    descFn: (name, code, lwd) =>
      `Employee ${name} (${code}) has been exited${lwd ? ` with Last Working Day ${lwd}` : ''}. Please delete their domain account immediately.`,
  },
  {
    taskCode: 'email_delete',
    assignedRole: 'branch_it',
    titleFn: (name, code, lwd) => `IT Action: Delete official email for ${name} [${code}]${lwd ? ` (LWD: ${lwd})` : ''}`,
    descFn: (name, code, lwd) =>
      `Employee ${name} (${code}) has been exited${lwd ? ` with Last Working Day ${lwd}` : ''}. Please delete their official email ID and revoke all email access.`,
  },
  {
    taskCode: 'biometric_delete',
    assignedRole: 'admin',
    titleFn: (name, code, lwd) => `Biometric: Remove ${name} [${code}] from biometric system${lwd ? ` (LWD: ${lwd})` : ''}`,
    descFn: (name, code, lwd) =>
      `Employee ${name} (${code}) has been exited${lwd ? ` with Last Working Day ${lwd}` : ''}. Please remove them from the biometric attendance system.`,
  },
  {
    taskCode: 'dialler_delete',
    assignedRole: 'wfm',
    titleFn: (name, code, lwd) => `WFM Action: Remove ${name} [${code}] from Dialler + all external IDs${lwd ? ` (LWD: ${lwd})` : ''}`,
    descFn: (name, code, lwd) =>
      `Employee ${name} (${code}) has been exited${lwd ? ` with Last Working Day ${lwd}` : ''}. Please remove them from the Dialler system, Client portal, and all external IDs assigned to them.`,
  },
];

export async function dispatchExitProvisioningTasks(params: {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchId: string | null;
  lastWorkingDay: string | null;
  exitRequestId: string;
  actorUserId: string;
}): Promise<void> {
  const { employeeId, employeeCode, employeeName, branchId, lastWorkingDay, exitRequestId, actorUserId } = params;

  for (const task of EXIT_TASKS) {
    const users = await resolveUsers(task.assignedRole, branchId);
    const title = task.titleFn(employeeName, employeeCode, lastWorkingDay);
    const desc = task.descFn(employeeName, employeeCode, lastWorkingDay);

    const requestId = await createRequest({
      employeeId,
      requestType: 'exit',
      taskCode: task.taskCode,
      assignedRole: task.assignedRole,
      assignedUserId: users[0]?.userId ?? null,
      triggerEventId: exitRequestId,
      actorUserId,
    });

    await dispatchNotifications(users, 'it_provisioning', title, desc, requestId, '/it-provisioning');
  }
}

// ── Action / Waive ─────────────────────────────────────────────────────────────

async function getRequest(requestId: string): Promise<any> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM it_provisioning_request WHERE id = ? LIMIT 1`,
    [requestId],
  );
  const rec = (rows as any[])[0];
  if (!rec) throw Object.assign(new Error('Provisioning request not found'), { statusCode: 404 });
  if (rec.locked) throw Object.assign(new Error('Request is locked and cannot be modified'), { statusCode: 403 });
  return rec;
}

export async function actionProvisioningRequest(params: {
  requestId: string;
  actionedBy: string;
  evidenceNote?: string;
}): Promise<void> {
  const { requestId, actionedBy, evidenceNote } = params;
  const rec = await getRequest(requestId);
  if (rec.status === 'actioned') return; // idempotent

  await db.execute(
    `UPDATE it_provisioning_request
     SET status = 'actioned', actioned_at = NOW(), actioned_by = ?, evidence_note = ?, updated_at = NOW()
     WHERE id = ?`,
    [actionedBy, evidenceNote ?? null, requestId],
  );

  await logSensitiveAction({
    actor_user_id: actionedBy,
    action_type: 'it_provisioning_actioned',
    module_key: 'it_provisioning',
    entity_type: 'it_provisioning_request',
    entity_id: requestId,
    change_summary: { task_code: rec.task_code, employee_id: rec.employee_id, evidence_note: evidenceNote ?? null },
  });
}

export async function waiveProvisioningRequest(params: {
  requestId: string;
  actionedBy: string;
  evidenceNote: string;
}): Promise<void> {
  const { requestId, actionedBy, evidenceNote } = params;
  if (!evidenceNote?.trim()) throw Object.assign(new Error('evidence_note is required to waive a request'), { statusCode: 400 });

  const rec = await getRequest(requestId);

  await db.execute(
    `UPDATE it_provisioning_request
     SET status = 'waived', actioned_at = NOW(), actioned_by = ?, evidence_note = ?, updated_at = NOW()
     WHERE id = ?`,
    [actionedBy, evidenceNote, requestId],
  );

  await logSensitiveAction({
    actor_user_id: actionedBy,
    action_type: 'it_provisioning_waived',
    module_key: 'it_provisioning',
    entity_type: 'it_provisioning_request',
    entity_id: requestId,
    change_summary: { task_code: rec.task_code, employee_id: rec.employee_id, evidence_note: evidenceNote },
  });
}

export async function confirmAndLockRequest(requestId: string, actionedBy: string): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM it_provisioning_request WHERE id = ? LIMIT 1`, [requestId],
  );
  const rec = (rows as any[])[0];
  if (!rec) throw Object.assign(new Error('Not found'), { statusCode: 404 });
  if (rec.locked) return;

  await db.execute(
    `UPDATE it_provisioning_request SET status = 'confirmed', locked = 1, updated_at = NOW() WHERE id = ?`,
    [requestId],
  );

  await logSensitiveAction({
    actor_user_id: actionedBy,
    action_type: 'it_provisioning_confirmed_locked',
    module_key: 'it_provisioning',
    entity_type: 'it_provisioning_request',
    entity_id: requestId,
    change_summary: { task_code: rec.task_code, employee_id: rec.employee_id, locked: 1 },
  });
}

// ── Auto-lock cron (called hourly) ────────────────────────────────────────────

export async function autoLockConfirmedRequests(): Promise<{ locked: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, task_code, employee_id FROM it_provisioning_request
     WHERE status = 'actioned'
       AND locked = 0
       AND actioned_at < NOW() - INTERVAL 48 HOUR`,
  );
  const toLock = rows as any[];
  if (toLock.length === 0) return { locked: 0 };

  await db.execute(
    `UPDATE it_provisioning_request
     SET status = 'confirmed', locked = 1, updated_at = NOW()
     WHERE status = 'actioned' AND locked = 0 AND actioned_at < NOW() - INTERVAL 48 HOUR`,
  );

  for (const rec of toLock) {
    await logSensitiveAction({
      actor_user_id: 'system',
      action_type: 'it_provisioning_auto_locked',
      module_key: 'it_provisioning',
      entity_type: 'it_provisioning_request',
      entity_id: rec.id,
      change_summary: { task_code: rec.task_code, employee_id: rec.employee_id, locked: 1 },
    });
  }

  return { locked: toLock.length };
}

// ── List requests ──────────────────────────────────────────────────────────────

export async function listProvisioningRequests(filters: {
  assignedRole?: string;
  branchId?: string;
  status?: string;
  requestType?: string;
  employeeId?: string;
  page?: number;
  limit?: number;
}): Promise<{ data: any[]; total: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(200, filters.limit ?? 50);
  const offset = (page - 1) * limit;

  const conds: string[] = ['1=1'];
  const params: unknown[] = [];

  if (filters.assignedRole) { conds.push('ipr.assigned_role = ?'); params.push(filters.assignedRole); }
  if (filters.status)       { conds.push('ipr.status = ?');        params.push(filters.status); }
  if (filters.requestType)  { conds.push('ipr.request_type = ?');  params.push(filters.requestType); }
  if (filters.employeeId)   { conds.push('ipr.employee_id = ?');   params.push(filters.employeeId); }
  if (filters.branchId) {
    conds.push('e.branch_id = ?');
    params.push(filters.branchId);
  }

  const where = conds.join(' AND ');

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ipr.*,
       CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
       e.employee_code, e.branch_id,
       bm.branch_name
     FROM it_provisioning_request ipr
     JOIN employees e ON e.id = ipr.employee_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     WHERE ${where}
     ORDER BY ipr.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const [cnt] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
     FROM it_provisioning_request ipr
     JOIN employees e ON e.id = ipr.employee_id
     WHERE ${where}`,
    params,
  );

  return { data: rows as any[], total: (cnt as any[])[0]?.total ?? 0 };
}

export async function getProvisioningRequest(requestId: string): Promise<any> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ipr.*,
       CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
       e.employee_code, e.branch_id, bm.branch_name
     FROM it_provisioning_request ipr
     JOIN employees e ON e.id = ipr.employee_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     WHERE ipr.id = ? LIMIT 1`,
    [requestId],
  );
  if (!(rows as any[]).length) throw Object.assign(new Error('Not found'), { statusCode: 404 });
  return (rows as any[])[0];
}
