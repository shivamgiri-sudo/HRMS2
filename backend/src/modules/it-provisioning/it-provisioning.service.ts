import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { inboxService } from '../inbox/inbox.service.js';
import { emailService } from '../communication/email.service.js';
import { getConfiguredRecipients } from './notification-recipients.service.js';
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
  // Joined on uas.user_id, not uas.manager_employee_id.
  //
  // manager_employee_id is NULL on every row in this table — the SPOC is
  // identified by user_id. Joining on it matched nothing for every branch and
  // every role, so this function always returned zero and the caller always
  // fell through to "everyone with the role, company-wide". That is how one
  // NOIDA-2 joiner emailed 51 people while NOIDA-2's actual IT SPOC sat in this
  // very table.
  //
  // employees is LEFT JOINed for the name only, and its active_status is NOT
  // filtered on. Four of the 22 configured SPOCs — including HYDERABAD and
  // JAIPUR IT — have an inactive employees row while their scope assignment is
  // active. active_status cannot distinguish "left the company" from "record
  // was never activated", and several are shared mailboxes
  // (it.jaipur@teammas.in). Dropping them means nobody is told the task exists.
  // The deliberate, active scope assignment is the better authority; a blocked
  // login (is_blocked) is the one unambiguous reason not to notify.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT uas.user_id AS userId, au.email
     FROM user_assignment_scope uas
     JOIN auth_user au ON au.id = uas.user_id
     LEFT JOIN employees e ON e.user_id = au.id
     WHERE uas.role_key = ?
       AND uas.branch_id = ?
       AND uas.active_status = 1
       AND au.email IS NOT NULL
       AND COALESCE(au.is_blocked, 0) = 0`,
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

/**
 * The reporting manager of each SPOC, for CC.
 *
 * Their manager is who chases the task if it stalls, so they belong on the
 * thread rather than finding out later.
 */
async function reportingManagersOf(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const ph = userIds.map(() => '?').join(',');
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT mgr_au.email
       FROM employees e
       JOIN employees mgr ON mgr.id = e.reporting_manager_id AND mgr.active_status = 1
       JOIN auth_user mgr_au ON mgr_au.id = mgr.user_id
      WHERE e.user_id IN (${ph}) AND e.active_status = 1
        AND mgr_au.email IS NOT NULL`,
    userIds,
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  return (rows as RowDataPacket[]).map((r) => String(r.email)).filter(Boolean);
}

/**
 * Branch HR, for CC.
 *
 * Prefers HR actually scoped to the branch; falls back to
 * branch_master.hr_contact, which is a plain address column.
 */
