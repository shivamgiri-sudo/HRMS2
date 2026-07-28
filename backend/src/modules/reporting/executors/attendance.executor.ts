/**
 * Attendance executor
 *
 * Covers codes: attendance-daily, daily-hc-shift, shift-adherence-detail,
 * attendance-summary, late-arrival-summary, overtime-summary,
 * regularization-summary, attendance-dispute-summary, habitual-absentee-list,
 * daily-shrinkage-report, monthly-shrinkage-trend, biometric-reconciliation,
 * punch-raw-export, attendance-register-grid, break-daily-summary
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("LEFT(adr.record_date, 7) = ?");
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
           SUM(CASE WHEN adr.attendance_status = 'present'  THEN 1 ELSE 0 END) AS present_days,
           SUM(CASE WHEN adr.attendance_status = 'absent'   THEN 1 ELSE 0 END) AS absent_days,
           SUM(CASE WHEN adr.attendance_status = 'half_day' THEN 1 ELSE 0 END) AS half_days,
           SUM(CASE WHEN adr.attendance_status = 'lwp'      THEN 1 ELSE 0 END) AS lwp_days,
           SUM(CASE WHEN adr.late_by_minutes > 0            THEN 1 ELSE 0 END) AS late_days,
           COUNT(*) AS working_days
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
// late-arrival-summary  (per employee, per month)
// ---------------------------------------------------------------------------
export async function lateArrivalSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("LEFT(adr.record_date, 7) = ?");
  clauses.push("adr.raw_minutes > COALESCE(ws.shift_duration_minutes, 480)");
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
           SUM(GREATEST(0, adr.raw_minutes - COALESCE(ws.shift_duration_minutes, 480))) AS total_overtime_minutes,
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("ar.applied_date BETWEEN ? AND ?");
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
           SUM(CASE WHEN ar.approval_status = 'approved' THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN ar.approval_status = 'pending'  THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN ar.approval_status = 'rejected' THEN 1 ELSE 0 END) AS rejected
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("ar.applied_date BETWEEN ? AND ?");
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
           SUM(CASE WHEN ar.approval_status = 'approved' THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN ar.approval_status = 'pending'  THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN ar.approval_status = 'rejected' THEN 1 ELSE 0 END) AS rejected
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
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
      LEFT JOIN integration_biometric_daily ibd
             ON ibd.employee_id = e.id
            AND ibd.record_date = adr.record_date
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
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
           was.session_source
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

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
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
// break-daily-summary  (raw per-break records)
// ---------------------------------------------------------------------------
export async function breakDailySummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, today);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("bs.session_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.asOf) {
    clauses.push("bs.session_date <= ?");
    params.push(options.asOf);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("bs.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT bs.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name,
           p.process_name,
           bs.session_date AS break_date,
           bs.duration_minutes,
           TIME_FORMAT(bs.start_time,'%H:%i:%s') AS break_start,
           TIME_FORMAT(bs.end_time,'%H:%i:%s') AS break_end
      FROM break_session bs
      JOIN employees e ON e.id = bs.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY bs.id ASC`;

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
