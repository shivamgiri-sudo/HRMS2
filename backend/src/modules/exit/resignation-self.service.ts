/**
 * Employee self-service actions on the My Resignation page that are not plain FSM moves:
 *
 *   - withdrawResignation: the employee may take their resignation back at any point before they
 *     have actually left - any pre-exit status, and only up to and including the last working day.
 *     HR / admin / manager withdrawing ON BEHALF of someone else keeps the existing FSM rule.
 *   - requestTalkFirst: "talk to my manager / HR first" - creates NO exit_request; it puts an inbox
 *     item in front of the reporting manager and the employee's branch HR, rate-limited to one per
 *     employee per 24 h, and records the request in sensitive_action_log (existing table).
 *
 * Errors are thrown with a statusCode so the production error handler returns the message as-is
 * instead of replacing it with a generic 500.
 */
import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";
import { inboxService } from "../inbox/inbox.service.js";
import { assertValidExitTransition } from "./exit.secure.routes.js";

/**
 * Statuses in which the employee has already left, or the separation paperwork has started, or
 * the resignation is already over. Self-withdraw is refused only in these; every other status -
 * including any status name this list does not know - is withdrawable, so an employee is never
 * left without a Withdraw button because of a vocabulary gap (owner, 2026-10-01: the button must
 * be there while the resignation is open).
 */
export const SELF_WITHDRAW_BLOCKED_STATUSES = [
  "clearance_pending",
  "fnf_pending",
  "exited",
  "exit_confirmed",
  "closed",
  "terminated",
  "absconding",
  "withdrawn",
  "revoked",
  "rejected",
  "cancelled",
] as const;

const SELF_WITHDRAW_BLOCKED = new Set<string>(SELF_WITHDRAW_BLOCKED_STATUSES);

export type HttpError = Error & { statusCode: number; code?: string };

