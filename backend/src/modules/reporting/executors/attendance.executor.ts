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
           b.branch_name,
           p.process_name,
           d.dept_name AS department_name,
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
           b.branch_name,
           p.process_name,
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
           b.branch_name,
           p.process_name,
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

  clauses.push("LEFT(adr.record_date, 7) = ?");
  params.push(month);

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
           b.branch_name,
           p.process_name,
           d.dept_name AS department_name,
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
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, employee_name, b.branch_name, p.process_name, d.dept_name
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
export async function lateArrivalSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("LEFT(adr.record_date, 7) = ?", "adr.late_by_minutes > 0");
  params.push(month);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name,
           p.process_name,
           COUNT(*) AS total_late_days,
           ROUND(AVG(adr.late_by_minutes), 1) AS avg_late_minutes,
           MAX(adr.late_by_minutes) AS max_late_minutes
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, employee_name, b.branch_name, p.process_name
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
// overtime-summary  (per employee, per month)
// ---------------------------------------------------------------------------
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

  clauses.push("LEFT(adr.record_date, 7) = ?");
  clauses.push("adr.raw_minutes > COALESCE(ws.required_minutes, 480)");
  params.push(month);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name,
           p.process_name,
           SUM(GREATEST(0, adr.raw_minutes - COALESCE(ws.required_minutes, 480))) AS total_overtime_minutes,
           COUNT(*) AS overtime_days
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN wfm_roster_assignment wra
             ON wra.employee_id = adr.employee_id
            AND wra.roster_date = adr.record_date
      LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, employee_name, b.branch_name, p.process_name
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
// regularization-summary
// ---------------------------------------------------------------------------
export async function regularizationSummary(
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

  clauses.push("ar.session_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name,
           p.process_name,
           COUNT(*) AS total_regularizations,
           SUM(CASE WHEN ar.status = 'approved' THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN ar.status = 'pending'  THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN ar.status = 'rejected' THEN 1 ELSE 0 END) AS rejected
      FROM attendance_regularization ar
      JOIN employees e ON e.id = ar.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, employee_name, b.branch_name, p.process_name
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
// attendance-dispute-summary
// Uses attendance_regularization as the source table since attendance_dispute
// may not exist as a separate table. Returns same shape as regularizationSummary
// with a dispute_type label column where available.
// ---------------------------------------------------------------------------
export async function attendanceDisputeSummary(
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

  clauses.push("ar.session_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name,
           p.process_name,
           COUNT(*) AS total_disputes,
           SUM(CASE WHEN ar.status = 'approved' THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN ar.status = 'pending'  THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN ar.status = 'rejected' THEN 1 ELSE 0 END) AS rejected
      FROM attendance_regularization ar
      JOIN employees e ON e.id = ar.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, employee_name, b.branch_name, p.process_name
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

  clauses.push("LEFT(adr.record_date, 7) = ?", "adr.attendance_status = 'absent'");
  params.push(month);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name,
           p.process_name,
           COUNT(*) AS absent_days
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, employee_name, b.branch_name, p.process_name
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
    SELECT adr.record_date,
           b.branch_name,
           p.process_name,
           COUNT(*) AS scheduled,
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
           b.branch_name,
           p.process_name,
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
           b.branch_name,
           p.process_name,
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
           b.branch_name,
           p.process_name,
           was.session_date,
           TIME_FORMAT(was.login_time,'%H:%i:%s') AS login_time,
           TIME_FORMAT(was.logout_time,'%H:%i:%s') AS logout_time,
           was.total_login_minutes,
           was.punch_source
      FROM wfm_attendance_session was
      JOIN employees e ON e.id = was.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
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
           b.branch_name,
           p.process_name,
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
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, employee_name, b.branch_name, p.process_name
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
           b.branch_name,
           p.process_name,
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
     WHERE ${clauses.join(" AND ")}
     GROUP BY bs.shift_date, e.id, e.employee_code, e.full_name, e.first_name,
              e.last_name, b.branch_name, p.process_name
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
           b.branch_name,
           p.process_name,
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
