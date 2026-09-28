/**
 * Audit timeline + best-effort notifications for Team Roster submissions.
 *
 * recordAudit writes roster_team_submission_audit (the drill-down timeline). It is called inside the
 * caller's transaction where there is one, so a state change and its audit row commit together.
 * Notifications go to work_inbox_item (the same producer pattern roster import uses for
 * ROSTER_ACK_PENDING) and are strictly best-effort: a failure is logged and never propagates.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  WFM_APPROVER_ROLES, placeholders, rolesOf, rowsOf, type Actor, type SqlExecutor,
} from "./team-roster-types.js";

export const INBOX_TYPE_APPROVAL = "TEAM_ROSTER_APPROVAL";
export const INBOX_TYPE_OUTCOME = "TEAM_ROSTER_OUTCOME";
const INBOX_ENTITY = "roster_team_submission";
const MAX_WFM_RECIPIENTS = 50;

export async function recordAudit(
  exec: SqlExecutor,
  submissionId: number,
  action: string,
  actor: Actor | null,
  remarks?: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  const role = actor ? rolesOf(actor)[0] ?? null : null;
  await exec.execute(
    `INSERT INTO roster_team_submission_audit (submission_id, action, actor_user_id, actor_role, remarks, meta_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [submissionId, action, actor?.id ?? null, role, remarks ? remarks.slice(0, 1000) : null, meta ? JSON.stringify(meta) : null],
  );
}

export async function notifyUsers(
  userIds: Array<string | null | undefined>,
  msg: { type: string; title: string; description: string; submissionId: number; actionUrl: string },
  exec: SqlExecutor = db,
): Promise<void> {
  try {
    const targets = [...new Set(userIds.filter((u): u is string => !!u))];
    for (const userId of targets) {
      await exec.execute(
        `INSERT INTO work_inbox_item (id, user_id, type, title, description, entity_type, entity_id, action_url, priority)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'normal')`,
        [userId, msg.type, msg.title.slice(0, 255), msg.description.slice(0, 1000), INBOX_ENTITY, String(msg.submissionId), msg.actionUrl],
      );
    }
  } catch (err) {
    console.error("[team-roster] notification failed (workflow itself already succeeded):", (err as Error)?.message);
  }
}

/** Marks the approval work items for this submission as done once a decision is recorded. */
export async function closeApprovalItems(submissionId: number, exec: SqlExecutor = db): Promise<void> {
  try {
    await exec.execute(
      `UPDATE work_inbox_item SET is_actioned = 1
        WHERE entity_type = ? AND entity_id = ? AND type = ? AND is_actioned = 0`,
      [INBOX_ENTITY, String(submissionId), INBOX_TYPE_APPROVAL],
    );
  } catch (err) {
    console.error("[team-roster] closing inbox items failed:", (err as Error)?.message);
  }
}

export async function userIdOfEmployee(employeeId: string | null, exec: SqlExecutor = db): Promise<string | null> {
  if (!employeeId) return null;
  const r = rowsOf<RowDataPacket>(await exec.execute(`SELECT user_id FROM employees WHERE id = ? LIMIT 1`, [employeeId]))[0];
  return r?.user_id ? String(r.user_id) : null;
}

/** WFM users whose branch / process assignment covers any of the given ones (ho_wfm is org-wide). */
export async function wfmRecipientUserIds(branchIds: string[], processIds: string[], exec: SqlExecutor = db): Promise<string[]> {
  try {
    const roleMarks = placeholders(WFM_APPROVER_ROLES.length);
    const scopeParts = ["ur.role_key = 'ho_wfm'"];
    const params: string[] = [...WFM_APPROVER_ROLES];
    if (branchIds.length) { scopeParts.push(`uas.branch_id IN (${placeholders(branchIds.length)})`); params.push(...branchIds); }
    if (processIds.length) { scopeParts.push(`uas.process_id IN (${placeholders(processIds.length)})`); params.push(...processIds); }
    const result = await exec.execute(
      `SELECT DISTINCT ur.user_id FROM user_roles ur
         LEFT JOIN user_assignment_scope uas ON uas.user_id = ur.user_id AND uas.active_status = 1
        WHERE ur.active_status = 1 AND ur.role_key IN (${roleMarks}) AND (${scopeParts.join(" OR ")})
        LIMIT ${MAX_WFM_RECIPIENTS}`,
      params,
    );
    return rowsOf<RowDataPacket>(result).map((r) => String(r.user_id));
  } catch (err) {
    console.error("[team-roster] WFM recipient lookup failed:", (err as Error)?.message);
    return [];
  }
}