export function httpError(statusCode: number, message: string, code?: string): HttpError {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

/**
 * The self-withdraw rule, kept pure so it can be pinned by tests without a database.
 *
 * withinLastWorkingDay is computed by MySQL (CURDATE() <= COALESCE(confirmed, proposed) LWD,
 * or true when no LWD is recorded at all) - never from the Node host clock.
 */
export function decideSelfWithdraw(
  status: unknown,
  withinLastWorkingDay: boolean,
  lastWorkingDay: string | null,
): { ok: true } | { ok: false; message: string } {
  const s = String(status ?? "").trim().toLowerCase();
  if (SELF_WITHDRAW_BLOCKED.has(s)) {
    const label = s.replace(/_/g, " ") || "unknown";
    return {
      ok: false,
      message: `Your resignation is already '${label}', so it can no longer be withdrawn from here. Please contact HR to withdraw it.`,
    };
  }
  // The last working day itself is no longer a cut-off: until the exit is actually processed
  // (status moves to clearance / exited), the employee can still change their mind.
  void withinLastWorkingDay;
  void lastWorkingDay;
  return { ok: true };
}

// ── Recipients ────────────────────────────────────────────────────────────────

export interface ExitRecipients {
  employeeName: string;
  employeeCode: string | null;
  branchId: string | null;
  managerUserIds: string[];
  hrUserIds: string[];
}

/**
 * Reporting manager (reporting_manager_id, falling back to manager_id - the same COALESCE
 * exit.notifications.ts loadExitContext uses) plus the HR role holders for the employee's branch
 * via resolveRoleHolderUserIds('hr', branch) - the resolver the NOC/clearance notifications use
 * for their HR inbox items (scope 'all' HR, HR scoped to the branch, or HR sitting in it).
 * The employee's own user is never a recipient - an HR employee resigning must not notify
 * themselves.
 */
export async function resolveExitRecipients(employeeId: string): Promise<ExitRecipients | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.user_id, e.employee_code, e.branch_id,
            COALESCE(NULLIF(TRIM(e.full_name), ''), NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)), ''), e.employee_code) AS name,
            mgr.user_id AS manager_user_id
       FROM employees e
       LEFT JOIN employees mgr ON mgr.id = COALESCE(e.reporting_manager_id, e.manager_id) AND mgr.active_status = 1
      WHERE e.id = ?
      LIMIT 1`,
    [employeeId],
  );
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) return null;
  const self = row.user_id ? String(row.user_id) : null;
  const managerUserIds = row.manager_user_id && String(row.manager_user_id) !== self ? [String(row.manager_user_id)] : [];
  let hr: string[] = [];
  try {
    hr = await resolveRoleHolderUserIds("hr", row.branch_id ? String(row.branch_id) : null);
  } catch {
    hr = [];
  }
  const hrUserIds = [...new Set(hr)].filter((id) => id !== self && !managerUserIds.includes(id));
  return {
    employeeName: String(row.name ?? row.employee_code ?? "An employee"),
    employeeCode: row.employee_code ? String(row.employee_code) : null,
    branchId: row.branch_id ? String(row.branch_id) : null,
    managerUserIds,
    hrUserIds,
  };
}

async function sendInbox(
  userIds: string[],
  item: { type: string; title: string; description: string; entityType: string; entityId: string; actionUrl: string; priority: string },
): Promise<number> {
  let sent = 0;
  // Sequential: the pool is shared by every background worker, and these lists are short.
  for (const userId of userIds) {
    try {
      await inboxService.createItem({
        user_id: userId,
        type: item.type,
        title: item.title.slice(0, 250),
        description: item.description.slice(0, 500),
        entity_type: item.entityType,
        entity_id: item.entityId,
        action_url: item.actionUrl,
        priority: item.priority,
      });
      sent++;
    } catch {
      /* one undeliverable inbox item must not stop the rest */
    }
  }
  return sent;
}

// ── Withdraw ──────────────────────────────────────────────────────────────────

export interface WithdrawInput {
  exitId: string;
  actorUserId: string;
  actorRole: string | null;
  /** The caller's own employee id, or null when the account has no employee record. */
  callerEmployeeId: string | null;
  /** admin / hr / manager */
  isPrivileged: boolean;
}

export interface WithdrawResult {
  exitId: string;
  previousStatus: string;
  onBehalf: boolean;
  waivedClearanceTasks: number;
  employeeActive: boolean | null;
  notified: number;
}

export async function withdrawResignation(input: WithdrawInput): Promise<WithdrawResult> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT status, employee_id,
            DATE_FORMAT(COALESCE(last_working_day_confirmed, last_working_day_proposed), '%Y-%m-%d') AS lwd,
            (COALESCE(last_working_day_confirmed, last_working_day_proposed) IS NULL
              OR CURDATE() <= COALESCE(last_working_day_confirmed, last_working_day_proposed)) AS within_lwd
       FROM exit_request WHERE id = ? LIMIT 1`,
    [input.exitId],
  );
  const current = Array.isArray(rows) ? rows[0] : undefined;
  if (!current) throw httpError(404, "Exit request not found");

  // A login can be linked to more than one employee row (rehire, duplicate record). The
  // resignation may sit on any of them, so ownership is "linked to the caller's login", not
  // "equals the one row getEmployeeForUser happened to pick".
  let ownsIt = !!input.callerEmployeeId && String(current.employee_id) === input.callerEmployeeId;
  if (!ownsIt && input.actorUserId) {
    const [linked] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM employees e
        WHERE e.id = ?
          AND (e.user_id = ?
               OR e.employee_code = (SELECT me.employee_code FROM employees me WHERE me.id = ? LIMIT 1))
        LIMIT 1`,
      [current.employee_id, input.actorUserId, input.callerEmployeeId ?? null],
    );
    ownsIt = Array.isArray(linked) && linked.length > 0;
  }
  if (!input.isPrivileged && !ownsIt) {
    throw httpError(403, "You may only withdraw your own resignation");
  }

  // A manager/HR/admin withdrawing THEIR OWN resignation is an employee withdrawing - the
  // self-service rule applies to them exactly as to anyone else. Only acting on someone else's
  // exit keeps the on-behalf FSM rule.
  const onBehalf = !ownsIt;
  const previousStatus = String(current.status ?? "");
  if (onBehalf) {
    const transition = assertValidExitTransition(previousStatus, "withdrawn");
    if (!transition.ok) throw httpError(409, transition.message);
  } else {
    const within = current.within_lwd === null || current.within_lwd === undefined
      ? true
      : Number(current.within_lwd) === 1 || current.within_lwd === true;
    const decision = decideSelfWithdraw(previousStatus, within, current.lwd ? String(current.lwd) : null);
    if (!decision.ok) throw httpError(409, decision.message, "SELF_WITHDRAW_NOT_ALLOWED");
  }

  // Expected-status predicate: if the auto-progress sweep or an approver moved the row since the
  // read above, refuse rather than withdraw a state nobody validated.
  const [upd] = await db.execute<ResultSetHeader>(
    `UPDATE exit_request SET status = 'withdrawn', updated_at = NOW() WHERE id = ? AND status = ?`,
    [input.exitId, previousStatus],
  );
  if (!upd || Number((upd as ResultSetHeader).affectedRows) !== 1) {
    throw httpError(409, "Your resignation changed status while this was being processed. Please refresh and try again.", "EXIT_STATE_CHANGED");
  }

  await db.execute(
    `INSERT INTO exit_approval_log
       (id, exit_request_id, stage, action, action_by, action_by_role, discussion_remarks, created_at)
     VALUES (?, ?, 'withdrawn', 'status_update', ?, ?, ?, NOW())`,
    [
      randomUUID(),
      input.exitId,
      input.actorUserId,
      input.actorRole,
      onBehalf ? "Resignation withdrawn on the employee's behalf" : "Resignation withdrawn by the employee",
    ],
  );

  // Clearance tasks can already exist before the employee leaves: transitionExitStatus creates
  // them on 'notice_active', and the LWD sweep / a backdated confirmed LWD creates them on the
  // last working day itself. Nothing reverses them on revoke or withdraw, and no clearance queue
  // filters on the exit's status, so they would sit in Admin/IT/Payroll queues for someone who
  // is staying. Waived (an existing terminal task status) with the reason recorded, never deleted.
  let waivedClearanceTasks = 0;
  const waive = async (sql: string, params: unknown[]) => {
    const [w] = await db.execute<ResultSetHeader>(sql, params);
    return Number((w as ResultSetHeader)?.affectedRows ?? 0) || 0;
  };
  try {
    // clearing_reason / cleared_by_role come from sql/074 (present in production). The fallback
    // keeps the waive working on an environment where 074 never ran.
    waivedClearanceTasks = await waive(
      `UPDATE exit_clearance_task
          SET status = 'waived', clearing_reason = 'Resignation withdrawn',
              remarks = COALESCE(remarks, 'Auto-waived: resignation withdrawn'),
              cleared_by = ?, cleared_by_role = ?, cleared_at = NOW(), updated_at = NOW()
        WHERE exit_request_id = ? AND status NOT IN ('cleared', 'waived')`,
      [input.actorUserId, input.actorRole, input.exitId],
    ).catch(() =>
      waive(
        `UPDATE exit_clearance_task
            SET status = 'waived', remarks = COALESCE(remarks, 'Auto-waived: resignation withdrawn'),
                cleared_by = ?, cleared_at = NOW(), updated_at = NOW()
          WHERE exit_request_id = ? AND status NOT IN ('cleared', 'waived')`,
        [input.actorUserId, input.exitId],
      ),
    );
  } catch {
    waivedClearanceTasks = 0;
  }

  // employees.active_status is only ever set to 0 by the 'exited' transition
  // (exitService.updateExitStatus), and no withdrawable status - self or on-behalf - is
  // reachable from 'exited'. So there is nothing to re-activate; this read only records the
  // fact on the audit row so a mismatch would be visible rather than silent.
  let employeeActive: boolean | null = null;
  try {
    const [emp] = await db.execute<RowDataPacket[]>(
      `SELECT active_status FROM employees WHERE id = ? LIMIT 1`,
      [current.employee_id],
    );
    const v = Array.isArray(emp) ? emp[0]?.active_status : undefined;
    employeeActive = v === undefined || v === null ? null : Number(v) === 1;
  } catch {
    employeeActive = null;
  }

  await logSensitiveAction({
    actor_user_id: input.actorUserId,
    action_type: onBehalf ? "RESIGNATION_WITHDRAWN_ON_BEHALF" : "RESIGNATION_WITHDRAWN",
    module_key: "exit",
    entity_type: "exit_request",
    entity_id: input.exitId,
    employee_id: String(current.employee_id),
    actor_role: input.actorRole ?? undefined,
    old_value_json: { status: previousStatus, last_working_day: current.lwd ?? null },
    new_value_json: { status: "withdrawn" },
    change_summary: { waived_clearance_tasks: waivedClearanceTasks, employee_active: employeeActive },
  });

  let notified = 0;
  try {
    const recipients = await resolveExitRecipients(String(current.employee_id));
    if (recipients) {
      const who = `${recipients.employeeName}${recipients.employeeCode ? ` (${recipients.employeeCode})` : ""}`;
      // The person who performed the withdrawal (e.g. HR acting on behalf) does not need telling.
      const to = [...recipients.managerUserIds, ...recipients.hrUserIds].filter((u) => u !== input.actorUserId);
      notified = await sendInbox(to, {
        type: "RESIGNATION_WITHDRAWN",
        title: `Resignation withdrawn — ${who}`,
        description: onBehalf
          ? `The resignation was withdrawn on the employee's behalf (was '${previousStatus.replace(/_/g, " ")}'). No exit action is needed.`
          : `${recipients.employeeName} withdrew their resignation (was '${previousStatus.replace(/_/g, " ")}'). No exit action is needed.`,
        entityType: "exit_request",
        entityId: input.exitId,
        actionUrl: "/exit/command-center",
        priority: "normal",
      });
    }
  } catch {
    notified = 0;
  }

  return { exitId: input.exitId, previousStatus, onBehalf, waivedClearanceTasks, employeeActive, notified };
}

