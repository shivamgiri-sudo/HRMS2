/**
 * Team Roster - read side for the manager's page: who am I (/me), which shifts may I pick
 * (/templates), and the team x dates grid (/grid). Writes live in team-roster-draft.ts (draft +
 * submit), team-roster-workflow.ts (approvals) and team-roster-apply.ts (final apply).
 *
 * Row scope: every read starts from resolveTeamTree(caller). An employee outside the caller's
 * reporting tree can never appear in any response of this file.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { lobCondition, type LobFilter } from "../../shared/lobFilter.js";
import { lookupLobNames } from "../../shared/lobNames.js";
import { loadShiftOptions } from "./team-roster-shifts.js";
import { loadApprovedLeave } from "./roster-leave-guard.service.js";
import { resolveCallerEmployee, resolveTeamTree, type CallerEmployee } from "./team-roster-tree.js";
import {
  DEFAULT_GRID_PAGE, MAX_GRID_PAGE, MAX_RANGE_DAYS, TeamRosterError, effectiveType, eachDate, isGlobalApprover,
  isValidYmd, isWfmApprover, placeholders, rowsOf, snapshotOf, spanDays, todayIst, type Actor,
} from "./team-roster-types.js";

const NAME_EXPR = `COALESCE(NULLIF(e.full_name, ''), TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))))`;
const hhmm = (t: unknown) => (t == null || t === "" ? null : String(t).slice(0, 5));

export async function requireCaller(actor: Actor): Promise<CallerEmployee> {
  const caller = await resolveCallerEmployee(actor.id);
  if (!caller) {
    throw new TeamRosterError(403, "Your login is not linked to an employee record.", "NO_EMPLOYEE");
  }
  return caller;
}

/** The caller's team; throws NO_TEAM when they have nobody reporting to them. */
export async function requireTeam(actor: Actor): Promise<{ caller: CallerEmployee; teamIds: string[]; truncated: boolean }> {
  const caller = await requireCaller(actor);
  const tree = await resolveTeamTree(caller.id);
  if (!tree.ids.length) throw new TeamRosterError(403, "You have no team members reporting to you.", "NO_TEAM");
  return { caller, teamIds: tree.ids, truncated: tree.truncated };
}

async function isManagerApprover(callerId: string): Promise<boolean> {
  // Someone below me who is themselves a manager (their submissions route to me), or a submission
  // already snapshotted to me.
  const below = rowsOf<RowDataPacket>(await db.execute(
    `SELECT 1 AS x FROM employees c
      WHERE c.active_status = 1 AND (c.reporting_manager_id = ? OR c.manager_id = ?)
        AND EXISTS (SELECT 1 FROM employees g WHERE g.active_status = 1 AND (g.reporting_manager_id = c.id OR g.manager_id = c.id))
      LIMIT 1`,
    [callerId, callerId],
  ));
  if (below.length) return true;
  const assigned = rowsOf<RowDataPacket>(await db.execute(
    `SELECT 1 AS x FROM roster_team_submission WHERE manager_approver_employee_id = ? LIMIT 1`, [callerId],
  ));
  return assigned.length > 0;
}

export async function getMe(actor: Actor) {
  const caller = await resolveCallerEmployee(actor.id);
  const tree = caller ? await resolveTeamTree(caller.id) : { ids: [], truncated: false, depth: 0 };
  const globalApprover = isGlobalApprover(actor);
  return {
    employee: caller ? { id: caller.id, code: caller.code, name: caller.name } : null,
    isManager: tree.ids.length > 0,
    teamSize: tree.ids.length,
    teamTruncated: tree.truncated,
    hasReportingManager: Boolean(caller?.reportingManagerId),
    canApproveManagerStep: globalApprover || (caller ? await isManagerApprover(caller.id) : false),
    canApproveWfmStep: isWfmApprover(actor),
    today: todayIst(),
    maxRangeDays: MAX_RANGE_DAYS,
  };
}