async function branchHrEmails(branchId: string | null): Promise<string[]> {
  if (!branchId) return [];
  const [scoped] = await db.execute<RowDataPacket[]>(
    // user_id, for the same reason as above — manager_employee_id is NULL on
    // every row, so this would have found no branch HR either.
    `SELECT DISTINCT au.email
       FROM user_assignment_scope uas
       JOIN auth_user au ON au.id = uas.user_id
      WHERE uas.role_key IN ('hr', 'branch_hr') AND uas.branch_id = ?
        AND uas.active_status = 1 AND au.email IS NOT NULL
        AND COALESCE(au.is_blocked, 0) = 0`,
    [branchId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const emails = (scoped as RowDataPacket[]).map((r) => String(r.email));
  if (emails.length > 0) return emails;

  const [bm] = await db.execute<RowDataPacket[]>(
    `SELECT hr_contact FROM branch_master WHERE id = ? LIMIT 1`, [branchId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const contact = String(bm[0]?.hr_contact ?? '').trim();
  return contact.includes('@') ? [contact] : [];
}

/** The branch head, used when no SPOC is scoped to the branch. */
async function branchHeadUsers(branchId: string | null): Promise<ResolvedUser[]> {
  if (!branchId) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT e.user_id AS userId, au.email
       FROM branch_head_assignments bha
       JOIN branch_master b ON b.branch_name = bha.branch_name OR b.id = bha.branch_head_id
       JOIN employees e ON e.id = bha.branch_head_id AND e.active_status = 1
       JOIN auth_user au ON au.id = e.user_id
      WHERE b.id = ? AND bha.is_active = TRUE AND e.user_id IS NOT NULL`,
    [branchId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  return (rows as RowDataPacket[]).map((r) => ({ userId: String(r.userId), email: (r.email as string) ?? null }));
}

export type TaskRecipients = {
  to: ResolvedUser[];
  cc: string[];
  /** No SPOC is scoped to this branch — the task needs assigning. */
  unassigned: boolean;
  /** How `to` was arrived at, for the log and the audit trail. */
  basis: 'configured' | 'branch_spoc' | 'branch_head_escalation' | 'none';
};

/**
 * Who should act on this task, and who should be kept informed.
 *
 * Deliberately never falls back to "everyone with the role". That fallback
 * emailed 51 people about a single NOIDA-2 joiner — 8 IT, 9 admin, 11 WFM and
 * 23 HR, none of whom own that branch. A notification that goes to everyone
 * tells no one it is theirs.
 */
async function resolveTaskRecipients(
  assignedRole: string,
  branchId: string | null,
  eventCode?: string,
): Promise<TaskRecipients> {
  // Explicit configuration wins. Everything below it is inference from tables
  // that were never written down as "this is who should be told", which is how
  // a Training & Quality employee ended up receiving NOIDA-2's admin tasks.
  if (eventCode) {
    const configured = await getConfiguredRecipients(branchId, eventCode);
    if (configured) {
      return {
        to: configured.to.map((r) => ({ userId: r.userId ?? '', email: r.email })),
        cc: configured.cc,
        unassigned: false,
        basis: 'configured',
      };
    }
  }

  const scoped = branchId ? await getUsersForBranchRole(assignedRole, branchId) : [];

  if (scoped.length > 0) {
    const cc = [
      ...(await reportingManagersOf(scoped.map((u) => u.userId))),
      ...(await branchHrEmails(branchId)),
    ];
    return { to: scoped, cc, unassigned: false, basis: 'branch_spoc' };
  }

  // No SPOC for this branch. Tell whoever owns the branch, and leave the task
  // unassigned so it shows up for reassignment.
  const head = await branchHeadUsers(branchId);
  if (head.length > 0) {
    return {
      to: head,
      cc: await branchHrEmails(branchId),
      unassigned: true,
      basis: 'branch_head_escalation',
    };
  }
  return { to: [], cc: [], unassigned: true, basis: 'none' };
}

/** Kept for callers that still want the raw list. */
async function resolveUsers(assignedRole: string, branchId: string | null): Promise<ResolvedUser[]> {
  return (await resolveTaskRecipients(assignedRole, branchId)).to;
}

// ── Notification dispatch ──────────────────────────────────────────────────────

async function dispatchNotifications(
  users: ResolvedUser[],
  type: string,
  title: string,
  description: string,
  entityId: string,
  actionUrl: string,
  cc: string[] = [],
): Promise<void> {
  // The SPOC's reporting manager and branch HR are copied so the people who
  // chase the task can see it was raised, without being asked to action it.
  const ccList = [...new Set(cc.filter((e) => e && e.includes('@')))]
    .filter((e) => !users.some((u) => u.email === e));
  // Deduplicate email recipients — one user with multiple roles should get only one email per task
  const emailsSent = new Set<string>();

  console.log('[dispatchNotifications] Dispatching notifications:', {
    usersCount: users.length,
    type,
    entityId,
    actionUrl,
  });

  // Collect emails up-front for dedup (can't use the set inside parallel map)
  const seenEmails = new Set<string>();
  const userTasks = users.map((user) => {
    const sendEmail = user.email && !seenEmails.has(user.email);
    if (sendEmail) seenEmails.add(user.email!);
    return { user, sendEmail };
  });

  await Promise.all(
    userTasks.map(async ({ user, sendEmail }) => {
      // A shared mailbox configured as a recipient has no login, so there is no
      // inbox to write to — it gets the email only.
      if (user.userId) {
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
          console.log('[dispatchNotifications] Inbox item created:', { userId: user.userId, entityId });
        } catch (err: unknown) {
          console.error('[dispatchNotifications] inbox create failed:', {
            userId: user.userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (sendEmail) {
        const fullActionUrl = frontendUrl(actionUrl);
        try {
          await emailService.send({
            to: user.email!,
            ...(ccList.length ? { cc: ccList.join(', ') } : {}),
            subject: title,
            html: provisioningEmailHtml(title, description, fullActionUrl),
            text: `${title}\n\n${description}\n\nOpen task in HRMS: ${fullActionUrl}`,
          });
          console.log('[dispatchNotifications] Email sent:', { to: user.email, subject: title });
        } catch (err: unknown) {
          console.error('[dispatchNotifications] email send failed:', {
            to: user.email,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })
  );

  // Keep the set in sync for the summary log below
  emailsSent.clear();
  seenEmails.forEach((e) => emailsSent.add(e));

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
  assignmentException?: boolean; // True if no users found for role
  joiningDate?: string | null; // For SLA calculation
}): Promise<string> {
  // Calculate 24h SLA deadline from joining date
  let slaDeadline: Date | null = null;
  if (params.joiningDate) {
    const joining = new Date(params.joiningDate);
    slaDeadline = new Date(joining.getTime() + 24 * 60 * 60 * 1000); // +24 hours
  }

  // An open task for this employee and code already covers the work. The table
  // has no unique key on (employee_id, task_code, request_type), and this is
  // called from both the joining path and the hourly retry job, so without this
  // check a re-dispatch silently stacks duplicate rows — each with its own inbox
  // item and outbound email to every resolved role-holder.
  const [[existing]] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM it_provisioning_request
      WHERE employee_id = ? AND task_code = ? AND request_type = ?
        AND status NOT IN ('confirmed', 'waived')
      LIMIT 1`,
    [params.employeeId, params.taskCode, params.requestType],
  );
  if (existing?.id) {
    return String(existing.id);
  }

  const [result] = await db.execute(
    `INSERT INTO it_provisioning_request
       (employee_id, request_type, task_code, assigned_role, assigned_user_id,
        trigger_event_id, status, locked, assignment_exception, sla_due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      params.employeeId,
      params.requestType,
      params.taskCode,
      params.assignedRole,
      params.assignedUserId ?? null,
      params.triggerEventId ?? null,
      // Migration 420 adds 'pending_unassigned' to the status ENUM. It was
      // missing, so this INSERT was rejected under strict mode and aborted the
      // dispatch loop, leaving every task after the first unassigned one
      // uncreated. The value is kept rather than replaced with 'pending'
      // because the UI renders an "Unassigned" badge and gates its reassign
      // action on exactly this status, and the list endpoint does not expose
      // assignment_exception for it to use instead.
      params.assignmentException ? 'pending_unassigned' : 'pending',
      params.assignmentException ? 1 : 0,
      slaDeadline,
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
  joiningDate?: string | null; // For 24h SLA calculation
}): Promise<void> {
  const { employeeId, employeeCode, employeeName, branchId, actorUserId, triggerEventId, joiningDate } = params;

  console.log('[dispatchJoinProvisioningTasks] Starting join provisioning dispatch:', {
    employeeId,
    employeeCode,
    employeeName,
    branchId,
    joiningDate,
    tasksCount: JOIN_TASKS.length,
  });

  for (const task of JOIN_TASKS) {
    const recipients = await resolveTaskRecipients(task.assignedRole, branchId, task.taskCode);
    const users = recipients.to;

    console.log(`[dispatchJoinProvisioningTasks] Resolved recipients for role ${task.assignedRole}:`, {
      role: task.assignedRole,
      branchId,
      basis: recipients.basis,
      to: users.map(u => u.email),
      cc: recipients.cc,
    });

    // CHANGED: Create unassigned task instead of skipping
    // This ensures all mandatory tasks are visible for admin reassignment
    const isUnassigned = users.length === 0 || recipients.unassigned;

    if (isUnassigned) {
      console.error(`[dispatchJoinProvisioningTasks] No users found for role ${task.assignedRole} - creating unassigned task for ${task.taskCode}`);
    }

    const title = task.titleFn(employeeName, employeeCode);
    const desc = task.descFn(employeeName, employeeCode);

    const requestId = await createRequest({
      employeeId,
      requestType: 'join',
      taskCode: task.taskCode,
      assignedRole: task.assignedRole,
      assignedUserId: isUnassigned ? null : (users[0]?.userId ?? null),
      triggerEventId: triggerEventId ?? null,
      actorUserId,
      assignmentException: isUnassigned, // Flag for dashboard visibility
      joiningDate: joiningDate ?? null, // For 24h SLA deadline calculation
    });

    console.log('[dispatchJoinProvisioningTasks] Created provisioning request:', {
      requestId,
      taskCode: task.taskCode,
      role: task.assignedRole,
      assignedTo: isUnassigned ? 'UNASSIGNED' : users[0]?.userId,
      assignmentException: isUnassigned,
    });

    // Notify whenever there is someone to tell. Gating on !isUnassigned would
    // silence the branch-head escalation, which is precisely the case where a
    // human most needs to hear that a task has no owner.
    if (users.length > 0) {
      await dispatchNotifications(
        users, 'it_provisioning', title, desc, requestId, task.actionUrl, recipients.cc,
      );
    }

    console.log(`[dispatchJoinProvisioningTasks] Dispatched notifications for ${task.taskCode}:`, {
      notificationsSent: users.length,
    });
  }

  console.log(`[dispatchJoinProvisioningTasks] Completed provisioning dispatch for ${employeeCode}`);

  // Notify employee to upload their profile photo if missing (required for ID card)
  try {
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT user_id, photo_url, personal_email, official_email, email FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = (empRows as any[])[0];
    if (emp && !emp.photo_url) {
      // Inbox notification
      if (emp.user_id) {
        await inboxService.createItem({
          user_id: emp.user_id,
          type: 'profile_photo_required',
          title: 'Upload your profile photo',
          description: 'Your ID card cannot be printed until you upload a professional profile photo. Please visit your Profile page to upload it.',
          entity_type: 'employee',
          entity_id: employeeId,
          action_url: '/profile',
          priority: 'high',
        });
      } else {
        // Employee has no user_id yet (ATS-created employees before first login).
        // In-app notification cannot be delivered until user_id is assigned.
        console.warn(`[dispatchJoinProvisioningTasks] employee ${employeeId} has no user_id — profile photo inbox notification deferred until account is activated`);
      }
      // Email notification — only send once the account is active (user_id assigned).
      // Sending before activation means the employee can't log in to act on it.
      // handleITCompletion() in task-completion-handlers sends this email at the
      // moment the auth_user account is created, so no email is lost.
      if (emp.user_id) {
        const toEmail = emp.personal_email || emp.official_email || emp.email;
        if (toEmail) {
          const photoUploadUrl = frontendUrl('/profile');
          await emailService.send({
            to: toEmail,
            subject: 'Action Required: Upload your profile photo — ID card pending',
            html: provisioningEmailHtml(
              'Upload Your Profile Photo',
              `Dear ${employeeName},<br><br>Welcome to MAS Callnet! Your ID card is being prepared, but it cannot be printed until you upload a professional profile photo.<br><br>Please log in to HRMS and upload your photo from your Profile page at your earliest convenience.`,
              photoUploadUrl,
            ),
          });
        }
      } else {
        console.warn(`[dispatchJoinProvisioningTasks] employee ${employeeId} has no user_id — profile photo email deferred until account is activated via IT provisioning`);
      }
    }
  } catch (err) {
    console.warn('[dispatchJoinProvisioningTasks] Non-fatal: failed to send missing-photo notification:', err);
  }
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
    const exitRecipients = await resolveTaskRecipients(task.assignedRole, branchId, task.taskCode);
    const users = exitRecipients.to;
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

    await dispatchNotifications(
      users, 'it_provisioning', title, desc, requestId, task.actionUrl, exitRecipients.cc,
    );
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
  if (rec.status === 'actioned') return;
  if (rec.status === 'waived' || rec.status === 'confirmed') {
    throw Object.assign(new Error(`Cannot action a ${rec.status} request`), { statusCode: 400 });
  }

  await db.execute(
    `UPDATE it_provisioning_request
     SET status = 'actioned', actioned_at = NOW(), actioned_by = ?, evidence_note = ?, updated_at = NOW()
     WHERE id = ?`,
    [actionedBy, evidenceNote ?? null, requestId],
  );

  // The task is done — retire the alerts that were chasing it, for every SPOC
  // it was dispatched to, not just whoever happened to action it.
  await inboxService.resolveItems({
    entity_type: 'it_provisioning_request',
    entity_id: requestId,
  });

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

  // A waived task is settled too — nobody should keep being chased for it.
  await inboxService.resolveItems({
    entity_type: 'it_provisioning_request',
    entity_id: requestId,
  });

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
  if (rec.status !== 'actioned') {
    throw Object.assign(new Error('Only actioned requests can be locked'), { statusCode: 400 });
  }

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
  branchIds?: string[];
  processIds?: string[];
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

  // Defense-in-depth alongside the provisioning-retry job's own exclusion
  // (jobs/provisioning-retry.job.ts): stops showing already-created bogus
  // rows for legacy (db_bill-migrated) employees even without a data cleanup.
  const conds: string[] = ['1=1', 'e.legacy_emp_id IS NULL'];
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
  if (filters.branchIds?.length) {
    conds.push(`e.branch_id IN (${filters.branchIds.map(() => '?').join(',')})`);
    params.push(...filters.branchIds);
  }
  if (filters.processIds?.length) {
    conds.push(`e.process_id IN (${filters.processIds.map(() => '?').join(',')})`);
    params.push(...filters.processIds);
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

export async function getProvisioningStats(filters: {
  assignedRole?: string;
  branchIds?: string[];
  processIds?: string[];
}): Promise<Record<string, unknown>> {
  // Same legacy exclusion as listProvisioningRequests above, so stat cards
  // agree with the list they summarize.
  const conds = ["1=1", "e.legacy_emp_id IS NULL"];
  const params: unknown[] = [];
  if (filters.assignedRole === "it") {
    conds.push("ipr.assigned_role IN ('it', 'branch_it')");
  } else if (filters.assignedRole) {
    conds.push("ipr.assigned_role = ?");
    params.push(filters.assignedRole);
  }
  if (filters.branchIds?.length) {
    conds.push(`e.branch_id IN (${filters.branchIds.map(() => "?").join(",")})`);
    params.push(...filters.branchIds);
  }
  if (filters.processIds?.length) {
    conds.push(`e.process_id IN (${filters.processIds.map(() => "?").join(",")})`);
    params.push(...filters.processIds);
  }
  const where = conds.join(" AND ");

  const [summaryRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(DISTINCT CASE WHEN ipr.status IN ('pending','pending_unassigned') THEN ipr.employee_id END) AS pending_total,
       SUM(CASE WHEN ipr.status IN ('pending','pending_unassigned') AND LOWER(ipr.task_code) REGEXP 'domain|login' THEN 1 ELSE 0 END) AS pending_domain,
       SUM(CASE WHEN ipr.status IN ('pending','pending_unassigned') AND LOWER(ipr.task_code) LIKE '%email%' THEN 1 ELSE 0 END) AS pending_email,
       SUM(CASE WHEN ipr.status IN ('pending','pending_unassigned') AND LOWER(ipr.task_code) LIKE '%asset%' THEN 1 ELSE 0 END) AS pending_asset,
       SUM(CASE WHEN ipr.status IN ('pending','pending_unassigned') AND LOWER(ipr.task_code) LIKE '%biometric%' THEN 1 ELSE 0 END) AS pending_biometric,
       SUM(CASE WHEN ipr.status IN ('pending','pending_unassigned') AND LOWER(ipr.task_code) REGEXP 'id_card|idcard' THEN 1 ELSE 0 END) AS pending_id_card,
       SUM(CASE WHEN ipr.status IN ('pending','pending_unassigned') AND ipr.sla_due_at < NOW() THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN ipr.status IN ('actioned','confirmed')
                 AND DATE(COALESCE(ipr.actioned_at, ipr.updated_at)) = DATE(NOW())
                THEN 1 ELSE 0 END) AS completed_today
     FROM it_provisioning_request ipr
     JOIN employees e ON e.id = ipr.employee_id
     WHERE ${where}`,
    params,
  );
  const [pendingRows] = await db.execute<RowDataPacket[]>(
    `SELECT ipr.id, ipr.employee_id, ipr.task_code, ipr.status, ipr.sla_due_at,
            e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
            e.branch_id, e.process_id
       FROM it_provisioning_request ipr
       JOIN employees e ON e.id = ipr.employee_id
      WHERE ${where} AND ipr.status IN ('pending','pending_unassigned')
      ORDER BY ipr.sla_due_at ASC, ipr.created_at ASC
      LIMIT 20`,
    params,
  );

  const summary = (summaryRows as any[])[0] ?? {};
  return {
    pending_total: Number(summary.pending_total ?? 0),
    pending_domain: Number(summary.pending_domain ?? 0),
    pending_email: Number(summary.pending_email ?? 0),
    pending_asset: Number(summary.pending_asset ?? 0),
    pending_biometric: Number(summary.pending_biometric ?? 0),
    pending_id_card: Number(summary.pending_id_card ?? 0),
    overdue: Number(summary.overdue ?? 0),
    completed_today: Number(summary.completed_today ?? 0),
    pending_joiners: pendingRows,
    generatedAt: new Date().toISOString(),
  };
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
