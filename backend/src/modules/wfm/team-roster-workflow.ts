/**
 * Team Roster - the two approval steps.
 *
 *   pending_manager --(manager approve)--> pending_wfm --(WFM approve)--> applied | partially_applied
 *   any pending state --(reject, remarks >= 8 chars)--> rejected        (cells released)
 *
 * Who may act (enforced here, server-side; the page's tabs are only a convenience):
 *   manager step : the employee snapshotted as manager_approver_employee_id, or admin / super_admin;
 *   WFM step     : a WFM role (wfm, wfm_spoc, wfm_analyst, branch_wfm, ho_wfm) whose resolved scope covers
 *                  EVERY employee on the submission, or admin / super_admin;
 *   never        : the submitter (their user id or their employee row) - no self-approval, admins included.
 * A submission with no reporting manager is created straight in pending_wfm (see team-roster-submit.ts).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { DashboardScopeConfigurationError, type DashboardScope } from "../../shared/dashboardScope.js";
import { resolveWfmScope } from "./wfm-scope-fallback.js";
import { applySubmission } from "./team-roster-apply.js";
import {
  INBOX_TYPE_APPROVAL, INBOX_TYPE_OUTCOME, closeApprovalItems, notifyUsers, recordAudit, wfmRecipientUserIds,
} from "./team-roster-audit.js";
import { resolveCallerEmployee } from "./team-roster-tree.js";
import { withTransaction } from "./team-roster-tx.js";
import {
  SUBMISSION_STATUS, TeamRosterError, assertReason, isGlobalApprover, isWfmApprover, placeholders, rowsOf,
  type Actor, type SqlExecutor,
} from "./team-roster-types.js";

export type Decision = "approve" | "reject";
const approvalLink = (id: number) => `/wfm/team-roster?tab=approvals&submission=${id}`;

/** SQL predicate over employees (alias `e`) for a resolved WFM scope. Fail-closed. */
export function employeeScopeSql(scope: DashboardScope, alias = "e"): { sql: string; params: string[] } {
  const inList = (col: string, ids: string[]) => `${alias}.${col} IN (${placeholders(ids.length)})`;
  const branch = scope.branchIds.length ? { sql: inList("branch_id", scope.branchIds), params: [...scope.branchIds] } : null;
  const process = scope.processIds.length ? { sql: inList("process_id", scope.processIds), params: [...scope.processIds] } : null;
  switch (scope.level) {
    case "ORG_ALL": return { sql: "1=1", params: [] };
    case "BRANCH_ALL": return branch ?? { sql: "1=0", params: [] };
    case "PROCESS_ALL": return process ?? { sql: "1=0", params: [] };
    case "CUSTOM_SCOPE": {
      const parts = [branch, process].filter((p): p is NonNullable<typeof p> => !!p);
      return parts.length ? { sql: `(${parts.map((p) => p.sql).join(" OR ")})`, params: parts.flatMap((p) => p.params) } : { sql: "1=0", params: [] };
    }
    default: return { sql: "1=0", params: [] };
  }
}

/** The caller's WFM scope as an employees predicate; global approvers see everything. */
export async function wfmEmployeeScope(actor: Actor): Promise<{ sql: string; params: string[] }> {
  if (isGlobalApprover(actor)) return { sql: "1=1", params: [] };
  try {
    return employeeScopeSql(await resolveWfmScope(actor));
  } catch (err) {
    if (err instanceof DashboardScopeConfigurationError) {
      throw new TeamRosterError(403, "Your account has no branch/process scope configured for WFM.", "SCOPE_NOT_CONFIGURED");
    }
    throw err;
  }
}

/** Throws unless every employee on the submission is inside the caller's WFM scope. */
export async function assertWfmScopeCoversSubmission(actor: Actor, submissionId: number, exec: SqlExecutor = db): Promise<void> {
  if (isGlobalApprover(actor)) return;
  const scope = await wfmEmployeeScope(actor);
  const r = rowsOf<RowDataPacket>(await exec.execute(
    `SELECT COUNT(DISTINCT l.employee_id) AS total, COUNT(DISTINCT CASE WHEN ${scope.sql} THEN l.employee_id END) AS inside
       FROM roster_team_submission_line l JOIN employees e ON e.id = l.employee_id WHERE l.submission_id = ?`,
    [...scope.params, submissionId],
  ))[0];
  if (!r || Number(r.total) === 0 || Number(r.inside) !== Number(r.total)) {
    throw new TeamRosterError(403, "This submission includes employees outside your branch/process scope.", "OUT_OF_SCOPE");
  }
}

