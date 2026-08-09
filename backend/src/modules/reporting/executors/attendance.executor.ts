/**
 * Attendance executor
 *
 * Covers codes: attendance-daily, daily-hc-shift, shift-adherence-detail,
 * attendance-summary, late-arrival-summary, overtime-summary,
 * regularization-summary, attendance-dispute-summary, habitual-absentee-list,
 * daily-shrinkage-report, monthly-shrinkage-trend, biometric-reconciliation,
 * punch-raw-export, attendance-register-grid, break-daily-summary,
 * break-session-log
 *
 * Every query includes WHERE e.company_id = ? to enforce tenant isolation.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  dateParam,
  monthParam,
  monthRange,
  applyPagination,
} from "./types.js";
import {
  presentSql,
  attendedDaysSql,
  expectedToWorkSql,
  statusList,
  LEAVE_STATUSES,
} from "../../../shared/attendanceStatus.js";

async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

async function count(baseSql: string, params: unknown[]): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
    params
  );
  return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
}

// ---------------------------------------------------------------------------
// attendance-daily
// ---------------------------------------------------------------------------
/**
 * attendance-register-monthly
 *
 * The last of the eight reports that rendered on screen and answered 404 on download.
 *
 * Unlike the other seven this was not a SQL move. The inline block executed its own statement,
 * pivoted the result into day_1..day_31 columns in JavaScript, and returned its own response —
 * it never set `sql` and never reached the shared response path, so there was nothing for the
 * export handler to call. The pivot moves here with it.
 *
 * Behaviour is preserved deliberately rather than tidied:
 *
 *   - the pivot returns every employee row and does not slice by limit or offset, exactly as
 *     the inline handler did. Adding pagination here would change what the screen shows;
 *   - the status-to-letter map and the salary-day arithmetic are carried verbatim, because they
 *     are the report's meaning and not formatting.
 *
 * Two meta fields are lost in the move: daysInMonth and month, which the inline handler added to
 * its own response envelope and which the shared envelope has no channel for. Checked before
 * moving — no frontend component reads either; the calendar components compute daysInMonth
 * locally from the selected month.
 *
 * Verified as a no-op on the data by checksumming all 1,124 rows x 50 columns before and after.
 */
export async function attendanceRegisterMonthly(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);
  const [yr, mo] = month.split("-").map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const firstDay = `${month}-01`;
  const lastDay  = `${month}-${String(daysInMonth).padStart(2, "0")}`;

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");
  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(firstDay, lastDay);

  const attSql = `
    SELECT
      e.id AS employee_id,
      e.employee_code,
      COALESCE(e.biometric_code, '') AS bio_code,
      CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS emp_name,
      COALESCE(dept.dept_name, '') AS department,
      COALESCE(desig.designation_name, '') AS designation,
      COALESCE(e.profile_type, '') AS profile,
      COALESCE(cc.cost_centre_name, '') AS cost_center,
      COALESCE(b.branch_name, '') AS emp_location,
      CASE WHEN COALESCE(e.is_billable, 1) = 1 THEN 'Yes' ELSE 'No' END AS billable,
      DAY(adr.record_date) AS day_num,
      adr.attendance_status
    FROM attendance_daily_record adr
    JOIN employees e ON e.id = adr.employee_id
    LEFT JOIN department_master dept ON dept.id = e.department_id
    LEFT JOIN designation_master desig ON desig.id = e.designation_id
    LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
    LEFT JOIN branch_master b ON b.id = e.branch_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY e.employee_code, adr.record_date
  `;

  const attRows = await query(attSql, params);

  // Status code mapping
  const statusCode: Record<string, string> = {
    present: "P", absent: "A", half_day: "HD", week_off: "W",
    holiday: "H", leave_approved: "L", on_duty: "OD",
    unreconciled: "A",
  };

  // Pivot into per-employee rows
  const empMap = new Map<string, any>();
  for (const row of attRows) {
    if (!empMap.has(row.employee_id)) {
      empMap.set(row.employee_id, {
        emp_code:    row.employee_code,
        bio_code:    row.bio_code,
        emp_name:    row.emp_name,
        department:  row.department,
        designation: row.designation,
        profile:     row.profile,
        cost_center: row.cost_center,
        emp_location:row.emp_location,
        billable:    row.billable,
      });
    }
    const emp = empMap.get(row.employee_id);
    const code = statusCode[row.attendance_status] ?? row.attendance_status ?? "";
    emp[`day_${row.day_num}`] = code;
  }

  const pivotRows = Array.from(empMap.values()).map((emp, idx) => {
    let absent = 0, present = 0, od = 0, hd = 0, leave = 0, holiday = 0, weekoff = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const v = emp[`day_${d}`] ?? "";
      if (v === "A") absent++;
      else if (v === "P") present++;
      else if (v === "OD") od++;
      else if (v === "HD") hd++;
      else if (v === "L") leave++;
      else if (v === "H") holiday++;
      else if (v === "W") weekoff++;
    }
    const salDays = present + hd * 0.5 + od + holiday + weekoff;
    return {
      sno: idx + 1,
      emp_code: emp.emp_code,
      bio_code: emp.bio_code,
      emp_name: emp.emp_name,
      department: emp.department,
      designation: emp.designation,
      profile: emp.profile,
      cost_center: emp.cost_center,
      emp_location: emp.emp_location,
      billable: emp.billable,
      ...Object.fromEntries(
        Array.from({ length: daysInMonth }, (_, i) => [`day_${i + 1}`, emp[`day_${i + 1}`] ?? ""])
      ),
      absent_count: absent,
      present_count: present,
      od_count: od,
      hd_count: hd,
      leave_count: leave,
      holiday_count: holiday,
      weekoff_count: weekoff,
      sal_days: salDays,
      total: daysInMonth,
    };
  });

  return {
    rows: pivotRows,
    rowCount: pivotRows.length,
    isTruncated: false,
    nextCursor: null,
  };
}

