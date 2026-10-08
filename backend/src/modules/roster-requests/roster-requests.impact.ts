/**
 * Roster table map (which table feeds what):
 * - wfm_roster_assignment (wra): the LIVE per-employee/day roster. Read by the roster view
 *   (roster-view.service, team-roster-*), the attendance engine (attendance-engine.service),
 *   rta.service, rest-policy and roster-lock-guard. Week-off rows carry is_week_off=1 and
 *   roster_status='Week Off'; shift comes from shift_template_id -> wfm_shift_template.
 * - roster_daily_assignment (rda): the weekly-cycle governance table (weekly_roster_cycle ->
 *   rda, with acknowledgement_status incl. 'disputed'). Read by roster.governance.*, roster
 *   self-service and rta-sync.service (rta-sync reads ONLY this table, by cycle). It is NOT read
 *   by the roster view or attendance engine, which use wfm_roster_assignment.
 * - Therefore: weekoff_rejection uses wfm_roster_assignment, dispute uses roster_daily_assignment,
 *   swap/conflict resolve the day's wfm_roster_assignment by (employee_id, roster_date).
 * Schema: wfm_roster_assignment has employee_id, roster_date, roster_status VARCHAR(50), process_name,
 *   shift_template_id (mig 228), is_week_off (mig 228), final_roster_status, cycle_id.
 *   wfm_shift_template has shift_name, start_time, end_time.
 */
import type { RowDataPacket } from "mysql2";
import { db as defaultDb } from "../../db/mysql.js";
import { validateMinimumRest as defaultRest } from "../wfm/rest-policy.service.js";
import { checkAssignmentDateNotLocked as defaultLock } from "../roster/roster-lock-guard.js";
import type { ImpactResult, RequestKind } from "./roster-requests.types.js";

export interface ImpactDeps {
  db: { execute: (sql: string, params?: unknown[]) => Promise<any> };
  validateMinimumRest: typeof defaultRest;
  checkAssignmentDateNotLocked: typeof defaultLock;
}
const defaultDeps: ImpactDeps = { db: defaultDb as any, validateMinimumRest: defaultRest, checkAssignmentDateNotLocked: defaultLock };

const notFound = (m: string) => Object.assign(new Error(m), { statusCode: 404 });
const day = (v: unknown) => String(v instanceof Date ? v.toISOString() : v).slice(0, 10);

async function loadAssignment(kind: RequestKind, id: string, d: ImpactDeps) {
  if (kind === "weekoff_rejection") {
    const [rows] = await d.db.execute(
      `SELECT wra.id, wra.employee_id, wra.roster_date, wra.process_name, wra.shift_template_id,
              wst.start_time, wst.end_time, wst.shift_name, e.branch_id, e.process_id
         FROM wfm_roster_assignment wra
         JOIN employees e ON e.id = wra.employee_id
         LEFT JOIN wfm_shift_template wst ON wst.id = wra.shift_template_id
        WHERE wra.id = ? LIMIT 1`, [id]);
    return (rows as RowDataPacket[])[0] ?? null;
  }
  if (kind === "dispute") {
    const [rows] = await d.db.execute(
      `SELECT rda.id, rda.employee_id, rda.roster_date, NULL AS process_name, rda.shift_template_id,
              wst.start_time, wst.end_time, wst.shift_name, e.branch_id, wrc.process_id
         FROM roster_daily_assignment rda
         JOIN employees e ON e.id = rda.employee_id
         JOIN weekly_roster_cycle wrc ON wrc.id = rda.cycle_id
         LEFT JOIN wfm_shift_template wst ON wst.id = rda.shift_template_id
        WHERE rda.id = ? LIMIT 1`, [id]);
    return (rows as RowDataPacket[])[0] ?? null;
  }
  if (kind === "swap") {
    const [rows] = await d.db.execute(
      `SELECT s.id, s.requester_emp_id AS employee_id, s.swap_date AS roster_date, wra.process_name,
              wra.shift_template_id, wst.start_time, wst.end_time, wst.shift_name, e.branch_id, e.process_id, s.swap_with_emp_id AS counterpart_employee_id
         FROM wfm_roster_swap_request s
         JOIN employees e ON e.id = s.requester_emp_id
         LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = s.requester_emp_id AND wra.roster_date = s.swap_date
         LEFT JOIN wfm_shift_template wst ON wst.id = wra.shift_template_id
        WHERE s.id = ? LIMIT 1`, [id]);
    return (rows as RowDataPacket[])[0] ?? null;
  }
  const [rows] = await d.db.execute(
    `SELECT c.id, c.employee_id, c.conflict_date AS roster_date, wra.process_name, wra.shift_template_id,
            wst.start_time, wst.end_time, wst.shift_name, e.branch_id, e.process_id
       FROM wfm_roster_conflict_log c
       JOIN employees e ON e.id = c.employee_id
       LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = c.employee_id AND wra.roster_date = c.conflict_date
       LEFT JOIN wfm_shift_template wst ON wst.id = wra.shift_template_id
      WHERE c.id = ? LIMIT 1`, [id]);
  return (rows as RowDataPacket[])[0] ?? null;
}