// ── Talk to my manager / HR first ─────────────────────────────────────────────

export const TALK_FIRST_ACTION = "RESIGNATION_TALK_FIRST_REQUESTED";
export const TALK_FIRST_NOTE_MAX = 500;

export interface TalkFirstInput {
  employeeId: string;
  actorUserId: string;
  actorRole: string | null;
  note?: unknown;
}

export interface TalkFirstResult {
  requestId: string;
  notifiedManager: number;
  notifiedHr: number;
}

export async function requestTalkFirst(input: TalkFirstInput): Promise<TalkFirstResult> {
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    throw httpError(400, "note must be text");
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > TALK_FIRST_NOTE_MAX) {
    throw httpError(400, `Please keep your note under ${TALK_FIRST_NOTE_MAX} characters`);
  }

  const recipients = await resolveExitRecipients(input.employeeId);
  if (!recipients) throw httpError(404, "No employee record linked to your account");
  if (recipients.managerUserIds.length + recipients.hrUserIds.length === 0) {
    throw httpError(
      422,
      "We could not find a reporting manager or HR contact on your profile. Please reach out to your branch HR directly.",
      "NO_RECIPIENTS",
    );
  }

  // Rate limit and audit write in ONE statement: the row is inserted only if this employee has
  // no request in the last 24 h, so two quick taps cannot both get through the check.
  // sensitive_action_log is indexed on (entity_type, entity_id) and acted_at.
  const requestId = randomUUID();
  const summary = JSON.stringify({
    note: note || null,
    manager_recipients: recipients.managerUserIds.length,
    hr_recipients: recipients.hrUserIds.length,
  });
  const [ins] = await db.execute<ResultSetHeader>(
    `INSERT INTO sensitive_action_log
       (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary,
        actor_role, reason, employee_id, acted_at)
     SELECT ?, ?, ?, 'exit', 'employee', ?, ?, ?, ?, ?, NOW()
       FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM sensitive_action_log
         WHERE entity_type = 'employee' AND entity_id = ? AND action_type = ?
           AND acted_at >= NOW() - INTERVAL 24 HOUR
      )`,
    [
      requestId,
      input.actorUserId,
      TALK_FIRST_ACTION,
      input.employeeId,
      summary,
      input.actorRole,
      note ? note.slice(0, 255) : "Employee asked to talk before deciding about resigning",
      input.employeeId,
      input.employeeId,
      TALK_FIRST_ACTION,
    ],
  );
  if (!ins || Number((ins as ResultSetHeader).affectedRows) !== 1) {
    throw httpError(
      409,
      "You already asked to talk to your manager / HR in the last 24 hours. They have your request — you can send another one after 24 hours.",
      "TALK_FIRST_RATE_LIMITED",
    );
  }

  const who = `${recipients.employeeName}${recipients.employeeCode ? ` (${recipients.employeeCode})` : ""}`;
  const description = note
    ? `Note from ${recipients.employeeName}: "${note}"`
    : `${recipients.employeeName} is thinking about resigning and would like to talk first. No resignation has been submitted.`;
  const base = {
    type: "RESIGNATION_TALK_FIRST",
    description,
    entityType: "resignation_talk_request",
    entityId: requestId,
    actionUrl: "/exit/command-center",
    priority: "high",
  };
  const notifiedManager = await sendInbox(recipients.managerUserIds, {
    ...base,
    title: `${who} would like to talk with you before resigning`,
  });
  const notifiedHr = await sendInbox(recipients.hrUserIds, {
    ...base,
    title: `${who} asked to talk to HR before resigning`,
  });

  return { requestId, notifiedManager, notifiedHr };
}