async function lockSubmission(conn: SqlExecutor, id: number, expected: string) {
  const s = rowsOf<RowDataPacket>(await conn.execute(`SELECT * FROM roster_team_submission WHERE id = ? FOR UPDATE`, [id]))[0];
  if (!s) throw new TeamRosterError(404, "Submission not found.", "NOT_FOUND");
  if (String(s.status) !== expected) {
    throw new TeamRosterError(409, `This submission is ${String(s.status).replace("_", " ")}, not awaiting this step.`, "WRONG_STATE");
  }
  return s;
}

async function refuseSelfApproval(actor: Actor, s: RowDataPacket) {
  const caller = await resolveCallerEmployee(actor.id);
  if ((s.submitter_user_id && String(s.submitter_user_id) === actor.id) || (caller && caller.id === String(s.submitter_employee_id))) {
    throw new TeamRosterError(403, "You cannot approve or reject your own submission.", "SELF_APPROVAL");
  }
  return caller;
}

async function lineEmployeeScope(submissionId: number, exec: SqlExecutor = db) {
  const rows = rowsOf<RowDataPacket>(await exec.execute(
    `SELECT DISTINCT e.branch_id, e.process_id FROM roster_team_submission_line l JOIN employees e ON e.id = l.employee_id WHERE l.submission_id = ?`, [submissionId],
  ));
  return {
    branches: [...new Set(rows.map((r) => (r.branch_id ? String(r.branch_id) : "")).filter(Boolean))],
    processes: [...new Set(rows.map((r) => (r.process_id ? String(r.process_id) : "")).filter(Boolean))],
  };
}

async function notifySubmitter(s: RowDataPacket, id: number, title: string, description: string) {
  await notifyUsers([s.submitter_user_id ? String(s.submitter_user_id) : null], {
    type: INBOX_TYPE_OUTCOME, title, description, submissionId: id, actionUrl: `/wfm/team-roster?tab=submissions&submission=${id}`,
  });
}

export async function managerDecide(actor: Actor, id: number, decision: Decision, remarksRaw?: string | null) {
  const remarks = decision === "reject" ? assertReason(remarksRaw, "Rejection remarks") : String(remarksRaw ?? "").trim().slice(0, 1000) || null;
  const s = await withTransaction(async (conn) => {
    const row = await lockSubmission(conn, id, SUBMISSION_STATUS.PENDING_MANAGER);
    const caller = await refuseSelfApproval(actor, row);
    const named = caller && String(row.manager_approver_employee_id) === caller.id;
    if (!named && !isGlobalApprover(actor)) {
      throw new TeamRosterError(403, "Only the submitter's reporting manager can decide this step.", "NOT_APPROVER");
    }
    const next = decision === "approve" ? SUBMISSION_STATUS.PENDING_WFM : SUBMISSION_STATUS.REJECTED;
    await conn.execute(
      `UPDATE roster_team_submission SET status = ?, manager_decision = ?, manager_decided_by = ?, manager_decided_at = NOW(), manager_remarks = ? WHERE id = ?`,
      [next, decision === "approve" ? "approved" : "rejected", actor.id, remarks, id],
    );
    if (decision === "reject") await conn.execute(`DELETE FROM roster_team_pending_cell WHERE submission_id = ?`, [id]);
    await recordAudit(conn, id, decision === "approve" ? "manager_approved" : "manager_rejected", actor, remarks, { onBehalf: !named });
    return row;
  });
  await closeApprovalItems(id);
  if (decision === "reject") {
    await notifySubmitter(s, id, `Team roster ${s.submission_no} was rejected by your manager`, remarks ?? "");
  } else {
    const scope = await lineEmployeeScope(id);
    await notifyUsers(await wfmRecipientUserIds(scope.branches, scope.processes), {
      type: INBOX_TYPE_APPROVAL, title: `Team roster ${s.submission_no} awaiting WFM approval`,
      description: "The reporting manager approved this submission; WFM approval is the final step.", submissionId: id, actionUrl: approvalLink(id),
    });
  }
  return { submissionId: id, status: decision === "approve" ? SUBMISSION_STATUS.PENDING_WFM : SUBMISSION_STATUS.REJECTED };
}

