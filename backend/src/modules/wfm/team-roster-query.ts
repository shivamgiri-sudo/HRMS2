/**
 * Team Roster - read side for the submission list, approval queues and the drill-down drawer payload.
 * Every read is row-scoped: submitters see their own, the manager step sees submissions snapshotted to
 * them, the WFM step sees submissions containing at least one employee inside their scope.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireCaller } from "./team-roster.service.js";
import { resolveCallerEmployee } from "./team-roster-tree.js";
import { assertWfmScopeCoversSubmission, wfmEmployeeScope } from "./team-roster-workflow.js";
import {
  PENDING_STATUSES, SUBMISSION_STATUS, TeamRosterError, isGlobalApprover, isWfmApprover, parseWarnings, rowsOf, type Actor,
} from "./team-roster-types.js";

const NAME = (a: string) => `COALESCE(NULLIF(${a}.full_name, ''), TRIM(CONCAT(COALESCE(${a}.first_name, ''), ' ', COALESCE(${a}.last_name, ''))))`;
const DATE = (c: string, alias: string) => `DATE_FORMAT(${c}, '%Y-%m-%d') AS ${alias}`;
const STAMP = (c: string, alias: string) => `DATE_FORMAT(${c}, '%Y-%m-%d %H:%i:%s') AS ${alias}`;
const clampPaging = (offset?: number, limit?: number) => ({
  offset: Math.max(Math.trunc(offset ?? 0), 0),
  limit: Math.min(Math.max(Math.trunc(limit ?? 50), 1), 200),
});

const LIST_SELECT = `
  SELECT s.id, s.submission_no, s.status, ${DATE("s.from_date", "from_date")}, ${DATE("s.to_date", "to_date")},
         ${STAMP("s.submitted_at", "submitted_at")}, ${STAMP("s.applied_at", "applied_at")},
         se.employee_code AS submitter_code, ${NAME("se")} AS submitter_name,
         ${NAME("me")} AS manager_name, s.manager_approver_employee_id,
         (SELECT COUNT(*) FROM roster_team_submission_line l WHERE l.submission_id = s.id) AS line_count,
         (SELECT COUNT(*) FROM roster_team_submission_line l WHERE l.submission_id = s.id AND l.line_status = 'applied') AS applied_count,
         (SELECT COUNT(*) FROM roster_team_submission_line l WHERE l.submission_id = s.id AND l.warnings_json IS NOT NULL) AS warning_count
    FROM roster_team_submission s
    LEFT JOIN employees se ON se.id = s.submitter_employee_id
    LEFT JOIN employees me ON me.id = s.manager_approver_employee_id`;

function listItem(r: RowDataPacket) {
  return {
    id: Number(r.id), submissionNo: r.submission_no ? String(r.submission_no) : null, status: String(r.status),
    from: r.from_date ? String(r.from_date) : null, to: r.to_date ? String(r.to_date) : null,
    submittedAt: r.submitted_at ? String(r.submitted_at) : null, appliedAt: r.applied_at ? String(r.applied_at) : null,
    submitter: { code: r.submitter_code ? String(r.submitter_code) : null, name: String(r.submitter_name ?? "") },
    managerApprover: r.manager_approver_employee_id ? String(r.manager_name ?? "") : null,
    lineCount: Number(r.line_count ?? 0), appliedCount: Number(r.applied_count ?? 0), warningCount: Number(r.warning_count ?? 0),
  };
}

export async function listMySubmissions(actor: Actor, q: { status?: string; offset?: number; limit?: number }) {
  const caller = await requireCaller(actor);
  const { offset, limit } = clampPaging(q.offset, q.limit);
  const where = [`s.submitter_employee_id = ?`, `s.status <> 'draft'`];
  const params: unknown[] = [caller.id];
  if (q.status && Object.values(SUBMISSION_STATUS).includes(q.status as never)) { where.push(`s.status = ?`); params.push(q.status); }
  const total = Number(rowsOf<RowDataPacket>(await db.execute(`SELECT COUNT(*) AS c FROM roster_team_submission s WHERE ${where.join(" AND ")}`, params))[0]?.c ?? 0);
  const rows = rowsOf<RowDataPacket>(await db.execute(
    `${LIST_SELECT} WHERE ${where.join(" AND ")} ORDER BY s.id DESC LIMIT ${limit} OFFSET ${offset}`, params,
  ));
  return { items: rows.map(listItem), total, offset, limit };
}

export async function listApprovals(actor: Actor, q: { step: "manager" | "wfm"; offset?: number; limit?: number }) {
  const { offset, limit } = clampPaging(q.offset, q.limit);
  const caller = await resolveCallerEmployee(actor.id);
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.step === "manager") {
    where.push(`s.status = 'pending_manager'`);
    if (!isGlobalApprover(actor)) {
      if (!caller) return { items: [], total: 0, offset, limit };
      where.push(`s.manager_approver_employee_id = ?`);
      params.push(caller.id);
    }
  } else {
    if (!isWfmApprover(actor)) throw new TeamRosterError(403, "The WFM approval queue is for WFM roles.", "NOT_WFM");
    const scope = await wfmEmployeeScope(actor);
    where.push(`s.status = 'pending_wfm'`);
    where.push(`EXISTS (SELECT 1 FROM roster_team_submission_line l JOIN employees e ON e.id = l.employee_id WHERE l.submission_id = s.id AND ${scope.sql})`);
    params.push(...scope.params);
  }
  where.push(`(s.submitter_user_id IS NULL OR s.submitter_user_id <> ?)`);
  params.push(actor.id);
  if (caller) { where.push(`s.submitter_employee_id <> ?`); params.push(caller.id); }
  const total = Number(rowsOf<RowDataPacket>(await db.execute(`SELECT COUNT(*) AS c FROM roster_team_submission s WHERE ${where.join(" AND ")}`, params))[0]?.c ?? 0);
  const rows = rowsOf<RowDataPacket>(await db.execute(
    `${LIST_SELECT} WHERE ${where.join(" AND ")} ORDER BY s.submitted_at ASC, s.id ASC LIMIT ${limit} OFFSET ${offset}`, params,
  ));
  return { items: rows.map(listItem), total, offset, limit };
}

async function canView(actor: Actor, s: RowDataPacket, callerId: string | null): Promise<boolean> {
  if (isGlobalApprover(actor)) return true;
  if (callerId && (String(s.submitter_employee_id) === callerId || String(s.manager_approver_employee_id ?? "") === callerId)) return true;
  if (!isWfmApprover(actor)) return false;
  const scope = await wfmEmployeeScope(actor);
  const hit = rowsOf<RowDataPacket>(await db.execute(
    `SELECT 1 AS x FROM roster_team_submission_line l JOIN employees e ON e.id = l.employee_id WHERE l.submission_id = ? AND ${scope.sql} LIMIT 1`,
    [s.id, ...scope.params],
  ));
  return hit.length > 0;
}

const label = (code: unknown, start: unknown, end: unknown) => {
  const times = start && end ? `${String(start).slice(0, 5)}-${String(end).slice(0, 5)}` : "";
  return [code ? String(code) : "", times].filter(Boolean).join(" ") || null;
};

export async function getSubmissionDetail(actor: Actor, id: number) {
  const s = rowsOf<RowDataPacket>(await db.execute(
    `SELECT s.*, ${DATE("s.from_date", "from_d")}, ${DATE("s.to_date", "to_d")}, ${STAMP("s.submitted_at", "submitted_s")},
            ${STAMP("s.applied_at", "applied_s")}, ${STAMP("s.created_at", "created_s")},
            ${STAMP("s.manager_decided_at", "manager_decided_s")}, ${STAMP("s.wfm_decided_at", "wfm_decided_s")},
            se.employee_code AS submitter_code, ${NAME("se")} AS submitter_name, ${NAME("me")} AS manager_name
       FROM roster_team_submission s
       LEFT JOIN employees se ON se.id = s.submitter_employee_id
       LEFT JOIN employees me ON me.id = s.manager_approver_employee_id
      WHERE s.id = ? LIMIT 1`, [id],
  ))[0];
  const caller = await resolveCallerEmployee(actor.id);
  // 404 rather than 403 for a stranger, so submission ids cannot be probed.
  if (!s || !(await canView(actor, s, caller?.id ?? null))) throw new TeamRosterError(404, "Submission not found.", "NOT_FOUND");

  const lines = rowsOf<RowDataPacket>(await db.execute(
    `SELECT l.id, l.employee_id, ${DATE("l.roster_date", "d")}, l.kind, l.old_assignment_type, l.old_shift_start_time, l.old_shift_end_time,
            l.new_assignment_type, l.reason, l.warnings_json, l.line_status, l.skip_reason, l.applied_assignment_id,
            e.employee_code, ${NAME("e")} AS employee_name, ot.shift_code AS old_code, nt.shift_code AS new_code,
            l.new_shift_start_time AS new_start, l.new_shift_end_time AS new_end
       FROM roster_team_submission_line l
       LEFT JOIN employees e ON e.id = l.employee_id
       LEFT JOIN wfm_shift_template ot ON ot.id = l.old_shift_template_id
       LEFT JOIN wfm_shift_template nt ON nt.id = l.new_shift_template_id
      WHERE l.submission_id = ? ORDER BY l.roster_date, e.employee_code`, [id],
  ));
  const timeline = rowsOf<RowDataPacket>(await db.execute(
    `SELECT a.action, a.actor_role, a.remarks, a.meta_json, ${STAMP("a.created_at", "at")}, ${NAME("ae")} AS actor_name
       FROM roster_team_submission_audit a LEFT JOIN employees ae ON ae.user_id = a.actor_user_id
      WHERE a.submission_id = ? ORDER BY a.id`, [id],
  ));
  const decorated = lines.map((l) => ({
    id: Number(l.id), employeeId: String(l.employee_id), employeeCode: l.employee_code ? String(l.employee_code) : null,
    employeeName: String(l.employee_name ?? ""), date: String(l.d), kind: String(l.kind),
    old: l.kind === "CHANGE" ? { type: l.old_assignment_type ? String(l.old_assignment_type) : null, label: label(l.old_code, l.old_shift_start_time, l.old_shift_end_time) } : null,
    new: { type: String(l.new_assignment_type), label: label(l.new_code, l.new_start, l.new_end) },
    reason: l.reason ? String(l.reason) : null, warnings: parseWarnings(l.warnings_json),
    status: String(l.line_status), skipReason: l.skip_reason ? String(l.skip_reason) : null,
    appliedAssignmentId: l.applied_assignment_id ? String(l.applied_assignment_id) : null,
  }));
  const count = (st: string) => decorated.filter((l) => l.status === st).length;
  const isSelf = Boolean(caller && caller.id === String(s.submitter_employee_id)) || String(s.submitter_user_id ?? "") === actor.id;
  const named = Boolean(caller && String(s.manager_approver_employee_id ?? "") === caller.id);
  let canWfm = s.status === SUBMISSION_STATUS.PENDING_WFM && isWfmApprover(actor) && !isSelf;
  if (canWfm) canWfm = await assertWfmScopeCoversSubmission(actor, id).then(() => true, () => false);
  return {
    submission: {
      id, submissionNo: s.submission_no ? String(s.submission_no) : null, status: String(s.status),
      from: s.from_d ? String(s.from_d) : null, to: s.to_d ? String(s.to_d) : null, note: s.note ? String(s.note) : null,
      submitter: { id: String(s.submitter_employee_id), code: s.submitter_code ? String(s.submitter_code) : null, name: String(s.submitter_name ?? "") },
      managerApprover: s.manager_approver_employee_id ? { id: String(s.manager_approver_employee_id), name: String(s.manager_name ?? "") } : null,
      managerStepSkipped: !s.manager_approver_employee_id,
      managerDecision: s.manager_decision ? { decision: String(s.manager_decision), at: s.manager_decided_s ?? null, remarks: s.manager_remarks ?? null } : null,
      wfmDecision: s.wfm_decision ? { decision: String(s.wfm_decision), at: s.wfm_decided_s ?? null, remarks: s.wfm_remarks ?? null } : null,
      createdAt: s.created_s ?? null, submittedAt: s.submitted_s ?? null, appliedAt: s.applied_s ?? null,
    },
    lines: decorated,
    summary: { total: decorated.length, applied: count("applied"), skipped: count("skipped"), failed: count("failed"), pending: count("pending"), withWarnings: decorated.filter((l) => l.warnings.length).length },
    timeline: timeline.map((t) => ({
      action: String(t.action), actorName: t.actor_name ? String(t.actor_name) : null, actorRole: t.actor_role ? String(t.actor_role) : null,
      remarks: t.remarks ? String(t.remarks) : null, at: String(t.at), meta: safeJson(t.meta_json),
    })),
    permissions: {
      canCancel: isSelf && (PENDING_STATUSES as readonly string[]).includes(String(s.status)),
      canManagerDecide: s.status === SUBMISSION_STATUS.PENDING_MANAGER && !isSelf && (named || isGlobalApprover(actor)),
      canWfmDecide: canWfm,
      canCopyToDraft: isSelf && ["rejected", "cancelled", "partially_applied"].includes(String(s.status)),
    },
  };
}

function safeJson(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