export async function listTemplates(actor: Actor) {
  const { teamIds } = await requireTeam(actor);
  const procRows = rowsOf<RowDataPacket>(await db.execute(
    `SELECT DISTINCT e.process_id, pm.process_name, e.lob_id
       FROM employees e LEFT JOIN process_master pm ON pm.id = e.process_id
      WHERE e.id IN (${placeholders(teamIds.length)}) AND e.process_id IS NOT NULL`,
    teamIds,
  ));
  const processIds = procRows.map((r) => String(r.process_id));
  if (!processIds.length) return { processes: [] };
  const today = todayIst();
  const tplRows = rowsOf<RowDataPacket>(await db.execute(
    `SELECT id, shift_code, shift_name, version, process_id, start_time, end_time, night_shift
       FROM wfm_shift_template
      WHERE process_id IN (${placeholders(processIds.length)}) AND active_status = 1
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY process_id, shift_code, version DESC`,
    [...processIds, today],
  ));
  const seen = new Set<string>();
  const byProcess = new Map<string, any[]>();
  for (const t of tplRows) {
    const key = `${t.process_id}|${t.shift_code}`;
    if (seen.has(key)) continue; // newest version of each shift_code only
    seen.add(key);
    const start = hhmm(t.start_time);
    const end = hhmm(t.end_time);
    const list = byProcess.get(String(t.process_id)) ?? [];
    list.push({
      id: String(t.id), shiftCode: String(t.shift_code ?? ""), shiftName: String(t.shift_name ?? ""),
      start, end, night: Boolean(start && end && end <= start) || Number(t.night_shift) === 1,
    });
    byProcess.set(String(t.process_id), list);
  }
  const options = await loadShiftOptions(processIds, today);
  return {
    processes: procRows.map((r) => ({
      processId: String(r.process_id),
      processName: r.process_name ? String(r.process_name) : null,
      templates: byProcess.get(String(r.process_id)) ?? [],
      // Merged shift options (templates + shifts actually in use + shift master), de-duplicated by (start, end).
      options: (options.get(String(r.process_id)) ?? []).map(({ effectiveFrom: _f, effectiveTo: _t, ...o }) => o),
    })),
  };
}

export interface GridQuery { from: string; to: string; search?: string; processId?: string; offset?: number; limit?: number; lob?: LobFilter }

function validateRange(from: string, to: string) {
  if (!isValidYmd(from) || !isValidYmd(to)) throw new TeamRosterError(400, "from and to must be valid YYYY-MM-DD dates.", "BAD_DATE");
  if (to < from) throw new TeamRosterError(400, "to must not be before from.", "BAD_RANGE");
  if (spanDays(from, to) > MAX_RANGE_DAYS) {
    throw new TeamRosterError(400, `A range can span at most ${MAX_RANGE_DAYS} days.`, "RANGE_TOO_LONG");
  }
}