export async function wfmDecide(actor: Actor, id: number, decision: Decision, remarksRaw?: string | null) {
  if (!isWfmApprover(actor)) throw new TeamRosterError(403, "Only WFM can give the final approval.", "NOT_WFM");
  const remarks = decision === "reject" ? assertReason(remarksRaw, "Rejection remarks") : String(remarksRaw ?? "").trim().slice(0, 1000) || null;
  const head = rowsOf<RowDataPacket>(await db.execute(`SELECT * FROM roster_team_submission WHERE id = ? LIMIT 1`, [id]))[0];
  if (!head) throw new TeamRosterError(404, "Submission not found.", "NOT_FOUND");
  if (head.status !== SUBMISSION_STATUS.PENDING_WFM) {
    throw new TeamRosterError(409, `This submission is ${String(head.status).replace("_", " ")}, not awaiting WFM.`, "WRONG_STATE");
  }
  await refuseSelfApproval(actor, head);
  await assertWfmScopeCoversSubmission(actor, id);

  if (decision === "reject") {
    await withTransaction(async (conn) => {
      await lockSubmission(conn, id, SUBMISSION_STATUS.PENDING_WFM);
      await conn.execute(
        `UPDATE roster_team_submission SET status = 'rejected', wfm_decision = 'rejected', wfm_decided_by = ?, wfm_decided_at = NOW(), wfm_remarks = ? WHERE id = ?`,
        [actor.id, remarks, id],
      );
      await conn.execute(`DELETE FROM roster_team_pending_cell WHERE submission_id = ?`, [id]);
      await recordAudit(conn, id, "wfm_rejected", actor, remarks);
    });
    await closeApprovalItems(id);
    await notifySubmitter(head, id, `Team roster ${head.submission_no} was rejected by WFM`, remarks ?? "");
    return { submissionId: id, status: SUBMISSION_STATUS.REJECTED };
  }

  await withTransaction(async (conn) => {
    await lockSubmission(conn, id, SUBMISSION_STATUS.PENDING_WFM);
    await conn.execute(
      `UPDATE roster_team_submission SET wfm_decision = 'approved', wfm_decided_by = ?, wfm_decided_at = NOW(), wfm_remarks = ? WHERE id = ?`,
      [actor.id, remarks, id],
    );
    await recordAudit(conn, id, "wfm_approved", actor, remarks);
  });
  const result = await applySubmission(id, actor);
  const status = result.applied === result.total && result.failed === 0 ? SUBMISSION_STATUS.APPLIED : SUBMISSION_STATUS.PARTIALLY_APPLIED;
  await withTransaction(async (conn) => {
    await conn.execute(`UPDATE roster_team_submission SET status = ?, applied_at = NOW() WHERE id = ?`, [status, id]);
    await conn.execute(`DELETE FROM roster_team_pending_cell WHERE submission_id = ?`, [id]);
    await recordAudit(conn, id, status === SUBMISSION_STATUS.APPLIED ? "applied" : "partially_applied", actor, null, {
      applied: result.applied, skipped: result.skipped, failed: result.failed,
    });
  });
  await closeApprovalItems(id);
  await notifySubmitter(head, id, `Team roster ${head.submission_no} ${status === SUBMISSION_STATUS.APPLIED ? "applied" : "partly applied"}`,
    `${result.applied} of ${result.total} change(s) were applied to the roster${result.skipped + result.failed ? `; ${result.skipped + result.failed} skipped - open the submission for the reasons` : ""}.`);
  return { submissionId: id, status, applied: result.applied, skipped: result.skipped, failed: result.failed };
}
