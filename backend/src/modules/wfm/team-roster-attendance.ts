/**
 * Team Roster - "Team Attendance": a read-only PREVIEW of the Attendance Register for the caller's
 * reporting tree.
 *
 * Nothing about attendance is re-derived here. Every per-day code and every month total comes from
 * attendanceRegisterMonthly() (reporting/executors/attendance.executor.ts) - the executor behind
 * /api/reports/suite/attendance-register-monthly - called with an explicit employee-id list, so the
 * status map, the "blank only before joining / after exit / in the future" fill rule
 * (shared/attendanceDayCounts.ts) and the week-off entitlement (calculateWeekoffEligibility) are the
 * register's own. This module only (a) resolves WHO may be asked about, server-side, from the
 * reporting tree, (b) validates the month, and (c) trims each row to what a manager should see: code,
 * name, designation, process, day codes and attendance day counts. No salary days, cost centre, bank,
 * statutory or contact fields leave this file. Attendance only: the roster tables are not read.
 *
 * Scope: the ids handed to the executor are always the caller's tree (optionally narrowed by search);
 * an employee id supplied by the client is only ever CHECKED against that tree, never used to widen it.
 * The register and payroll figures remain the source of truth; this is a preview.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { lobCondition, type LobFilter } from "../../shared/lobFilter.js";
import { lookupLobNames } from "../../shared/lobNames.js";
import { attendanceRegisterMonthly } from "../reporting/executors/attendance.executor.js";
import type { ExecScope } from "../reporting/executors/types.js";
import { resolveCallerEmployee, resolveTeamTree } from "./team-roster-tree.js";
import { DEFAULT_GRID_PAGE, MAX_GRID_PAGE, TeamRosterError, eachDate, placeholders, rowsOf, todayIst, type Actor } from "./team-roster-types.js";

/** Codes the register itself emits (ATTENDANCE_STATUS_CODE in shared/attendanceDayCounts.ts). */
export const ATTENDANCE_LEGEND: ReadonlyArray<{ code: string; label: string }> = [
  { code: "P", label: "Present" },
  { code: "A", label: "Absent" },
  { code: "HD", label: "Half day" },
  { code: "L", label: "Leave" },
  { code: "OD", label: "On duty" },
  { code: "H", label: "Holiday" },
];

export const ATTENDANCE_NOTES: readonly string[] = [
  "Preview only. The Attendance Register and payroll figures remain the source of truth.",
  "As in the register, week-off, missing-punch and leave-without-pay days appear as A, and a day is blank before joining, after exit and in the future.",
];

const EARLIEST_MONTH = "2020-01";

/** Scope is carried entirely by filters.employeeIds (the caller's tree); every dimension scope is left open. */
const TREE_ONLY_SCOPE: ExecScope = {
  companyId: "",
  isSuperAdmin: false,
  branchScope: { mode: "all", ids: [] },
  processScope: { mode: "all", ids: [] },
  departmentScope: { mode: "all", ids: [] },
  costCentreScope: { mode: "all", ids: [] },
  canViewAllEmployees: false,
  canViewSensitiveFields: false,
  canExportSensitiveReports: false,
  roles: [],
};

export function validateMonth(value: unknown, today = todayIst()): string {
  const month = String(value ?? "");
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new TeamRosterError(400, "month must be YYYY-MM.", "BAD_MONTH");
  }
  if (month > today.slice(0, 7)) throw new TeamRosterError(400, "Attendance is only available for the current or a past month.", "FUTURE_MONTH");
  if (month < EARLIEST_MONTH) throw new TeamRosterError(400, `Attendance is only available from ${EARLIEST_MONTH}.`, "MONTH_TOO_OLD");
  return month;
}

const daysInMonthOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export interface AttendanceTotals {
  present: number; absent: number; onDuty: number; halfDay: number; leave: number; holiday: number; weekOff: number; totalWorkingDays: number;
}

export interface AttendanceRow {
  code: string | null;
  name: string;
  designation: string | null;
  processName: string | null;
  lobName?: string | null;
  /** One register code per calendar day of the month ('' = blank), index 0 = day 1. */
  days: string[];
  /** 1-based days whose status came from an approved regularization. */
  regularizedDays: number[];
  totals: AttendanceTotals;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

/** Trim one executor row to the manager-safe shape. Pure. */
export function toAttendanceRow(r: Record<string, unknown>, daysInMonth: number): AttendanceRow {
  const days: string[] = [];
  const regularizedDays: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(String(r[`day_${d}`] ?? "").trim());
    if (r[`day_${d}_reg`]) regularizedDays.push(d);
  }
  return {
    code: r.emp_code ? String(r.emp_code) : null,
    name: String(r.emp_name ?? "").trim(),
    designation: r.designation ? String(r.designation) : null,
    processName: r.process_name ? String(r.process_name) : null,
    days,
    regularizedDays,
    totals: {
      present: num(r.present_count), absent: num(r.absent_count), onDuty: num(r.od_count), halfDay: num(r.hd_count),
      leave: num(r.leave_count), holiday: num(r.holiday_count), weekOff: num(r.weekoff_count), totalWorkingDays: num(r.total_working_days),
    },
  };
}

async function runRegister(month: string, employeeIds: string[], offset: number, limit: number) {
  const result = await attendanceRegisterMonthly(
    { month, employeeIds },
    TREE_ONLY_SCOPE,
    { limit, offset, cursor: null, includeTotal: true, mode: "preview" },
  );
  return { rows: result.rows, total: Number(result.rowCount ?? result.rows.length) };
}