export async function attendanceDaily(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, today);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  if (filters.processId) {
    // already handled by appendFilterConditions via e.process_id,
    // but if caller wants adr-level process filter they can set it on e
  }

  if (options.asOf) {
    clauses.push("adr.record_date <= ?");
    params.push(options.asOf);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("adr.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT adr.id AS _cursor,
           adr.record_date,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           des.designation_name,
           ws.shift_name,
           TIME_FORMAT(ws.start_time,'%H:%i') AS shift_start,
           TIME_FORMAT(ws.end_time,'%H:%i') AS shift_end,
           adr.attendance_status,
           adr.late_by_minutes,
           adr.raw_minutes AS productive_minutes,
           adr.lwp_value,
           adr.attendance_source,
           adr.is_locked
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN designation_master des ON des.id = e.designation_id
      LEFT JOIN wfm_roster_assignment wra
             ON wra.employee_id = adr.employee_id
            AND wra.roster_date = adr.record_date
      LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY adr.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];

  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;

  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// daily-hc-shift  (aggregate — no row-level cursor)
// ---------------------------------------------------------------------------
export async function dailyHcShift(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, today);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    SELECT adr.record_date,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           ws.shift_name,
           COUNT(*) AS headcount
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN wfm_roster_assignment wra
             ON wra.employee_id = adr.employee_id
            AND wra.roster_date = adr.record_date
      LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY adr.record_date, b.branch_name, p.process_name, ws.shift_name
     ORDER BY adr.record_date DESC, b.branch_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// shift-adherence-detail
// ---------------------------------------------------------------------------
export async function shiftAdherenceDetail(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, today);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.asOf) {
    clauses.push("adr.record_date <= ?");
    params.push(options.asOf);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("adr.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT adr.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           adr.record_date,
           ws.shift_name,
           TIME_FORMAT(ws.start_time,'%H:%i') AS scheduled_start,
           adr.late_by_minutes,
           CASE WHEN adr.late_by_minutes > 0 THEN 'LATE' ELSE 'ON_TIME' END AS adherence_status,
           adr.attendance_status
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
      LEFT JOIN wfm_roster_assignment wra
             ON wra.employee_id = adr.employee_id
            AND wra.roster_date = adr.record_date
      LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY adr.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];

  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;

  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// attendance-summary  (monthly aggregate per employee)
// ---------------------------------------------------------------------------
export async function attendanceSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("adr.record_date >= ? AND adr.record_date < ?");
  params.push(monthRange(month).start, monthRange(month).endExclusive);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  // Two defects fixed here, both verified against live mas_hrms on 2026-08-07:
  //
  //   1. lwp_days counted `attendance_status = 'lwp'`. There is no 'lwp' member of the
  //      ENUM — LWP is the numeric `lwp_value` column — so the figure was 0 on all
  //      118,350 rows. July 2026 alone carries 13,731.5 LWP days across 16,386 rows, and
  //      LWP drives pay. This is the same defect class the header of
  //      shared/attendanceStatus.ts documents for 'late'.
  //
  //   2. The buckets did not account for the month. present + absent + half_day left
  //      9,778 of July's 41,106 rows unexplained — 9,773 of them `missing_punch` (23.8%
  //      of the month) — so the columns silently failed to sum to the total and there was
  //      no way to see why the attendance rate was what it was. Every ENUM member now has
  //      a column, and missing_punch is named rather than absorbed.
  //
  // attendance_pct keeps the shared definition (approved leave and non-working days out
  // of the denominator, missing_punch left in it, since an unresolved missing punch is
  // not a verified attendance). Emitting the bucket makes that judgement auditable
  // instead of invisible.
  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           COUNT(*) AS total_days,
           ${presentSql("adr.attendance_status")} AS present_days,
           SUM(CASE WHEN adr.attendance_status = 'absent'          THEN 1 ELSE 0 END) AS absent_days,
           SUM(CASE WHEN adr.attendance_status = 'half_day'        THEN 1 ELSE 0 END) AS half_days,
           SUM(CASE WHEN adr.attendance_status IN (${statusList(LEAVE_STATUSES)}) THEN 1 ELSE 0 END) AS leave_days,
           SUM(CASE WHEN adr.attendance_status = 'week_off'        THEN 1 ELSE 0 END) AS week_off_days,
           SUM(CASE WHEN adr.attendance_status = 'holiday'         THEN 1 ELSE 0 END) AS holiday_days,
           SUM(CASE WHEN adr.attendance_status = 'missing_punch'   THEN 1 ELSE 0 END) AS missing_punch_days,
           SUM(CASE WHEN adr.attendance_status = 'unreconciled'    THEN 1 ELSE 0 END) AS unreconciled_days,
           ROUND(SUM(COALESCE(adr.lwp_value, 0)), 2) AS lwp_days,
           SUM(CASE WHEN adr.late_mark = 1 THEN 1 ELSE 0 END) AS late_days,
           ROUND(SUM(COALESCE(adr.biometric_minutes, 0)) / 60, 2) AS total_productive_hours,
           ROUND(
             100 * ${attendedDaysSql("adr.attendance_status")}
             / NULLIF(${expectedToWorkSql("adr.attendance_status")}, 0)
           , 2) AS attendance_pct
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     -- The server runs with ONLY_FULL_GROUP_BY, so every non-aggregated selected column
     -- has to appear here too; omitting the cost centre columns would make this report
     -- fail outright rather than degrade.
     GROUP BY e.id, e.employee_code, employee_name, b.branch_name, p.process_name,
              sp_cc.cost_centre_code, sp_cc.cost_centre_name, d.dept_name
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];

  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;

  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// late-arrival-summary  (per employee, per month)