/** A proposed outcome to evaluate instead of the current one (e.g. a dispute approve with a new shift). */
export interface ImpactCandidate {
  shiftTemplateId?: string | null;
}

export async function computeImpact(
  kind: RequestKind,
  id: string,
  deps: ImpactDeps = defaultDeps,
  candidate?: ImpactCandidate,
): Promise<ImpactResult> {
  const a: any = await loadAssignment(kind, id, deps);
  if (!a) throw notFound("Roster request not found");

  const date = day(a.roster_date);
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Candidate shift: rest is evaluated for the shift the decision would PUT in place, not the
  // current one (a dispute approve that moves the employee to a new shift).
  if (candidate?.shiftTemplateId && candidate.shiftTemplateId !== a.shift_template_id) {
    const [tpl] = await deps.db.execute(
      "SELECT id, shift_name, start_time, end_time FROM wfm_shift_template WHERE id = ? LIMIT 1",
      [candidate.shiftTemplateId]);
    const t = (tpl as RowDataPacket[])[0];
    if (!t) {
      blockers.push("Shift template not found");
      a.start_time = null;
      a.end_time = null;
    } else {
      a.shift_template_id = t.id;
      a.shift_name = t.shift_name ?? null;
      a.start_time = t.start_time ?? null;
      a.end_time = t.end_time ?? null;
    }
  }

  // The lock guard takes a wfm_roster_assignment id, so only weekoff_rejection can use it directly.
  let locked = false;
  if (kind === "weekoff_rejection") {
    const lock = await deps.checkAssignmentDateNotLocked(deps.db as any, id);
    if (lock.blocked) { locked = true; blockers.push(lock.error); }
  }

  // Week-off rows (no shift template / times) have nothing to rest-check.
  const rest: ImpactResult["rest"] = [];
  if (a.start_time && a.end_time) {
    const r: any = await deps.validateMinimumRest(
      { employeeId: a.employee_id, processId: a.process_id ?? null, branchId: a.branch_id ?? null, forDate: date },
      { startTime: String(a.start_time), endTime: String(a.end_time) },
      kind === "weekoff_rejection" ? id : null,
    );
    const message = r.ok ? null
      : r.reason === "INSUFFICIENT_REST" ? `Insufficient rest: ${r.actualRestMinutes}min vs ${r.requiredRestMinutes}min required`
      : "No rest policy configured";
    rest.push({ employeeId: a.employee_id, ok: !!r.ok, message });
    if (!r.ok) (r.reason === "INSUFFICIENT_REST" ? blockers : warnings).push(message!);
  }

  let sameDayHeadcount: ImpactResult["sameDayHeadcount"] = null;
  if (a.process_name) {
    const [cnt] = await deps.db.execute(
      `SELECT COUNT(*) AS planned FROM wfm_roster_assignment
        WHERE roster_date = ? AND process_name = ? AND is_week_off = 0 AND COALESCE(roster_status,'') <> 'Week Off'`,
      [date, a.process_name]);
    sameDayHeadcount = { date, processName: a.process_name, planned: Number((cnt as any[])[0]?.planned ?? 0) };
  }

  const loadWeek = async (employeeId: string) => {
    const [weekRows] = await deps.db.execute(
      `SELECT wra.roster_date, wst.shift_name,
              (wra.is_week_off = 1 OR COALESCE(wra.roster_status,'') = 'Week Off') AS is_week_off
         FROM wfm_roster_assignment wra
         LEFT JOIN wfm_shift_template wst ON wst.id = wra.shift_template_id
        WHERE wra.employee_id = ? AND wra.roster_date BETWEEN DATE_SUB(?, INTERVAL 3 DAY) AND DATE_ADD(?, INTERVAL 3 DAY)
        ORDER BY wra.roster_date`,
      [employeeId, date, date]);
    return {
      employeeId,
      days: (weekRows as any[]).map((r) => ({ date: day(r.roster_date), shiftName: r.shift_name ?? null, isWeekOff: Number(r.is_week_off) === 1 })),
    };
  };
  const week = [await loadWeek(a.employee_id as string)];
  // A swap touches the counterpart's roster too; include it so scope checks cover both employees.
  if (kind === "swap" && a.counterpart_employee_id && a.counterpart_employee_id !== a.employee_id) {
    week.push(await loadWeek(a.counterpart_employee_id as string));
  }

  return { kind, id, blockers, warnings, locked, rest, sameDayHeadcount, week };
}
