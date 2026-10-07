/**
 * Shrinkage trend + team shrinkage for the Trends & Publish panel.
 *
 * Computed live from wfm_roster_assignment x attendance_daily_record x biometric_attendance_log
 * (the same three tables the Team Shrinkage tables use), NOT from shrinkage_daily_snapshot.
 * The snapshot table holds an org-wide row AND one row per branch for the same date, so summing
 * "all rows for a date" double-counted, listSnapshots() capped at 90 rows so a 14-day window
 * with N branches silently lost dates, and process filters never matched anything. One source,
 * one definition (roster-trends.sql.ts), scoped through employees, LOB included.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  ATT_JOINS,
  COUNT_COLUMNS,
  REAL_ROSTER,
  ABSENT_PREDICATE,
  scopeSql,
  type ScopeFilters,
} from "./roster-trends.sql.js";
import {
  addDays,
  clampToToday,
  daySpan,
  deriveRates,
  dayStatus,
  eachDate,
  previousWindow,
  sumCounts,
  toCounts,
  weekStartMonday,
  safePct,
  type AttendanceCounts,
} from "./roster-trends.calc.js";
import { todayLocalDateStr } from "./shift-due.util.js";

export const MAX_TREND_DAYS = 92;

export interface TrendFilters extends ScopeFilters {
  from: string;
  to: string;
}

export interface DayPoint extends AttendanceCounts {
  date: string;
  hasData: boolean;
  shrinkagePct: number;
  unplannedPct: number;
  plannedPct: number;
  attendancePct: number;
  lateRatePct: number;
}

function point(date: string, c: AttendanceCounts): DayPoint {
  return { date, hasData: c.scheduled > 0, ...c, ...deriveRates(c) };
}

async function dailyCounts(
  from: string,
  to: string,
  f: ScopeFilters,
): Promise<Map<string, AttendanceCounts>> {
  const s = scopeSql(f);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(ra.roster_date, '%Y-%m-%d') AS d, ${COUNT_COLUMNS}
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id AND e.active_status = 1
       ${ATT_JOINS}
      WHERE ra.roster_date BETWEEN ? AND ? AND ${REAL_ROSTER}${s.sql}
      GROUP BY ra.roster_date
      ORDER BY ra.roster_date`,
    [from, to, ...s.params],
  );
  const m = new Map<string, AttendanceCounts>();
  for (const r of rows) m.set(String(r.d), toCounts(r));
  return m;
}

export async function getShrinkageTrend(f: TrendFilters) {
  const today = todayLocalDateStr();
  // Cap the window (keep the most recent days) so an unbounded range can't scan the table.
  const clamped = daySpan(f.from, f.to) > MAX_TREND_DAYS;
  const from = clamped ? addDays(f.to, -(MAX_TREND_DAYS - 1)) : f.from;
  const win = clampToToday(from, f.to, today);
  if (win.empty) {
    return {
      from,
      to: f.to,
      effectiveTo: win.to,
      clamped,
      futureOnly: true,
      days: [] as DayPoint[],
      summary: point(from, sumCounts([])),
      previous: null as DayPoint | null,
    };
  }
  const prevWin = previousWindow(win.from, win.to);
  const [cur, prev] = await Promise.all([
    dailyCounts(win.from, win.to, f),
    dailyCounts(prevWin.from, prevWin.to, f),
  ]);
  const days = eachDate(win.from, win.to).map((d) =>
    point(
      d,
      cur.get(d) ?? {
        scheduled: 0,
        present: 0,
        absent: 0,
        onLeave: 0,
        late: 0,
      },
    ),
  );
  const summary = point(win.from, sumCounts([...cur.values()]));
  const prevSummary = prev.size
    ? point(prevWin.from, sumCounts([...prev.values()]))
    : null;
  return {
    from: win.from,
    to: f.to,
    effectiveTo: win.to,
    clamped,
    futureOnly: false,
    previousWindow: prevWin,
    days,
    summary,
    previous: prevSummary,
    /** Dates in range with no roster/attendance rows at all: shown as gaps, never as 0% shrinkage. */
    missingDates: days.filter((d) => !d.hasData).map((d) => d.date),
  };
}

/* ── Process / member tables ───────────────────────────────────────────────── */