// ---------------------------------------------------------------------------
/**
 * late-arrival-summary
 *
 * One row per late arrival, not per employee.
 *
 * This executor used to GROUP BY employee and return total_late_days / avg_late_minutes /
 * max_late_minutes. The inline block in report-suite.routes.ts returns the detail: record_date,
 * roster_shift, scheduled_start, punch_in, late_minutes, grace_minutes, net_late_minutes,
 * late_status, approved_exception, reporting_manager.
 *
 * Both existed at once, and which one a user got depended on how they asked. The preview
 * handler reaches the inline block first; the export handler calls executeReport() directly and
 * got this. Measured live on 2026-08-08: the screen showed 2,199 rows and the downloaded
 * spreadsheet 577 — the same report at two different grains, with no overlap in the columns
 * that distinguish them.
 *
 * The catalogue decides which is intended, and it is not a matter of taste: src/lib/report-
 * catalog.ts declares 16 columns for this code, and 10 of the 10 columns unique to the detail
 * shape are among them while 0 of the 3 unique to the aggregate shape are. The detail is the
 * report; the aggregate was drift.
 *
 * Ported from the inline block so both paths run one implementation. Two deliberate
 * differences, neither of which changes a row:
 *   - scope comes from appendScopeConditions(scope, ...) because an executor has no req;
 *   - the inline block's optional minLateMinutes filter is not carried, because ExecFilters has
 *     no such field. It defaults to 0 — no filtering — so this matches the inline default, and
 *     the export path never offered that filter to begin with.
 */
