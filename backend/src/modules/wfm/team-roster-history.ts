/**
 * Team Roster - history (every submission the caller may see, whatever its state) and the flat export.
 *
 * The approval queues only show what is still waiting, so once a request was approved it vanished from
 * the page. This is the permanent log: who raised what, what each approver decided and when, and what
 * finally landed in the roster. Visibility mirrors getSubmissionDetail/canView: global approvers see
 * everything, WFM sees submissions holding at least one employee in their scope, everyone else sees what
 * they raised or are the named manager approver for.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveCallerEmployee } from "./team-roster-tree.js";
import { wfmEmployeeScope } from "./team-roster-workflow.js";
import { SUBMISSION_STATUS, TeamRosterError, isGlobalApprover, isWfmApprover, rowsOf, type Actor } from "./team-roster-types.js";

export const HISTORY_EXPORT_MAX_ROWS = 50000;

export interface HistoryFilter {
  from?: string;
  to?: string;
  status?: string;
  branchId?: string;
  processId?: string;
  managerId?: string;
  search?: string;
  offset?: number;
  limit?: number;
}

const NAME = (a: string) => `COALESCE(NULLIF(${a}.full_name, ''), TRIM(CONCAT(COALESCE(${a}.first_name, ''), ' ', COALESCE(${a}.last_name, ''))))`;
const STAMP = (c: string, alias: string) => `DATE_FORMAT(${c}, '%Y-%m-%d %H:%i:%s') AS ${alias}`;
const DATE = (c: string, alias: string) => `DATE_FORMAT(${c}, '%Y-%m-%d') AS ${alias}`;

/** WHERE fragments (alias `s` = roster_team_submission) for what the caller may see plus the user's filters. */
async function buildWhere(actor: Actor, f: HistoryFilter): Promise<{ where: string[]; params: unknown[] }> {
  const where: string[] = [`s.status <> 'draft'`];
  const params: unknown[] = [];
  const caller = await resolveCallerEmployee(actor.id);

  if (!isGlobalApprover(actor)) {
    const ors: string[] = [];
    if (caller) {
      ors.push(`s.submitter_employee_id = ?`, `s.manager_approver_employee_id = ?`);
      params.push(caller.id, caller.id);
    }
    if (isWfmApprover(actor)) {
      const scope = await wfmEmployeeScope(actor);
      ors.push(`EXISTS (SELECT 1 FROM roster_team_submission_line vl JOIN employees ve ON ve.id = vl.employee_id
                         WHERE vl.submission_id = s.id AND ${scope.sql.replace(/\be\./g, "ve.")})`);
      params.push(...scope.params);
    }
    if (!ors.length) throw new TeamRosterError(403, "You have no team roster history to view.", "NOT_ALLOWED");
    where.push(`(${ors.join(" OR ")})`);
  }

  if (f.from) { where.push(`s.to_date >= ?`); params.push(f.from); }
  if (f.to) { where.push(`s.from_date <= ?`); params.push(f.to); }
  if (f.status && Object.values(SUBMISSION_STATUS).includes(f.status as never)) { where.push(`s.status = ?`); params.push(f.status); }
  if (f.managerId) {
    where.push(`(s.submitter_employee_id = ? OR s.manager_approver_employee_id = ?)`);
    params.push(f.managerId, f.managerId);
  }
  if (f.branchId || f.processId) {
    const parts: string[] = [];
    if (f.branchId) { parts.push(`fe.branch_id = ?`); params.push(f.branchId); }
    if (f.processId) { parts.push(`fe.process_id = ?`); params.push(f.processId); }
    where.push(`EXISTS (SELECT 1 FROM roster_team_submission_line fl JOIN employees fe ON fe.id = fl.employee_id
                         WHERE fl.submission_id = s.id AND ${parts.join(" AND ")})`);
  }
  if (f.search) {
    const like = `%${f.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(`(s.submission_no LIKE ? OR EXISTS (SELECT 1 FROM employees x WHERE x.id = s.submitter_employee_id AND (x.employee_code LIKE ? OR ${NAME("x")} LIKE ?)))`);
    params.push(like, like, like);
  }
  return { where, params };
}

const clamp = (offset?: number, limit?: number) => ({
  offset: Math.max(Math.trunc(offset ?? 0), 0),
  limit: Math.min(Math.max(Math.trunc(limit ?? 25), 1), 200),
});

export async function listHistory(actor: Actor, f: HistoryFilter) {
  const { where, params } = await buildWhere(actor, f);
  const { offset, limit } = clamp(f.offset, f.limit);
  const w = where.join(" AND ");
  const total = Number(rowsOf<RowDataPacket>(await db.execute(`SELECT COUNT(*) AS c FROM roster_team_submission s WHERE ${w}`, params))[0]?.c ?? 0);
  const rows = rowsOf<RowDataPacket>(await db.execute(
    `SELECT s.id, s.submission_no, s.status, ${DATE("s.from_date", "from_d")}, ${DATE("s.to_date", "to_d")},
            ${STAMP("s.submitted_at", "submitted_s")}, ${STAMP("s.manager_decided_at", "mgr_at")}, ${STAMP("s.wfm_decided_at", "wfm_at")},
            ${STAMP("s.applied_at", "applied_s")}, s.manager_decision, s.wfm_decision,
            se.employee_code AS submitter_code, ${NAME("se")} AS submitter_name, ${NAME("me")} AS manager_name,
            ${NAME("mdu")} AS manager_decided_by_name, ${NAME("wdu")} AS wfm_decided_by_name,
            (SELECT COUNT(*) FROM roster_team_submission_line l WHERE l.submission_id = s.id) AS line_count,
            (SELECT COUNT(*) FROM roster_team_submission_line l WHERE l.submission_id = s.id AND l.line_status = 'applied') AS applied_count,
            (SELECT COUNT(*) FROM roster_team_submission_line l WHERE l.submission_id = s.id AND l.line_status IN ('skipped','failed')) AS skipped_count,
            (SELECT GROUP_CONCAT(DISTINCT b.branch_name ORDER BY b.branch_name SEPARATOR ', ')
               FROM roster_team_submission_line l JOIN employees le ON le.id = l.employee_id
               JOIN branch_master b ON b.id = le.branch_id WHERE l.submission_id = s.id) AS branches,
            (SELECT GROUP_CONCAT(DISTINCT p.process_name ORDER BY p.process_name SEPARATOR ', ')
               FROM roster_team_submission_line l JOIN employees le ON le.id = l.employee_id
               JOIN process_master p ON p.id = le.process_id WHERE l.submission_id = s.id) AS processes
       FROM roster_team_submission s
       LEFT JOIN employees se ON se.id = s.submitter_employee_id
       LEFT JOIN employees me ON me.id = s.manager_approver_employee_id
       LEFT JOIN employees mdu ON mdu.user_id = s.manager_decided_by
       LEFT JOIN employees wdu ON wdu.user_id = s.wfm_decided_by
      WHERE ${w}
      ORDER BY COALESCE(s.submitted_at, s.created_at) DESC, s.id DESC LIMIT ${limit} OFFSET ${offset}`, params,
  ));
  const items = rows.map((r) => ({
    id: Number(r.id), submissionNo: r.submission_no ? String(r.submission_no) : null, status: String(r.status),
    from: r.from_d ? String(r.from_d) : null, to: r.to_d ? String(r.to_d) : null,
    submittedAt: r.submitted_s ? String(r.submitted_s) : null, appliedAt: r.applied_s ? String(r.applied_s) : null,
    submitter: { code: r.submitter_code ? String(r.submitter_code) : null, name: String(r.submitter_name ?? "") },
    managerApprover: r.manager_name ? String(r.manager_name) : null,
    managerDecision: r.manager_decision ? { decision: String(r.manager_decision), at: r.mgr_at ? String(r.mgr_at) : null, by: r.manager_decided_by_name ? String(r.manager_decided_by_name) : null } : null,
    wfmDecision: r.wfm_decision ? { decision: String(r.wfm_decision), at: r.wfm_at ? String(r.wfm_at) : null, by: r.wfm_decided_by_name ? String(r.wfm_decided_by_name) : null } : null,
    raised: Number(r.line_count ?? 0), applied: Number(r.applied_count ?? 0), skipped: Number(r.skipped_count ?? 0),
    branches: r.branches ? String(r.branches) : "", processes: r.processes ? String(r.processes) : "",
  }));
  return { items, total, offset, limit };
}

/** Distinct branches / processes / managers inside what the caller may see, to fill the filter dropdowns. */
export async function historyFilterOptions(actor: Actor) {
  const { where, params } = await buildWhere(actor, {});
  const w = where.join(" AND ");
  const rows = rowsOf<RowDataPacket>(await db.execute(
    `SELECT DISTINCT b.id AS branch_id, b.branch_name, p.id AS process_id, p.process_name
       FROM roster_team_submission s
       JOIN roster_team_submission_line l ON l.submission_id = s.id
       JOIN employees e ON e.id = l.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE ${w} LIMIT 5000`, params,
  ));
  const managers = rowsOf<RowDataPacket>(await db.execute(
    `SELECT DISTINCT m.id, ${NAME("m")} AS name FROM roster_team_submission s
       JOIN employees m ON m.id = s.submitter_employee_id OR m.id = s.manager_approver_employee_id
      WHERE ${w} LIMIT 2000`, params,
  ));
  const branches = new Map<string, string>();
  const processes = new Map<string, { name: string; branchId: string | null }>();
  for (const r of rows) {
    if (r.branch_id) branches.set(String(r.branch_id), String(r.branch_name ?? ""));
    if (r.process_id) processes.set(String(r.process_id), { name: String(r.process_name ?? ""), branchId: r.branch_id ? String(r.branch_id) : null });
  }
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  return {
    branches: [...branches].map(([id, name]) => ({ id, name })).sort(byName),
    processes: [...processes].map(([id, v]) => ({ id, name: v.name, branchId: v.branchId })).sort(byName),
    managers: managers.map((m) => ({ id: String(m.id), name: String(m.name ?? "") })).filter((m) => m.name).sort(byName),
  };
}

/**
 * One row per raised cell, sorted branch > process > manager so a plain sheet reads "process wise,
 * manager wise". Scope and filters are exactly the history list's; capped to keep the response bounded.
 */
export async function exportHistoryRows(actor: Actor, f: HistoryFilter) {
  const { where, params } = await buildWhere(actor, { ...f, offset: 0 });
  const rows = rowsOf<RowDataPacket>(await db.execute(
    `SELECT s.id AS submission_id, s.submission_no, s.status, ${DATE("s.from_date", "from_d")}, ${DATE("s.to_date", "to_d")},
            ${STAMP("s.submitted_at", "submitted_s")}, s.note,
            se.employee_code AS submitter_code, ${NAME("se")} AS submitter_name, ${NAME("me")} AS manager_name,
            s.manager_decision, ${STAMP("s.manager_decided_at", "mgr_at")}, s.manager_remarks, ${NAME("mdu")} AS mgr_by,
            s.wfm_decision, ${STAMP("s.wfm_decided_at", "wfm_at")}, s.wfm_remarks, ${NAME("wdu")} AS wfm_by,
            ${STAMP("s.applied_at", "applied_s")},
            b.branch_name, p.process_name, e.employee_code, ${NAME("e")} AS employee_name,
            ${DATE("l.roster_date", "roster_d")}, l.kind, l.old_assignment_type, l.old_shift_start_time, l.old_shift_end_time,
            l.new_assignment_type, l.new_shift_start_time, l.new_shift_end_time, l.reason, l.line_status, l.skip_reason
       FROM roster_team_submission s
       JOIN roster_team_submission_line l ON l.submission_id = s.id
       LEFT JOIN employees e ON e.id = l.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN employees se ON se.id = s.submitter_employee_id
       LEFT JOIN employees me ON me.id = s.manager_approver_employee_id
       LEFT JOIN employees mdu ON mdu.user_id = s.manager_decided_by
       LEFT JOIN employees wdu ON wdu.user_id = s.wfm_decided_by
      WHERE ${where.join(" AND ")}
      ORDER BY b.branch_name, p.process_name, ${NAME("se")}, s.id, l.roster_date, e.employee_code
      LIMIT ${HISTORY_EXPORT_MAX_ROWS + 1}`, params,
  ));
  const truncated = rows.length > HISTORY_EXPORT_MAX_ROWS;
  const time = (s: unknown, e: unknown) => (s && e ? `${String(s).slice(0, 5)}-${String(e).slice(0, 5)}` : "");
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    truncated,
    max: HISTORY_EXPORT_MAX_ROWS,
    rows: rows.slice(0, HISTORY_EXPORT_MAX_ROWS).map((r) => ({
      branch: str(r.branch_name), process: str(r.process_name),
      submissionNo: str(r.submission_no), status: str(r.status),
      raisedBy: str(r.submitter_name), raisedByCode: str(r.submitter_code), raisedAt: str(r.submitted_s),
      periodFrom: str(r.from_d), periodTo: str(r.to_d),
      managerApprover: str(r.manager_name),
      managerDecision: str(r.manager_decision), managerDecidedBy: str(r.mgr_by), managerDecidedAt: str(r.mgr_at), managerRemarks: str(r.manager_remarks),
      wfmDecision: str(r.wfm_decision), wfmDecidedBy: str(r.wfm_by), wfmDecidedAt: str(r.wfm_at), wfmRemarks: str(r.wfm_remarks),
      appliedAt: str(r.applied_s),
      employeeCode: str(r.employee_code), employeeName: str(r.employee_name), rosterDate: str(r.roster_d),
      kind: str(r.kind),
      oldAssignment: [str(r.old_assignment_type), time(r.old_shift_start_time, r.old_shift_end_time)].filter(Boolean).join(" "),
      newAssignment: [str(r.new_assignment_type), time(r.new_shift_start_time, r.new_shift_end_time)].filter(Boolean).join(" "),
      reason: str(r.reason), lineResult: str(r.line_status), skipReason: str(r.skip_reason), submissionNote: str(r.note),
    })),
  };
}