export async function getProcessShrinkage(f: TrendFilters) {
  const today = todayLocalDateStr();
  const win = clampToToday(f.from, f.to, today);
  if (win.empty)
    return { from: f.from, to: f.to, effectiveTo: win.to, processes: [] };
  const s = scopeSql(f);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pm.id AS process_id, pm.process_name, ${COUNT_COLUMNS}
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id AND e.active_status = 1
       JOIN process_master pm ON pm.id = e.process_id
       ${ATT_JOINS}
      WHERE ra.roster_date BETWEEN ? AND ? AND ${REAL_ROSTER}${s.sql}
      GROUP BY pm.id, pm.process_name
      ORDER BY pm.process_name`,
    [win.from, win.to, ...s.params],
  );
  const processes = rows.map((r) => {
    const c = toCounts(r);
    return {
      processId: String(r.process_id),
      processName: String(r.process_name),
      ...c,
      ...deriveRates(c),
    };
  });
  return { from: f.from, to: f.to, effectiveTo: win.to, processes };
}

export async function getProcessMembers(processId: string, f: TrendFilters) {
  const today = todayLocalDateStr();
  const win = clampToToday(f.from, f.to, today);
  if (win.empty)
    return {
      processId,
      from: f.from,
      to: f.to,
      effectiveTo: win.to,
      members: [],
    };
  const s = scopeSql({ branchId: f.branchId, lob: f.lob });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
            b.branch_name, ${COUNT_COLUMNS},
            SUM(CASE WHEN att.late_mark = 1 AND (att.clock_in_time IS NOT NULL OR bal.first_punch_in IS NOT NULL)
                     THEN COALESCE(att.late_by_minutes, 0) ELSE 0 END) AS total_late_minutes
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id AND e.active_status = 1 AND e.process_id = ?
       LEFT JOIN branch_master b ON b.id = e.branch_id
       ${ATT_JOINS}
      WHERE ra.roster_date BETWEEN ? AND ? AND ${REAL_ROSTER}${s.sql}
      GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name
      ORDER BY employee_name`,
    [processId, win.from, win.to, ...s.params],
  );
  const members = rows.map((r) => {
    const c = toCounts(r);
    return {
      employeeId: String(r.employee_id),
      employeeCode: String(r.employee_code),
      employeeName: String(r.employee_name),
      branchName: r.branch_name ? String(r.branch_name) : null,
      ...c,
      avgLateMinutes:
        c.late > 0 ? Math.round(Number(r.total_late_minutes ?? 0) / c.late) : 0,
      ...deriveRates(c),
    };
  });
  return { processId, from: f.from, to: f.to, effectiveTo: win.to, members };
}

/* ── Member day-by-day + profile ───────────────────────────────────────────── */

