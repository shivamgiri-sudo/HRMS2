/**
 * WFM Analytics Service — WFM Dashboard Metrics
 *
 * Provides workforce management KPIs:
 * - Roster publish rate (% processes with published roster for next 7 days)
 * - Adherence % (rostered vs actual attendance)
 * - Shrinkage % (unplanned absence + late arrivals)
 * - Attendance exceptions (mismatch, COSEC sync errors)
 * - Break compliance (over-break employees)
 * - Workforce forecast (demand vs supply)
 * - Real-time attendance (live tracking)
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import type { UserBusinessScope } from "../../shared/enterpriseScope.js";
import { scopePredicate, type Alias } from "./branch-scope.js";
import {
  EXPECTED_TO_WORK_EXCLUSIONS,
  HALF_DAY_STATUS,
  LEAVE_STATUSES,
  PRESENT_STATUSES,
  statusList,
} from "../../shared/attendanceStatus.js";

interface WfmAnalyticsSummary {
  roster_publish_rate: number; // % processes with roster for next 7 days
  total_processes: number;
  published_processes: number;
  adherence_pct: number; // rostered vs actual
  shrinkage_pct: number; // unplanned absence + late
  attendance_exceptions: {
    mismatch_count: number;
    cosec_sync_errors: number;
    manual_entry_count: number;
  };
  real_time_attendance: {
    expected_today: number;
    present: number;
    absent: number;
    late: number;
    on_leave: number;
    attendance_pct: number;
  };
  break_compliance: {
    over_break_count: number;
    avg_over_break_mins: number;
    top_violators: Array<{
      employee_id: number;
      employee_name: string;
      branch_name: string;
      avg_over_break_mins: number;
    }>;
  };
  workforce_forecast: Array<{
    date: string;
    demand: number;
    supply: number;
    gap: number;
  }>;
  adherence_by_process: Array<{
    process_id: number;
    process_name: string;
    rostered: number;
    actual: number;
    adherence_pct: number;
  }>;
}

// None of the tables this service named exist (processes, roster, attendance,
// attendance_exceptions, branches, workforce_demand), so the endpoint raised ER_NO_SUCH_TABLE.
// Mapped onto the tables the WFM module actually writes:
//
//   processes            -> process_master (active_status = 1)
//   branches             -> branch_master
//   roster               -> wfm_roster_assignment. "Published" is publish_status
//                           'published' / 'approved_final'; a rostered shift is a row that is
//                           not a week off, holiday, leave or training day. The row's own
//                           process_id is used, else the employee's current process.
//   attendance           -> attendance_daily_record (record_date, attendance_status, late_mark).
//                           There is no 'late' status and no leave_status column: lateness is
//                           late_mark, approved leave is the 'leave_approved' status, and
//                           'absent' is already unplanned.
//   today's presence     -> the daily record for today is only reconciled overnight, so a
//                           rostered employee also counts as present once today's
//                           wfm_attendance_session carries a login. Absent / on leave are
//                           counted only where the daily record says so; someone who has not
//                           punched yet is in neither bucket.
//   shrinkage            -> (absent + late marks) over the days people were expected to work,
//                           for the last 7 completed days (today is excluded, it is unreconciled).
//   attendance_exceptions-> no table carries those three types (attendance_exception holds
//                           absence / late_mark / unreconciled rows). Each count is read from
//                           where that kind of exception is really raised, open items dated in
//                           the last 7 days — they are raised when a day is processed, so
//                           "dated today" is structurally empty:
//                             mismatch     = attendance_daily_record.mismatch_flag, unresolved
//                             cosec errors = attendance_reconciliation_issue, unresolved
//                             manual entry = attendance_manual_override awaiting approval
//   break times          -> break_daily_summary (total_break_minutes per shift date) against
//                           break_settings.daily_total_allowed_minutes, most specific
//                           branch/process row first, 60 minutes when none is configured —
//                           the same resolution and default as break-management.service.ts.
//   workforce_demand     -> wfm_slot_requirement. A day's demand for a process is its peak slot
//                           (required_planned_hc), not the sum of its slots; supply is the
//                           published rostered shifts of that process on that date.
//
// Nothing in this summary is empty by design: every field reads a real table. Tables that
// hold no rows yet simply report 0 / [].
//
// employee_id and process_id are CHAR(36) UUIDs in this schema; the interface keeps the
// `number` the dashboard hook declares, but the value on the wire is the UUID string.
const ROSTER_PUBLISHED = "'published', 'approved_final'";
const ROSTER_NOT_A_SHIFT = "'WEEK_OFF', 'HOLIDAY', 'LEAVE', 'TRAINING'";
const IS_ROSTERED_SHIFT = `(ra.is_week_off = 0 AND COALESCE(ra.assignment_type, '') NOT IN (${ROSTER_NOT_A_SHIFT}))`;
const ROSTER_PROCESS = "COALESCE(ra.process_id, e.process_id)";
const ADR_STATUS = "COALESCE(a.attendance_status, '')";
const ATTENDED = `(${ADR_STATUS} IN (${statusList([...PRESENT_STATUSES, HALF_DAY_STATUS])}) OR s.login_time IS NOT NULL)`;
const DEFAULT_BREAK_ALLOWED_MINS = 60;

const num = (value: unknown): number => Number(value ?? 0) || 0;
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export async function getWfmAnalyticsSummary(scope?: UserBusinessScope): Promise<WfmAnalyticsSummary> {
  // Branch scoping (owner ruling 2026-10-01): org-wide roles (and callers that pass no scope) run the
  // unfiltered SQL unchanged; everyone else only counts rows in their own branch / assigned scope.
  const emp = (a: Alias) => (scope ? scopePredicate(scope, a) : { sql: "1=1", params: [] as unknown[] });
  const andOf = (c: { sql: string }) => (c.sql === "1=1" ? "" : `\n       AND (${c.sql})`);
  const E = { employeeId: "e.id", branchId: "e.branch_id", processId: "e.process_id", managerEmployeeId: "e.reporting_manager_id" };
  const eC = emp(E);
  const pC = emp({ branchId: "p.branch_id", processId: "p.id" });
  const pmC = emp({ branchId: "branch_id", processId: "id" });
  // Tables with only an employee_id column: restrict through a sub-select on employees.
  const sub = (col: string) => {
    const c = emp({ employeeId: "e2.id", branchId: "e2.branch_id", processId: "e2.process_id", managerEmployeeId: "e2.reporting_manager_id" });
    return c.sql === "1=1" ? { sql: "", params: [] as unknown[] } : { sql: `\n       AND ${col} IN (SELECT e2.id FROM employees e2 WHERE ${c.sql})`, params: c.params };
  };

  // Active processes — small master table, also the id -> name lookup for the roster queries
  const [processes] = await db.query<RowDataPacket[]>(
    `SELECT id, process_name
     FROM process_master
     WHERE active_status = 1${andOf(pmC)}`,
    pmC.sql === "1=1" ? [] : pmC.params
  );
  const processName = new Map<string, string>(
    processes.map((p) => [String(p.id), String(p.process_name ?? "")])
  );

  // Published roster for the next 7 days, per date and process. One pass over the roster's
  // date index serves both the publish rate and the forecast's supply side.
  const [rosterAhead] = await db.query<RowDataPacket[]>(
    `SELECT
       DATE_FORMAT(ra.roster_date, '%Y-%m-%d') as roster_date,
       ${ROSTER_PROCESS} as process_id,
       SUM(CASE WHEN ${IS_ROSTERED_SHIFT} THEN 1 ELSE 0 END) as rostered_shifts
     FROM wfm_roster_assignment ra
     INNER JOIN employees e ON e.id = ra.employee_id
     WHERE ra.roster_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
       AND ra.publish_status IN (${ROSTER_PUBLISHED})
       AND e.active_status = 1${andOf(eC)}
     GROUP BY ra.roster_date, ${ROSTER_PROCESS}`,
    eC.sql === "1=1" ? [] : eC.params
  );

  const publishedProcessIds = new Set<string>();
  const supplyByDateProcess = new Map<string, number>();
  for (const r of rosterAhead) {
    if (r.process_id == null) continue;
    const processId = String(r.process_id);
    if (processName.has(processId)) publishedProcessIds.add(processId);
    supplyByDateProcess.set(`${r.roster_date}|${processId}`, num(r.rostered_shifts));
  }

  const totalProcesses = processes.length;
  const publishedCount = publishedProcessIds.size;
  const publishRate = pct(publishedCount, totalProcesses);

  // Today: rostered vs actual, per process. One row per rostered employee (the roster, the
  // daily record and the session are each unique per employee and date).
  const [todayByProcess] = await db.query<RowDataPacket[]>(
    `SELECT
       ${ROSTER_PROCESS} as process_id,
       COUNT(*) as rostered,
       SUM(CASE WHEN ${ATTENDED} THEN 1 ELSE 0 END) as actual,
       SUM(CASE WHEN NOT ${ATTENDED} AND ${ADR_STATUS} = 'absent' THEN 1 ELSE 0 END) as absent,
       SUM(CASE WHEN a.late_mark = 1 THEN 1 ELSE 0 END) as late,
       SUM(CASE WHEN NOT ${ATTENDED} AND ${ADR_STATUS} IN (${statusList(LEAVE_STATUSES)}) THEN 1 ELSE 0 END) as on_leave
     FROM wfm_roster_assignment ra
     INNER JOIN employees e ON e.id = ra.employee_id
     LEFT JOIN attendance_daily_record a ON a.employee_id = ra.employee_id
       AND a.record_date = ra.roster_date
     LEFT JOIN wfm_attendance_session s ON s.employee_id = ra.employee_id
       AND s.session_date = ra.roster_date
     WHERE ra.roster_date = CURDATE()
       AND ra.publish_status IN (${ROSTER_PUBLISHED})
       AND ${IS_ROSTERED_SHIFT}
       AND e.active_status = 1${andOf(eC)}
     GROUP BY ${ROSTER_PROCESS}`,
    eC.sql === "1=1" ? [] : eC.params
  );

  let expectedToday = 0;
  let present = 0;
  let absent = 0;
  let late = 0;
  let onLeave = 0;
  for (const r of todayByProcess) {
    expectedToday += num(r.rostered);
    present += num(r.actual);
    absent += num(r.absent);
    late += num(r.late);
    onLeave += num(r.on_leave);
  }
  const adherencePct = pct(present, expectedToday);

  // Shrinkage % (unplanned absence + late arrivals) - last 7 completed days
  const [shrinkage] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END) as unplanned_absent,
       SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) as late_arrivals,
       SUM(CASE WHEN attendance_status NOT IN (${statusList(EXPECTED_TO_WORK_EXCLUSIONS)}) THEN 1 ELSE 0 END) as expected_days
     FROM attendance_daily_record
     WHERE record_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       AND record_date < CURDATE()${sub("employee_id").sql}`,
    sub("employee_id").params
  );
  const shrinkagePct = pct(
    num(shrinkage[0]?.unplanned_absent) + num(shrinkage[0]?.late_arrivals),
    num(shrinkage[0]?.expected_days)
  );

  // Attendance exceptions — open items dated in the last 7 days
  const [mismatches] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM attendance_daily_record
     WHERE mismatch_flag = 1
       AND record_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND CURDATE()
       AND mismatch_resolved_at IS NULL${sub("employee_id").sql}`,
    sub("employee_id").params
  );

  const [syncErrors] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM attendance_reconciliation_issue
     WHERE issue_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND CURDATE()
       AND resolved_at IS NULL${sub("employee_id").sql}`,
    sub("employee_id").params
  );

  const [manualEntries] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM attendance_manual_override
     WHERE attendance_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND CURDATE()
       AND approval_status = 'pending'${sub("employee_id").sql}`,
    sub("employee_id").params
  );

  // Break compliance — employees over their daily break allowance in the last 7 days.
  // One row per offending employee, so the result is bounded by headcount.
  const [overBreak] = await db.query<RowDataPacket[]>(
    `WITH allowed AS (
       SELECT branch_id, process_id, MIN(daily_total_allowed_minutes) AS mins
         FROM break_settings
        GROUP BY branch_id, process_id
     )
     SELECT
       b.employee_id,
       COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) as employee_name,
       bm.branch_name,
       AVG(b.total_break_minutes - COALESCE(s1.mins, s2.mins, s3.mins, s4.mins, ${DEFAULT_BREAK_ALLOWED_MINS})) as avg_over_break_mins
     FROM break_daily_summary b
     INNER JOIN employees e ON e.id = b.employee_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     LEFT JOIN allowed s1 ON s1.branch_id = b.branch_id AND s1.process_id = b.process_id
     LEFT JOIN allowed s2 ON s2.branch_id = b.branch_id AND s2.process_id IS NULL
     LEFT JOIN allowed s3 ON s3.branch_id IS NULL AND s3.process_id = b.process_id
     LEFT JOIN allowed s4 ON s4.branch_id IS NULL AND s4.process_id IS NULL
     WHERE b.shift_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND CURDATE()
       AND b.total_break_minutes > COALESCE(s1.mins, s2.mins, s3.mins, s4.mins, ${DEFAULT_BREAK_ALLOWED_MINS})${andOf(eC)}
     GROUP BY b.employee_id, employee_name, bm.branch_name
     ORDER BY avg_over_break_mins DESC`,
    eC.sql === "1=1" ? [] : eC.params
  );

  const overBreakCount = overBreak.length;
  const avgOverBreak = overBreakCount > 0
    ? Math.round(overBreak.reduce((sum, r) => sum + num(r.avg_over_break_mins), 0) / overBreakCount)
    : 0;

  // Workforce forecast (next 7 days: demand vs supply). Driven from the active processes so
  // the requirement table is read through its (process_id, requirement_date) index.
  const [demand] = await db.query<RowDataPacket[]>(
    `SELECT
       DATE_FORMAT(d.requirement_date, '%Y-%m-%d') as date,
       d.process_id,
       MAX(COALESCE(d.required_planned_hc, d.required_productive_hc, 0)) as demand
     FROM process_master p
     INNER JOIN wfm_slot_requirement d ON d.process_id = p.id
       AND d.requirement_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
     WHERE p.active_status = 1
       AND d.is_active = 1${andOf(pC)}
     GROUP BY d.requirement_date, d.process_id`,
    pC.sql === "1=1" ? [] : pC.params
  );

  const forecastByDate = new Map<string, { demand: number; supply: number }>();
  for (const r of demand) {
    const date = String(r.date);
    const day = forecastByDate.get(date) ?? { demand: 0, supply: 0 };
    day.demand += num(r.demand);
    day.supply += supplyByDateProcess.get(`${date}|${String(r.process_id)}`) ?? 0;
    forecastByDate.set(date, day);
  }

  return {
    roster_publish_rate: publishRate,
    total_processes: totalProcesses,
    published_processes: publishedCount,
    adherence_pct: adherencePct,
    shrinkage_pct: shrinkagePct,
    attendance_exceptions: {
      mismatch_count: num(mismatches[0]?.count),
      cosec_sync_errors: num(syncErrors[0]?.count),
      manual_entry_count: num(manualEntries[0]?.count),
    },
    real_time_attendance: {
      expected_today: expectedToday,
      present,
      absent,
      late,
      on_leave: onLeave,
      attendance_pct: pct(present, expectedToday),
    },
    break_compliance: {
      over_break_count: overBreakCount,
      avg_over_break_mins: avgOverBreak,
      top_violators: overBreak.slice(0, 10).map((r) => ({
        employee_id: r.employee_id,
        employee_name: r.employee_name,
        branch_name: r.branch_name ?? "Unknown",
        avg_over_break_mins: Math.round(num(r.avg_over_break_mins)),
      })),
    },
    workforce_forecast: [...forecastByDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, day]) => ({
        date,
        demand: day.demand,
        supply: day.supply,
        gap: day.demand - day.supply,
      })),
    adherence_by_process: todayByProcess
      .filter((r) => r.process_id != null && processName.has(String(r.process_id)))
      .map((r) => {
        const rostered = num(r.rostered);
        const actual = num(r.actual);
        return {
          process_id: r.process_id,
          process_name: processName.get(String(r.process_id)) ?? "",
          rostered,
          actual,
          adherence_pct: pct(actual, rostered),
        };
      })
      .sort((a, b) => a.process_name.localeCompare(b.process_name)),
  };
}