/** code -> employee id, restricted to the caller's tree, so a row can open its drawer. */
async function idsByCode(codes: string[], teamIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!codes.length) return map;
  const rows = rowsOf<RowDataPacket>(await db.execute(
    `SELECT id, employee_code FROM employees WHERE employee_code IN (${placeholders(codes.length)}) AND id IN (${placeholders(teamIds.length)})`,
    [...codes, ...teamIds],
  ));
  rows.forEach((r) => map.set(String(r.employee_code), String(r.id)));
  return map;
}

/** employee id -> lob_id for the ids on this page (ids come from the caller's tree). */
async function lobIdsOf(ids: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!ids.length) return map;
  const rows = rowsOf<RowDataPacket>(await db.execute(
    `SELECT id, lob_id FROM employees WHERE id IN (${placeholders(ids.length)})`, ids,
  ));
  rows.forEach((r) => map.set(String(r.id), r.lob_id ? String(r.lob_id) : null));
  return map;
}

async function teamIdsOf(actor: Actor): Promise<{ ids: string[]; truncated: boolean }> {
  const caller = await resolveCallerEmployee(actor.id);
  if (!caller) return { ids: [], truncated: false };
  const tree = await resolveTeamTree(caller.id);
  return { ids: tree.ids, truncated: tree.truncated };
}

export async function getTeamAttendance(actor: Actor, q: { month: string; search?: string; processId?: string; offset?: number; limit?: number; lob?: LobFilter }) {
  const month = validateMonth(q.month);
  const daysInMonth = daysInMonthOf(month);
  const dates = eachDate(`${month}-01`, `${month}-${String(daysInMonth).padStart(2, "0")}`);
  const limit = Math.min(Math.max(Math.trunc(q.limit ?? DEFAULT_GRID_PAGE), 1), MAX_GRID_PAGE);
  const offset = Math.max(Math.trunc(q.offset ?? 0), 0);
  const base = { month, daysInMonth, dates, legend: ATTENDANCE_LEGEND, notes: ATTENDANCE_NOTES, offset, limit };

  const team = await teamIdsOf(actor);
  if (!team.ids.length) return { ...base, total: 0, teamTruncated: false, rows: [] };

  let ids = team.ids;
  const search = (q.search ?? "").trim().slice(0, 100);
  const lobCond = q.lob ? lobCondition(q.lob, "employees") : null;
  const processId = (q.processId ?? "").trim().slice(0, 36);
  if (search || lobCond || processId) {
    const like = `%${search}%`;
    const conds = [`id IN (${placeholders(team.ids.length)})`];
    const params: unknown[] = [...team.ids];
    if (search) { conds.push(`(full_name LIKE ? OR employee_code LIKE ? OR first_name LIKE ? OR last_name LIKE ?)`); params.push(like, like, like, like); }
    if (lobCond) { conds.push(lobCond.sql); params.push(...lobCond.params); }
    if (processId) { conds.push("process_id = ?"); params.push(processId); }
    ids = rowsOf<RowDataPacket>(await db.execute(
      `SELECT id FROM employees WHERE ${conds.join(" AND ")}`, params,
    )).map((r) => String(r.id));
    if (!ids.length) return { ...base, total: 0, teamTruncated: team.truncated, rows: [] };
  }

  const page = await runRegister(month, ids, offset, limit);
  const byCode = await idsByCode(page.rows.map((r) => String(r.emp_code ?? "")).filter(Boolean), team.ids);
  const lobIdOf = await lobIdsOf([...byCode.values()]);
  const lobNames = await lookupLobNames([...lobIdOf.values()]);
  return {
    ...base,
    total: page.total,
    teamTruncated: team.truncated,
    rows: page.rows.map((r) => {
      const id = byCode.get(String(r.emp_code)) ?? null;
      const lobId = id ? lobIdOf.get(id) : null;
      return { employeeId: id, lobName: lobId ? (lobNames.get(lobId) ?? null) : null, ...toAttendanceRow(r, daysInMonth) };
    }),
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Drill-down: one employee's day-by-day register for the month. Re-checks the employee is in the caller's tree. */
export async function getTeamAttendanceDetail(actor: Actor, employeeId: string, monthRaw: string) {
  const month = validateMonth(monthRaw);
  const team = await teamIdsOf(actor);
  if (!team.ids.includes(employeeId)) {
    throw new TeamRosterError(403, "This employee is not in your reporting team.", "NOT_IN_TEAM");
  }
  const daysInMonth = daysInMonthOf(month);
  const { rows } = await runRegister(month, [employeeId], 0, 1);
  if (!rows.length) throw new TeamRosterError(404, "No attendance register row for this employee and month.", "NOT_FOUND");
  const row = toAttendanceRow(rows[0], daysInMonth);
  const dates = eachDate(`${month}-01`, `${month}-${String(daysInMonth).padStart(2, "0")}`);
  return {
    month, daysInMonth, legend: ATTENDANCE_LEGEND, notes: ATTENDANCE_NOTES,
    employee: { employeeId, code: row.code, name: row.name, designation: row.designation, processName: row.processName },
    totals: row.totals,
    days: dates.map((date, i) => ({
      date, day: i + 1, weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()], code: row.days[i],
      regularized: row.regularizedDays.includes(i + 1),
    })),
  };
}
