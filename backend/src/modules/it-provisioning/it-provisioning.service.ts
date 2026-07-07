import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { inboxService } from '../inbox/inbox.service.js';
import { emailService } from '../communication/email.service.js';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { env } from '../../config/env.js';

const OFFICIAL_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@(teammas\.in|teammas\.co\.in)$/;
export { OFFICIAL_EMAIL_REGEX };

// ── Types ──────────────────────────────────────────────────────────────────────

interface ResolvedUser {
  userId: string;
  email: string | null;
}

interface ProvisioningTask {
  taskCode: string;
  assignedRole: string;
  actionUrl: string;
  titleFn: (name: string, code: string, lwd?: string | null) => string;
  descFn: (name: string, code: string, lwd?: string | null) => string;
}

function frontendUrl(path: string) {
  const base = String(env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function provisioningEmailHtml(title: string, description: string, actionUrl: string) {
  return `
  <div style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f0;border-radius:18px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#0f766e,#0ea5e9);padding:24px 28px;color:#ffffff">
        <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.88">MAS Callnet HRMS</div>
        <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25">${title}</h1>
      </div>
      <div style="padding:26px 28px">
        <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#334155">${description}</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin:18px 0">
          <p style="margin:0;font-size:13px;line-height:1.55;color:#475569">Please complete this task in HRMS so onboarding status stays accurate for HR, Payroll, WFM, IT and Admin teams.</p>
        </div>
        <p style="margin:24px 0 8px">
          <a href="${actionUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:12px;font-weight:800">Open Task in HRMS</a>
        </p>
        <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#64748b">If the button does not work, copy this link: <br><span style="word-break:break-all">${actionUrl}</span></p>
      </div>
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 28px;color:#64748b;font-size:12px">
        Automated onboarding task notification. Please do not reply to this email.
      </div>
    </div>
  </div>`;
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
  // Deduplicate email recipients — one user with multiple roles should get only one email per task
  const emailsSent = new Set<string>();

  console.log('[dispatchNotifications] Dispatching notifications:', {
    usersCount: users.length,
    type,
    entityId,
    actionUrl,
  });

  for (const user of users) {
    try {
      await inboxService.createItem({
        user_id: user.userId,
        type,
        title,
        description,
        entity_type: 'it_provisioning_request',
        entity_id: entityId,
        action_url: actionUrl,
        priority: 'high',
      });
      console.log('[dispatchNotifications] Inbox item created:', {
        userId: user.userId,
        entityId,
      });
    } catch (err: unknown) {
      console.error('[dispatchNotifications] inbox create failed:', {
        userId: user.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (user.email && !emailsSent.has(user.email)) {
      emailsSent.add(user.email);
      const fullActionUrl = frontendUrl(actionUrl);
      try {
        await emailService.send({
          to: user.email,
          subject: title,
          html: provisioningEmailHtml(title, description, fullActionUrl),
          text: `${title}\n\n${description}\n\nOpen task in HRMS: ${fullActionUrl}`,
        });
        console.log('[dispatchNotifications] Email sent:', {
          to: user.email,
          subject: title,
        });
      } catch (err: unknown) {
        console.error('[dispatchNotifications] email send failed:', {
          to: user.email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  console.log('[dispatchNotifications] Notifications dispatched:', {
    inboxItems: users.length,
    emailsSent: emailsSent.size,
  });
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
    taskCode: 'WFM_PROCESS_ALIGNMENT',
    assignedRole: 'wfm',
    actionUrl: '/provisioning/wfm-alignment',
    titleFn: (name, code) => `WFM Action: Align process roster for ${name} [${code}]`,
    descFn: (name, code) =>
      `New employee ${name} (${code}) has an employee code. Please align process, roster eligibility, shift rules, and attendance planning in WFM.`,
  },
  {
    taskCode: 'IT_EMAIL_DOMAIN_ASSET',
    assignedRole: 'it',
    actionUrl: '/provisioning/it',
    titleFn: (name, code) => `IT Action: Create domain account + official email for ${name} [${code}]`,
    descFn: (name, code) =>
      `New employee ${name} (${code}) has an employee code. Please create their domain account, official email ID (@teammas.in / @teammas.co.in), and asset assignment in the HRMS portal.`,
  },
  {
    taskCode: 'ADMIN_BIOMETRIC_ID_CARD',
    assignedRole: 'admin',
    actionUrl: '/provisioning/admin',
    titleFn: (name, code) => `Admin Action: Biometric and ID card for ${name} [${code}]`,
    descFn: (name, code) =>
      `New employee ${name} (${code}) has an employee code. Please enroll biometric attendance and issue the employee ID card.`,
  },
  {
    taskCode: 'APPOINTMENT_LETTER_ESIGN',
    assignedRole: 'hr',
    actionUrl: '/provisioning/appointment-letter',
    titleFn: (name, code) => `HR Action: Appointment letter e-sign for ${name} [${code}]`,
    descFn: (name, code) =>
      `New employee ${name} (${code}) has an employee code. Please generate the appointment letter and complete e-sign tracking.`,
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

  console.log('[dispatchJoinProvisioningTasks] Starting join provisioning dispatch:', {
    employeeId,
    employeeCode,
    employeeName,
    branchId,
    tasksCount: JOIN_TASKS.length,
  });

  for (const task of JOIN_TASKS) {
    const users = await resolveUsers(task.assignedRole, branchId);

    console.log(`[dispatchJoinProvisioningTasks] Resolved users for role ${task.assignedRole}:`, {
      role: task.assignedRole,
      branchId,
      usersFound: users.length,
      users: users.map(u => ({ userId: u.userId, email: u.email })),
    });

    if (users.length === 0) {
      console.warn(`[dispatchJoinProvisioningTasks] No users found for role ${task.assignedRole}, skipping task ${task.taskCode}`);
      continue;
    }

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

    console.log('[dispatchJoinProvisioningTasks] Created provisioning request:', {
      requestId,
      taskCode: task.taskCode,
      role: task.assignedRole,
      assignedTo: users[0]?.userId,
    });

    await dispatchNotifications(users, 'it_provisioning', title, desc, requestId, task.actionUrl);

    console.log(`[dispatchJoinProvisioningTasks] Dispatched notifications for ${task.taskCode}:`, {
      notificationsSent: users.length,
    });
  }

  console.log(`[dispatchJoinProvisioningTasks] Completed provisioning dispatch for ${employeeCode}`);
}

// ── EXIT trigger ───────────────────────────────────────────────────────────────

const EXIT_TASKS: ProvisioningTask[] = [
  {
    taskCode: 'domain_delete',
    assignedRole: 'it',
    actionUrl: '/provisioning/it',
    titleFn: (name, code, lwd) => `IT Action: Delete domain account for ${name} [${code}]${lwd ? ` (LWD: ${lwd})` : ''}`,
    descFn: (name, code, lwd) =>
      `Employee ${name} (${code}) has been exited${lwd ? ` with Last Working Day ${lwd}` : ''}. Please delete their domain account immediately.`,
  },
  {
    taskCode: 'email_delete',
    assignedRole: 'it',
    actionUrl: '/provisioning/it',
    titleFn: (name, code, lwd) => `IT Action: Delete official email for ${name} [${code}]${lwd ? ` (LWD: ${lwd})` : ''}`,
    descFn: (name, code, lwd) =>
      `Employee ${name} (${code}) has been exited${lwd ? ` with Last Working Day ${lwd}` : ''}. Please delete their official email ID and revoke all email access.`,
  },
  {
    taskCode: 'biometric_delete',
    assignedRole: 'admin',
    actionUrl: '/provisioning/admin',
    titleFn: (name, code, lwd) => `Biometric: Remove ${name} [${code}] from biometric system${lwd ? ` (LWD: ${lwd})` : ''}`,
    descFn: (name, code, lwd) =>
      `Employee ${name} (${code}) has been exited${lwd ? ` with Last Working Day ${lwd}` : ''}. Please remove them from the biometric attendance system.`,
  },
  {
    taskCode: 'dialler_delete',
    assignedRole: 'wfm',
    actionUrl: '/provisioning/wfm-alignment',
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

    await dispatchNotifications(users, 'it_provisioning', title, desc, requestId, task.actionUrl);
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
  assignedUserId?: string;
  branchId?: string;
  status?: string;
  requestType?: string;
  taskCode?: string;
  employeeId?: string;
  page?: number;
  limit?: number;
}): Promise<{ data: any[]; total: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(200, filters.limit ?? 50);
  const offset = (page - 1) * limit;

  const conds: string[] = ['1=1'];
  const params: unknown[] = [];

  if (filters.assignedRole) {
    if (filters.assignedRole === 'it') {
      conds.push("ipr.assigned_role IN ('it', 'branch_it')");
    } else {
      conds.push('ipr.assigned_role = ?');
      params.push(filters.assignedRole);
    }
  }
  if (filters.assignedUserId) { conds.push('(ipr.assigned_user_id = ? OR ipr.assigned_user_id IS NULL)'); params.push(filters.assignedUserId); }
  if (filters.status)       { conds.push('ipr.status = ?');        params.push(filters.status); }
  if (filters.requestType)  { conds.push('ipr.request_type = ?');  params.push(filters.requestType); }
  if (filters.taskCode)     { conds.push('ipr.task_code = ?');     params.push(filters.taskCode); }
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