export async function getMemberDetail(
  employeeId: string,
  from: string,
  to: string,
) {
  const today = todayLocalDateStr();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
            e.date_of_joining, e.active_status,
            COALESCE(dm.designation_name, '') AS designation,
            b.branch_name, p.process_name,
            COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS manager_name
       FROM employees e
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  if (!empRows.length) return null;
  const emp = empRows[0];

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(ra.roster_date, '%Y-%m-%d') AS date, DAYNAME(ra.roster_date) AS day_name,
            ra.assignment_type, ra.is_week_off, ra.final_roster_status,
            TIME_FORMAT(COALESCE(ra.shift_start_time, wst.start_time, wsm.start_time), '%H:%i') AS shift_start,
            TIME_FORMAT(COALESCE(ra.shift_end_time, wst.end_time, wsm.end_time), '%H:%i') AS shift_end,
            TIME_FORMAT(COALESCE(bal.first_punch_in, att.clock_in_time), '%H:%i') AS clock_in,
            att.late_mark, att.late_by_minutes, att.attendance_status
       FROM wfm_roster_assignment ra
       LEFT JOIN wfm_shift_template wst ON wst.id = ra.shift_template_id
       LEFT JOIN wfm_shift_master wsm ON wsm.id = ra.shift_id
       ${ATT_JOINS}
      WHERE ra.employee_id = ? AND ra.roster_date BETWEEN ? AND ? AND ${REAL_ROSTER}
      ORDER BY ra.roster_date`,
    [employeeId, from, to],
  );

  const days = rows.map((r) => {
    const status = dayStatus({
      date: String(r.date),
      today,
      assignmentType: r.assignment_type ? String(r.assignment_type) : null,
      isWeekOff: Number(r.is_week_off) === 1,
      clockIn: r.clock_in ? String(r.clock_in) : null,
      lateMark: r.late_mark == null ? null : Number(r.late_mark),
      attendanceStatus: r.attendance_status
        ? String(r.attendance_status)
        : null,
      shiftStart: r.shift_start ? String(r.shift_start) : null,
      nowMinutes,
    });
    return {
      date: String(r.date),
      dayOfWeek: String(r.day_name).slice(0, 3),
      assignmentType: String(r.assignment_type ?? "REGULAR"),
      shiftStart: r.shift_start ? String(r.shift_start) : null,
      shiftEnd: r.shift_end ? String(r.shift_end) : null,
      clockIn: r.clock_in ? String(r.clock_in) : null,
      status,
      lateByMinutes:
        r.late_by_minutes != null ? Number(r.late_by_minutes) : null,
      rosterStatus: r.final_roster_status
        ? String(r.final_roster_status)
        : null,
    };
  });

  // Summary from the very same per-day statuses the table shows, so they can never disagree.
  const tally = (s: string) => days.filter((d) => d.status === s).length;
  const counts: AttendanceCounts = {
    present: tally("On Time") + tally("Late"),
    late: tally("Late"),
    absent: tally("Absent"),
    onLeave: tally("On Leave"),
    scheduled:
      tally("On Time") + tally("Late") + tally("Absent") + tally("On Leave"),
  };
  const weekly = new Map<string, AttendanceCounts>();
  for (const d of days) {
    if (!["On Time", "Late", "Absent", "On Leave"].includes(d.status)) continue;
    const w = weekStartMonday(d.date);
    const c = weekly.get(w) ?? {
      scheduled: 0,
      present: 0,
      absent: 0,
      onLeave: 0,
      late: 0,
    };
    c.scheduled += 1;
    if (d.status === "On Time" || d.status === "Late") c.present += 1;
    if (d.status === "Late") c.late += 1;
    if (d.status === "Absent") c.absent += 1;
    if (d.status === "On Leave") c.onLeave += 1;
    weekly.set(w, c);
  }
  return {
    employee: {
      employeeId: String(emp.id),
      employeeCode: String(emp.employee_code),
      employeeName: String(emp.employee_name),
      designation: String(emp.designation || ""),
      branchName: emp.branch_name ? String(emp.branch_name) : null,
      processName: emp.process_name ? String(emp.process_name) : null,
      managerName: emp.manager_name ? String(emp.manager_name) : null,
      dateOfJoining: emp.date_of_joining
        ? String(emp.date_of_joining).slice(0, 10)
        : null,
      active: Number(emp.active_status) === 1,
    },
    from,
    to,
    summary: { ...counts, ...deriveRates(counts) },
    weekly: [...weekly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, c]) => ({ week, ...c, ...deriveRates(c) })),
    days,
  };
}

/* ── Single-day drill-down ─────────────────────────────────────────────────── */

export async function getShrinkageDayDetail(date: string, f: ScopeFilters) {
  const s = scopeSql(f);
  const baseParams = [date, ...s.params];
  const [byProc, byBranch, absent, states] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT pm.id AS id, pm.process_name AS name, ${COUNT_COLUMNS}
         FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id AND e.active_status = 1
         JOIN process_master pm ON pm.id = e.process_id ${ATT_JOINS}
        WHERE ra.roster_date = ? AND ${REAL_ROSTER}${s.sql}
        GROUP BY pm.id, pm.process_name ORDER BY pm.process_name`,
      baseParams,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT b.id AS id, b.branch_name AS name, ${COUNT_COLUMNS}
         FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id AND e.active_status = 1
         JOIN branch_master b ON b.id = e.branch_id ${ATT_JOINS}
        WHERE ra.roster_date = ? AND ${REAL_ROSTER}${s.sql}
        GROUP BY b.id, b.branch_name ORDER BY b.branch_name`,
      baseParams,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id, e.employee_code,
              COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              p.process_name, b.branch_name
         FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id AND e.active_status = 1
         LEFT JOIN process_master p ON p.id = e.process_id LEFT JOIN branch_master b ON b.id = e.branch_id ${ATT_JOINS}
        WHERE ra.roster_date = ? AND ${REAL_ROSTER}${s.sql} AND ${ABSENT_PREDICATE}
        ORDER BY employee_name LIMIT 50`,
      baseParams,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(ra.final_roster_status,'generated') AS status, COUNT(*) AS cnt
         FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id AND e.active_status = 1
        WHERE ra.roster_date = ? AND ${REAL_ROSTER}${s.sql} GROUP BY status`,
      baseParams,
    ),
  ]);
  const shape = (r: RowDataPacket) => {
    const c = toCounts(r);
    return { id: String(r.id), name: String(r.name), ...c, ...deriveRates(c) };
  };
  const procs = byProc[0].map(shape);
  const total = sumCounts(procs);
  const trend = await getShrinkageTrend({
    ...f,
    from: addDays(date, -6),
    to: date,
  });
  return {
    date,
    summary: { ...total, ...deriveRates(total) },
    byProcess: procs,
    byBranch: byBranch[0].map(shape),
    absentees: absent[0].map((r) => ({
      employeeId: String(r.employee_id),
      employeeCode: String(r.employee_code),
      employeeName: String(r.employee_name),
      processName: r.process_name ? String(r.process_name) : null,
      branchName: r.branch_name ? String(r.branch_name) : null,
    })),
    absenteesTruncated: absent[0].length >= 50,
    publishStates: states[0].map((r) => ({
      status: String(r.status),
      count: Number(r.cnt),
    })),
    trend7: trend.days,
    shareOfUnplannedByProcess: procs.map((p) => ({
      name: p.name,
      sharePct: safePct(p.absent, total.absent),
    })),
  };
}