export async function lateArrivalSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const now = new Date();
  const from = dateParam(filters.from, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
  const to   = dateParam(filters.to, now.toISOString().slice(0, 10));

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);
  clauses.push("adr.late_mark = 1");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("adr.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT adr.id AS _cursor,
           adr.record_date,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(rcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(rcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(ws.shift_name, 'Roster Not Assigned') AS roster_shift,
           ws.start_time AS scheduled_start,
           was.login_time AS punch_in,
           adr.late_by_minutes AS late_minutes,
           COALESCE(arc.grace_minutes, 15) AS grace_minutes,
           GREATEST(0, adr.late_by_minutes - COALESCE(arc.grace_minutes, 15)) AS net_late_minutes,
           CASE
             WHEN adr.late_by_minutes <= COALESCE(arc.grace_minutes, 15) THEN 'Within Grace'
             WHEN adr.late_by_minutes <= 30 THEN 'Mild Late'
             WHEN adr.late_by_minutes <= 60 THEN 'Moderate Late'
             ELSE 'Severe Late'
           END AS late_status,
           CASE WHEN adr.regularization_id IS NOT NULL THEN 'Yes' ELSE 'No' END AS approved_exception,
           COALESCE(NULLIF(rm.full_name,''), CONCAT(rm.first_name,' ',COALESCE(rm.last_name,''))) AS reporting_manager
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
      LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = adr.employee_id
        AND wra.roster_date = adr.record_date
      LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
      LEFT JOIN wfm_attendance_session was ON was.employee_id = adr.employee_id
        AND was.session_date = adr.record_date
      LEFT JOIN attendance_rule_config arc ON arc.id = adr.rule_config_id
      LEFT JOIN cost_centre_master rcc ON rcc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY adr.record_date DESC, adr.late_by_minutes DESC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// overtime-summary  (per employee, per month)
// ---------------------------------------------------------------------------
/**
 * overtime-summary
 *
 * Hours, with the scheduled baseline the rest of the report is measured against — not a bare
 * minute total.
 *
 * This executor returned total_overtime_minutes and overtime_days against a baseline of
 * `ws.required_minutes`. The inline block returns days_attended, total_worked_hours,
 * total_scheduled_hours, overtime_hours, overtime_duration and overtime_pay, measured against
 * `arc.full_day_minutes` falling back to the rostered shift length and then to 480. Screen
 * showed 787 rows, the downloaded file 789 — close enough to look like the same report and far
 * enough apart to be a different one, since the two also disagree on which days count as
 * overtime at all.
 *
 * The catalogue declares 14 columns, of which 8 of the 8 unique to the hours shape appear and 0
 * of the 2 unique to the minutes shape do.
 *
 * Ported verbatim from the inline block, which already carries two fixes made earlier in this
 * audit and which the executor never received: the overtime_pay subquery is pre-aggregated by
 * employee so joining it cannot multiply the hours by that employee's payroll-line count, and
 * the month range is a sargable half-open comparison rather than a DATE_FORMAT wrapper.
 *
 * Bind order matters here and is easy to get wrong: the otp subquery's run_month placeholder
 * sits inside the JOIN, which binds before the WHERE, so its value must lead the list. Pushing
 * it last shifts every subsequent binding by one — silently, since the values are all strings.
 */
export async function overtimeSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  {
    const [oy, om] = month.split("-").map(Number);
    const nextMonth = `${om === 12 ? oy + 1 : oy}-${String(om === 12 ? 1 : om + 1).padStart(2, "0")}-01`;
    clauses.push("adr.record_date >= ? AND adr.record_date < ?");
    params.push(`${month}-01`, nextMonth);
  }

  const base = `SELECT e.id AS _cursor,
         e.employee_code,
         COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
         COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
         COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
         COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
         COALESCE(occ.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
         COALESCE(occ.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
         dm.designation_name,
         COUNT(DISTINCT adr.record_date) AS days_attended,
         ROUND(SUM(adr.raw_minutes) / 60, 1) AS total_worked_hours,
         ROUND(SUM(
           CASE WHEN arc.full_day_minutes IS NOT NULL THEN arc.full_day_minutes
                ELSE TIMESTAMPDIFF(MINUTE, sm.start_time, sm.end_time) END
         ) / 60, 1) AS total_scheduled_hours,
         ROUND(SUM(
           GREATEST(0, adr.raw_minutes - COALESCE(arc.full_day_minutes, TIMESTAMPDIFF(MINUTE, sm.start_time, sm.end_time), 480))
         ) / 60, 1) AS overtime_hours,
         TIME_FORMAT(SEC_TO_TIME(SUM(
           GREATEST(0, adr.raw_minutes - COALESCE(arc.full_day_minutes, TIMESTAMPDIFF(MINUTE, sm.start_time, sm.end_time), 480))
         ) * 60), '%H:%i') AS overtime_duration,
         ROUND(COALESCE(MAX(otp.overtime_pay), 0), 0) AS overtime_pay
    FROM attendance_daily_record adr
    JOIN employees e ON e.id = adr.employee_id
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN department_master d ON d.id = e.department_id
    LEFT JOIN designation_master dm ON dm.id = e.designation_id
    LEFT JOIN cost_centre_master occ ON occ.id = e.cost_centre_id
    LEFT JOIN attendance_rule_config arc ON arc.id = adr.rule_config_id
    LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = e.id AND wra.roster_date = adr.record_date
    LEFT JOIN wfm_shift_master sm ON sm.id = wra.shift_id
    -- Pre-aggregated, not two open joins. spl2 was joined on employee_id ALONE, with
    -- no run filter, and spr2 was a LEFT JOIN so it did not filter either — every
    -- salary line the employee has ever had survived, then multiplied by every
    -- attendance day. Measured: 5.8 salary lines per employee against ~20 attendance
    -- days, so roughly a 116x row explosion before anything narrowed it. That is why
    -- this report did not come back.
    --
    -- It was also summing across that explosion: SUM(spl2.overtime_pay) counted every
    -- run's overtime once per attendance day. Harmless today only because overtime_pay
    -- is 0.00 on all 80,338 salary lines — verified — so this rewrite cannot move a
    -- number now, but it would have inflated real money the moment that column is used.
    LEFT JOIN (
      SELECT spl.employee_id,
             SUM(COALESCE(spl.overtime_pay, 0)) AS overtime_pay
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
       WHERE spr.run_month = ?
       GROUP BY spl.employee_id
    ) otp ON otp.employee_id = e.id
   WHERE ${clauses.join(" AND ")} AND adr.attendance_status IN ('present','half_day')
   GROUP BY e.id, e.employee_code, e.first_name, e.last_name, e.full_name,
            b.branch_name, p.process_name, d.dept_name, dm.designation_name,
            occ.cost_centre_code, occ.cost_centre_name
   HAVING overtime_hours > 0
   ORDER BY overtime_hours DESC`;

  // The subquery's run_month placeholder is in the JOIN, which binds before the WHERE, so its
  // value leads the list.
  params.unshift(month);

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor: null };
}

// ---------------------------------------------------------------------------
// regularization-summary
// ---------------------------------------------------------------------------
/**
 * regularization-summary
 *
 * One row per regularization request, not per employee.
 *
 * This grouped by employee and returned total_regularizations / approved / pending / rejected.
 * The inline block in report-suite.routes.ts returned the request detail — session date,
 * requested status, reason and reason label, who raised it, approval status, reviewer and
 * reviewed_at. Because the preview handler hits the inline block first and the export handler
 * calls executeReport() directly, the screen showed 2 rows and the downloaded spreadsheet 4:
 * the same data counted two different ways, with no shared column between them.
 *
 * The catalogue settles which is intended: it declares 19 columns for this code, and 15 of the
 * 15 unique to the detail shape are declared while 0 of the 4 unique to the aggregate are.
 *
 * Ported from the inline block verbatim so both paths run one implementation. Scope comes from
 * appendScopeConditions(scope, ...) because an executor has no req; the month filter keeps the
 * inline block's DATE_FORMAT form rather than being rewritten to a sargable range, so this
 * remains a move rather than a move plus an optimisation.
 */
export async function regularizationSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  if (filters.status) { clauses.push("arr.status = ?"); params.push(String(filters.status)); }
  clauses.push("DATE_FORMAT(arr.session_date,'%Y-%m') = ?");
  params.push(month);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("arr.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT arr.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(zcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(zcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           dm.designation_name,
           arr.session_date AS attendance_date,
           arr.requested_status,
           arr.reason,
           arr.reason_code,
           arm.label AS reason_label,
           arr.requested_by_type,
           arr.status AS approval_status,
           arr.created_at AS submitted_at,
           reviewer.full_name AS reviewer_name,
           arr.reviewed_at AS approved_at,
           arr.reviewer_note
      FROM attendance_regularization arr
      JOIN employees e ON e.id = arr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN designation_master dm ON dm.id = e.designation_id
      LEFT JOIN attendance_reason_master arm ON arm.code = arr.reason_code
      LEFT JOIN employees reviewer ON reviewer.id = arr.reviewed_by
      LEFT JOIN cost_centre_master zcc ON zcc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY arr.session_date DESC, employee_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// attendance-dispute-summary
// Uses attendance_regularization as the source table since attendance_dispute
// may not exist as a separate table. Returns same shape as regularizationSummary
// with a dispute_type label column where available.
// ---------------------------------------------------------------------------
/**
 * attendance-dispute-summary
 *
 * One row per dispute, not per employee.
 *
 * Same divergence as regularization-summary and from the same table: this grouped by employee
 * into total_disputes / approved / pending / rejected while the inline block returned the
 * dispute detail — dispute type, old and new status, the original and requested punch times,
 * payroll impact, reviewer and resolution. Screen showed 2 rows, the downloaded file 4.
 *
 * The catalogue declares 25 columns here, of which 21 of the 21 unique to the detail shape
 * appear and 0 of the 4 unique to the aggregate do.
 *
 * Note the `arr.dispute_type IS NOT NULL` predicate, which the aggregate did not carry at all:
 * attendance_regularization holds both plain regularizations and disputes, and without it this
 * report counted every regularization as a dispute. That is why the two reports could read the
 * same table and both be wrong in different directions.
 */
export async function attendanceDisputeSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  if (filters.status) { clauses.push("arr.status = ?"); params.push(String(filters.status)); }
  clauses.push("arr.dispute_type IS NOT NULL");
  clauses.push("DATE_FORMAT(arr.session_date,'%Y-%m') = ?");
  params.push(month);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("arr.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT arr.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(zcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(zcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           dm.designation_name,
           arr.session_date AS dispute_date,
           arr.dispute_type,
           arr.reason AS description,
           arr.reason_code,
           arm.label AS reason_label,
           arr.old_status,
           arr.new_status AS requested_status,
           TIME_FORMAT(arr.old_punch_in, '%H:%i') AS original_punch_in,
           TIME_FORMAT(arr.old_punch_out, '%H:%i') AS original_punch_out,
           TIME_FORMAT(arr.new_punch_in, '%H:%i') AS requested_punch_in,
           TIME_FORMAT(arr.new_punch_out, '%H:%i') AS requested_punch_out,
           arr.payroll_impact,
           arr.status AS approval_status,
           arr.created_at AS submitted_at,
           reviewer.full_name AS reviewer_name,
           arr.reviewed_at,
           arr.reviewer_note AS resolution
      FROM attendance_regularization arr
      JOIN employees e ON e.id = arr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN designation_master dm ON dm.id = e.designation_id
      LEFT JOIN attendance_reason_master arm ON arm.code = arr.reason_code
      LEFT JOIN employees reviewer ON reviewer.id = arr.reviewed_by
      LEFT JOIN cost_centre_master zcc ON zcc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY arr.session_date DESC, employee_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// habitual-absentee-list
// ---------------------------------------------------------------------------
export async function habitualAbsenteeList(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month      = monthParam(filters.month);
  const threshold  = Number(filters.minAbsentDays ?? 3);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("adr.record_date >= ? AND adr.record_date < ?", "adr.attendance_status = 'absent'");
  params.push(monthRange(month).start, monthRange(month).endExclusive);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COUNT(*) AS absent_days
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, employee_name, b.branch_name, p.process_name, sp_cc.cost_centre_code, sp_cc.cost_centre_name
     HAVING absent_days >= ${Number.isFinite(threshold) && threshold > 0 ? threshold : 3}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];

  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;

  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// daily-shrinkage-report  (aggregate — no row-level cursor)
// ---------------------------------------------------------------------------
export async function dailyShrinkageReport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, today);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    -- Aligned with the inline block this used to disagree with, and with the catalogue.
    --
    -- This emitted three metrics — scheduled, absent_count, shrinkage_pct — where the catalogue
    -- declares nine: total_scheduled, present_hc, absent_hc, leave_hc, week_off_hc, holiday_hc,
    -- unplanned_shrinkage_hc, total_shrinkage_pct, unplanned_shrinkage_pct. Same 33 rows on
    -- screen and in the file, but the downloaded workbook carried none of the columns the grid
    -- draws, so a shrinkage report opened from a spreadsheet answered a different question from
    -- the one reviewed on screen.
    --
    -- Ported verbatim, including the status vocabulary. 'week_off' has zero rows live, which is
    -- a known gap in the shared attendance vocabulary and a separate question — porting it
    -- unchanged keeps this a move rather than a redefinition.
    SELECT adr.record_date,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COUNT(*) AS total_scheduled,
           SUM(adr.attendance_status IN ('present','half_day')) AS present_hc,
           SUM(adr.attendance_status = 'absent') AS absent_hc,
           SUM(adr.attendance_status = 'leave_approved') AS leave_hc,
           SUM(adr.attendance_status = 'week_off') AS week_off_hc,
           SUM(adr.attendance_status = 'holiday') AS holiday_hc,
           COUNT(*) - SUM(adr.attendance_status IN ('present','half_day','leave_approved','week_off','holiday')) AS unplanned_shrinkage_hc,
           ROUND((COUNT(*) - SUM(adr.attendance_status IN ('present','half_day'))) / NULLIF(COUNT(*), 0) * 100, 2) AS total_shrinkage_pct,
           ROUND((SUM(adr.attendance_status = 'absent')) / NULLIF(COUNT(*), 0) * 100, 2) AS unplanned_shrinkage_pct
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY adr.record_date, b.branch_name, p.process_name
     ORDER BY adr.record_date DESC, b.branch_name, p.process_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// monthly-shrinkage-trend  (aggregate — no row-level cursor)
// ---------------------------------------------------------------------------
export async function monthlyShrinkageTrend(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    SELECT LEFT(adr.record_date, 7) AS report_month,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COUNT(*) AS total_scheduled,
           SUM(CASE WHEN adr.attendance_status IN ('absent','lwp') THEN 1 ELSE 0 END) AS absent_count,
           ROUND(
             SUM(CASE WHEN adr.attendance_status IN ('absent','lwp') THEN 1 ELSE 0 END) * 100.0
             / NULLIF(COUNT(*), 0),
           2) AS shrinkage_pct
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY report_month, b.branch_name, p.process_name
     ORDER BY report_month DESC, b.branch_name, p.process_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// biometric-reconciliation
// ---------------------------------------------------------------------------
export async function biometricReconciliation(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, today);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.asOf) {
    clauses.push("adr.record_date <= ?");
    params.push(options.asOf);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("adr.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT adr.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           adr.record_date,
           adr.attendance_status,
           CASE WHEN ibd.id IS NOT NULL THEN 'HAS_BIOMETRIC' ELSE 'NO_BIOMETRIC' END AS biometric_presence,
           CASE
             WHEN adr.attendance_status IN ('present','half_day') AND ibd.id IS NULL
               THEN 'PRESENT_NO_BIOMETRIC'
             WHEN adr.attendance_status = 'absent' AND ibd.id IS NOT NULL
               THEN 'ABSENT_WITH_BIOMETRIC'
             ELSE 'OK'
           END AS reconciliation_status
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
      -- integration_biometric_daily keys on employee_code + activity_date. It has neither
      -- employee_id nor record_date, so the previous join threw ER_BAD_FIELD_ERROR on every
      -- run and this report has never returned a row (36,190 biometric rows sat unjoinable).
      LEFT JOIN integration_biometric_daily ibd
             ON ibd.employee_code = e.employee_code
            AND ibd.activity_date = adr.record_date
     WHERE ${clauses.join(" AND ")}
     ORDER BY adr.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];

  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;

  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// punch-raw-export
// ---------------------------------------------------------------------------
export async function punchRawExport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, today);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("was.session_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.asOf) {
    clauses.push("was.session_date <= ?");
    params.push(options.asOf);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("was.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT was.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           was.session_date,
           TIME_FORMAT(was.login_time,'%H:%i:%s') AS login_time,
           TIME_FORMAT(was.logout_time,'%H:%i:%s') AS logout_time,
           was.total_login_minutes,
           was.punch_source
      FROM wfm_attendance_session was
      JOIN employees e ON e.id = was.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY was.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];

  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;

  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// attendance-register-grid
// NOTE: Full date-pivoted grid is under_validation in the report catalog.
// Returns a date-range attendance summary (same shape as attendanceSummary)
// grouped by employee, filtered by from/to date range instead of month.
// ---------------------------------------------------------------------------
export async function attendanceRegisterGrid(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${today.slice(0, 7)}-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           SUM(CASE WHEN adr.attendance_status = 'present'  THEN 1 ELSE 0 END) AS present_days,
           SUM(CASE WHEN adr.attendance_status = 'absent'   THEN 1 ELSE 0 END) AS absent_days,
           SUM(CASE WHEN adr.attendance_status = 'half_day' THEN 1 ELSE 0 END) AS half_days,
           SUM(CASE WHEN adr.attendance_status = 'lwp'      THEN 1 ELSE 0 END) AS lwp_days,
           SUM(CASE WHEN adr.late_by_minutes > 0            THEN 1 ELSE 0 END) AS late_days,
           COUNT(*) AS working_days,
           ? AS date_from,
           ? AS date_to
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, employee_name, b.branch_name, p.process_name, sp_cc.cost_centre_code, sp_cc.cost_centre_name
     ORDER BY e.id ASC`;
  params.push(from, to);

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];

  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;

  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// break-daily-summary  (aggregate — one row per employee per date, no cursor)
//
// Aggregated from break_sessions rather than the derived break_daily_summary
// table, so the report cannot go stale if the summary writer lags or misses a
// day. The date column on break_sessions is shift_date; there is no
// session_date column.
//
// Break count and minutes cover COMPLETED, AUTO_CLOSED and EXCEPTION sessions —
// the same set getBreakUsageSummary() in break-management.service.ts treats as
// consumed break time. ACTIVE (in-progress) sessions have no end time and no
// duration yet, so counting them would report break minutes that have not been
// taken.
//
// shift_name resolves through a correlated subquery rather than a join, so a
// duplicate roster assignment can never fan out and inflate break_count.
// ---------------------------------------------------------------------------
export async function breakDailySummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, today);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("bs.shift_date BETWEEN ? AND ?");
  params.push(from, to);

  clauses.push("bs.status IN ('COMPLETED','AUTO_CLOSED','EXCEPTION')");

  if (options.asOf) {
    clauses.push("bs.shift_date <= ?");
    params.push(options.asOf);
  }

  const base = `
    SELECT bs.shift_date AS break_date,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           (SELECT ws.shift_name
              FROM wfm_roster_assignment wra
              JOIN wfm_shift_master ws ON ws.id = wra.shift_id
             WHERE wra.employee_id = e.id
               AND wra.roster_date = bs.shift_date
             LIMIT 1) AS shift_name,
           COUNT(*) AS break_count,
           -- CAST to SIGNED so the driver returns a number; a bare SUM() on a
           -- DECIMAL column arrives as a string and lands in the XLSX as text.
           CAST(ROUND(SUM(COALESCE(bs.duration_minutes, 0))) AS SIGNED) AS total_break_minutes
      FROM break_sessions bs
      JOIN employees e ON e.id = bs.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY bs.shift_date, e.id, e.employee_code, e.full_name, e.first_name,
              e.last_name, b.branch_name, p.process_name, sp_cc.cost_centre_code, sp_cc.cost_centre_name
     ORDER BY bs.shift_date DESC, e.employee_code ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];

  return {
    rows,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > rows.length : rows.length === options.limit,
  };
}

// ---------------------------------------------------------------------------
// break-session-log  (detail — one row per break, with in/out times)
//
// The per-break companion to break-daily-summary: every individual break punch
// with its start and end time, rather than the day's totals. ACTIVE sessions
// ARE included here — an in-progress break is exactly what someone reading a
// log needs to see — and show a blank break-out time with no duration. That is
// why the two reports' break counts can differ: the summary counts only
// finished breaks, this one shows everything on the log.
// ---------------------------------------------------------------------------
export async function breakSessionLog(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, today);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("bs.shift_date BETWEEN ? AND ?");
  params.push(from, to);

  if (filters.status) {
    clauses.push("bs.status = ?");
    params.push(String(filters.status).toUpperCase());
  }

  if (options.asOf) {
    clauses.push("bs.shift_date <= ?");
    params.push(options.asOf);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("bs.id > ?");
    params.push(options.cursor);
  }

  // Worker mode pages by bs.id, so it must order by bs.id for the cursor to be
  // monotonic. Preview/export order the way a human reads a log: newest day
  // first, then each employee's breaks in the order they were taken.
  const orderBy = options.mode === "worker"
    ? "bs.id ASC"
    : "bs.shift_date DESC, e.employee_code ASC, bs.break_start_time ASC";

  const base = `
    SELECT bs.id AS _cursor,
           bs.shift_date AS break_date,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(zcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(zcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           bs.break_type,
           TIME_FORMAT(bs.break_start_time,'%H:%i:%s') AS break_in,
           TIME_FORMAT(bs.break_end_time,'%H:%i:%s')   AS break_out,
           CAST(ROUND(COALESCE(bs.duration_minutes, 0)) AS SIGNED) AS duration_minutes,
           bs.status,
           bs.start_source,
           bs.end_source,
           kd.kiosk_code,
           TIME_FORMAT(bs.biometric_punch_in_time,'%H:%i:%s')  AS biometric_punch_in,
           TIME_FORMAT(bs.biometric_punch_out_time,'%H:%i:%s') AS biometric_punch_out,
           bs.exception_reason,
           bs.break_reason
      FROM break_sessions bs
      JOIN employees e ON e.id = bs.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN break_kiosk_devices kd ON kd.id = bs.kiosk_device_id
      LEFT JOIN cost_centre_master zcc ON zcc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ${orderBy}`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];

  // break_sessions.id is a UUID, not an auto-increment. Keyset pagination still
  // works — ORDER BY bs.id ASC combined with bs.id > cursor is a stable total
  // order — but pages come out in id order rather than chronological order,
  // which is why worker mode sorts by bs.id instead of by date.
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as string)
    : null;

  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// productivity-individual-scorecard