export async function getGrid(actor: Actor, q: GridQuery) {
  validateRange(q.from, q.to);
  const { caller, teamIds, truncated } = await requireTeam(actor);
  const limit = Math.min(Math.max(Math.trunc(q.limit ?? DEFAULT_GRID_PAGE), 1), MAX_GRID_PAGE);
  const offset = Math.max(Math.trunc(q.offset ?? 0), 0);

  const where = [`e.id IN (${placeholders(teamIds.length)})`];
  const params: unknown[] = [...teamIds];
  const search = (q.search ?? "").trim().slice(0, 100);
  if (search) {
    where.push(`(e.full_name LIKE ? OR e.employee_code LIKE ? OR e.first_name LIKE ? OR e.last_name LIKE ?)`);
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  const lobCond = q.lob ? lobCondition(q.lob, "e") : null;
  if (lobCond) { where.push(lobCond.sql); params.push(...lobCond.params); }
  if (q.processId) { where.push("e.process_id = ?"); params.push(q.processId); }
  const total = Number(rowsOf<RowDataPacket>(await db.execute(
    `SELECT COUNT(*) AS c FROM employees e WHERE ${where.join(" AND ")}`, params,
  ))[0]?.c ?? 0);
  const people = rowsOf<RowDataPacket>(await db.execute(
    `SELECT e.id, e.employee_code, ${NAME_EXPR} AS name, e.process_id, pm.process_name
       FROM employees e LEFT JOIN process_master pm ON pm.id = e.process_id
      WHERE ${where.join(" AND ")} ORDER BY name, e.employee_code LIMIT ${limit} OFFSET ${offset}`,
    params,
  ));
  const ids = people.map((p) => String(p.id));
  const lobNames = await lookupLobNames(people.map((p) => (p.lob_id ? String(p.lob_id) : null)));
  const dates = eachDate(q.from, q.to);
  const cellsOf = new Map<string, Record<string, Record<string, unknown>>>(ids.map((id) => [id, {}]));
  const put = (emp: string, date: string, field: string, value: unknown) => {
    const cells = cellsOf.get(emp);
    if (!cells) return;
    (cells[date] ??= {})[field] = value;
  };

  if (ids.length) await overlayCells({ ids, from: q.from, to: q.to, callerId: caller.id, put });
  return {
    from: q.from, to: q.to, today: todayIst(), dates, total, offset, limit, teamTruncated: truncated,
    rows: people.map((p) => ({
      employeeId: String(p.id),
      code: p.employee_code ? String(p.employee_code) : null,
      name: String(p.name ?? ""),
      processId: p.process_id ? String(p.process_id) : null,
      processName: p.process_name ? String(p.process_name) : null,
      lobId: p.lob_id ? String(p.lob_id) : null,
      lobName: p.lob_id ? (lobNames.get(String(p.lob_id)) ?? null) : null,
      cells: cellsOf.get(String(p.id)) ?? {},
    })),
  };
}

async function overlayCells(o: { ids: string[]; from: string; to: string; callerId: string; put: (e: string, d: string, f: string, v: unknown) => void }) {
  const marks = placeholders(o.ids.length);
  const assignments = rowsOf<RowDataPacket>(await db.execute(
    `SELECT wra.id, wra.employee_id, DATE_FORMAT(wra.roster_date, '%Y-%m-%d') AS d, wra.assignment_type, wra.is_week_off,
            wra.shift_template_id, wra.shift_start_time, wra.shift_end_time, wra.final_roster_status,
            wst.shift_code, wst.shift_name
       FROM wfm_roster_assignment wra LEFT JOIN wfm_shift_template wst ON wst.id = wra.shift_template_id
      WHERE wra.employee_id IN (${marks}) AND wra.roster_date BETWEEN ? AND ?`,
    [...o.ids, o.from, o.to],
  ));
  for (const a of assignments) {
    const snap = snapshotOf(a);
    o.put(String(a.employee_id), String(a.d), "assignment", {
      id: snap.assignmentId, type: snap.assignmentType, isWeekOff: snap.isWeekOff, shiftTemplateId: snap.shiftTemplateId,
      shiftCode: a.shift_code ? String(a.shift_code) : null, shiftName: a.shift_name ? String(a.shift_name) : null,
      start: snap.shiftStartTime, end: snap.shiftEndTime,
      finalStatus: a.final_roster_status ? String(a.final_roster_status) : null,
      effectiveType: effectiveType(a as Record<string, unknown>),
    });
  }
  const locks = rowsOf<RowDataPacket>(await db.execute(
    `SELECT p.employee_id, DATE_FORMAT(p.roster_date, '%Y-%m-%d') AS d, s.id AS submission_id, s.submission_no, s.status,
            ${NAME_EXPR} AS submitter_name
       FROM roster_team_pending_cell p
       JOIN roster_team_submission s ON s.id = p.submission_id
       LEFT JOIN employees e ON e.id = s.submitter_employee_id
      WHERE p.employee_id IN (${marks}) AND p.roster_date BETWEEN ? AND ?`,
    [...o.ids, o.from, o.to],
  ));
  for (const l of locks) {
    o.put(String(l.employee_id), String(l.d), "lockedBy", {
      submissionId: Number(l.submission_id), submissionNo: l.submission_no ? String(l.submission_no) : null,
      status: String(l.status), submitter: String(l.submitter_name ?? ""),
    });
  }
  const drafts = rowsOf<RowDataPacket>(await db.execute(
    `SELECT l.employee_id, DATE_FORMAT(l.roster_date, '%Y-%m-%d') AS d, l.kind, l.new_assignment_type, l.new_shift_template_id,
            l.new_shift_start_time, l.new_shift_end_time, l.reason
       FROM roster_team_submission_line l JOIN roster_team_submission s ON s.id = l.submission_id
      WHERE s.draft_owner_key = ? AND l.employee_id IN (${marks}) AND l.roster_date BETWEEN ? AND ?`,
    [o.callerId, ...o.ids, o.from, o.to],
  ));
  for (const l of drafts) {
    o.put(String(l.employee_id), String(l.d), "draft", {
      kind: String(l.kind), type: String(l.new_assignment_type),
      shiftTemplateId: l.new_shift_template_id ? String(l.new_shift_template_id) : null,
      shiftStart: l.new_shift_start_time ? String(l.new_shift_start_time).slice(0, 5) : null,
      shiftEnd: l.new_shift_end_time ? String(l.new_shift_end_time).slice(0, 5) : null,
      reason: l.reason ? String(l.reason) : null,
    });
  }
  try {
    const leave = await loadApprovedLeave(o.ids, o.from, o.to);
    for (const [emp, byDate] of leave) {
      for (const [d, kind] of byDate) if (d >= o.from && d <= o.to) o.put(emp, d, "leave", kind);
    }
  } catch (err) {
    console.error("[team-roster] leave markers unavailable:", (err as Error)?.message);
  }
}