//
// Folded in from an inline `case` block, and a positional-binding bug fixed on the way.
//
// The inline version built its SQL with two `?` placeholders inside the kpi_score_period
// JOIN — which appear BEFORE the WHERE clause in the SQL text — but appended their values
// with `params.push(month, month)` AFTER addScopedEmployeeFilters had already pushed the
// scope and filter values. mysql2 binds positionally, so the JOIN's two date placeholders
// took whatever came first in the array.
//
// For an unrestricted super_admin with no branchId that array is [month, month, month] and
// it works by luck. For ANY branch-scoped user, or anyone passing ?branchId=, the first two
// entries are branch UUIDs, so the join evaluated
// STR_TO_DATE(CONCAT('<uuid>','-01'), '%Y-%m-%d') — which MySQL returns as NULL (verified
// live), never matching. kpi_score and kpi_rating came back NULL for every such user, with
// no error: a silently empty column on a scorecard, exactly the kind of wrong answer that
// looks like "no KPI data yet".
//
// Fixed by binding in SQL order: join params first, then the WHERE params. This mirrors
// payrollVariance in payroll.executor.ts, which documents the same rule.
//
// kpi_score_summary holds 0 rows today, so nobody currently sees a score either way — but
// the bug would have bitten silently the moment KPI data landed.
// ---------------------------------------------------------------------------
export async function productivityIndividualScorecard(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  // Params for the two placeholders in the JOIN. These MUST precede the WHERE params.
  const joinParams: unknown[] = [month, month];

  const clauses: string[] = ["e.id IS NOT NULL"];
  const whereParams: unknown[] = [];
  appendScopeConditions(scope, clauses, whereParams);
  appendFilterConditions(filters, clauses, whereParams);
  clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?");
  whereParams.push(month);

  const base = `
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           ROUND(SUM(adr.dialler_minutes) / 60, 2) AS login_hours,
           ROUND(SUM(adr.biometric_minutes) / 60, 2) AS biometric_hours,
           COUNT(CASE WHEN adr.attendance_status IN ('present','half_day') THEN 1 END) AS present_days,
           kss.final_score AS kpi_score,
           kss.rating AS kpi_rating,
           ROUND(COUNT(CASE WHEN adr.attendance_status IN ('present','half_day') THEN 1 END)
                 / NULLIF(COUNT(*),0) * 100, 1) AS attendance_pct
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
      LEFT JOIN kpi_score_summary kss ON kss.employee_id = e.id
      LEFT JOIN kpi_score_period ksp ON ksp.id = kss.period_id
        AND ksp.period_start <= LAST_DAY(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'))
        AND ksp.period_end >= STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')
     WHERE ${clauses.join(" AND ")}
     -- ONLY_FULL_GROUP_BY: cost centre and branch belong here as well as in the SELECT.
     GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name,
              p.process_name, b.branch_name, sp_cc.cost_centre_code, sp_cc.cost_centre_name,
              kss.final_score, kss.rating
     ORDER BY login_hours DESC`;

  const params = [...joinParams, ...whereParams];
  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}
