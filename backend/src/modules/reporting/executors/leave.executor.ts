/**
 * Leave & Absence executor
 *
 * Codes: leave-balance, leave-allocation-register, leave-utilization,
 *        leave-trend-monthly, leave-lwp-reconciliation, maternity-paternity-register,
 *        leave-encashment-register, leave-lapse-summary, holiday-master-list
 *
 * Notes:
 *  - leave_balance_ledger actual columns: balance_year (INT), allocated_days (DECIMAL),
 *    used_days (DECIMAL), adjusted_days (DECIMAL).  No opening_balance / credited /
 *    debited / closing_balance columns exist.
 *  - leave-balance cursor is on e.id (approximate for cross-joined rows — all leave-type
 *    rows for one employee share the same cursor value, so chunk row-count varies).
 *  - leave-encashment-register targets leave_encashment_request; if that table is absent
 *    at runtime, implement a leave_request fallback with an appropriate type filter.
 *  - holiday-master-list expects hm.company_id for tenant isolation; process / dept /
 *    cost-centre scope dimensions are not applicable to this table.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  dateParam,
  monthParam,
  yearParam,
  applyPagination,
  ReportScopeAccessDeniedError,
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
  return Number((rows as any)[0]?.total ?? 0);
}

// ---------------------------------------------------------------------------
// leave-balance
// ---------------------------------------------------------------------------
/**
 * Cross-joins all active leave types with each active employee's balance for the given
 * year.  The year is a validated safe integer from yearParam() and is embedded directly
 * into the JOIN ON clause as a literal — this avoids positional-? conflicts between the
 * JOIN ON parameter and the WHERE parameters.
 */
export async function leaveBalance(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const year = yearParam(filters.year); // safe integer 2001–2099, embedded as literal

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name, p.process_name,
           lt.leave_name, lt.leave_code,
           COALESCE(lbl.allocated_days,0) AS allocated_days,
           COALESCE(lbl.used_days,0) AS used_days,
           COALESCE(lbl.adjusted_days,0) AS adjusted_days,
           COALESCE(lbl.allocated_days,0) + COALESCE(lbl.adjusted_days,0)
             - COALESCE(lbl.used_days,0) AS remaining_days,
           lbl.balance_year
      FROM employees e
      JOIN leave_type_master lt ON lt.active_status = 1
      LEFT JOIN leave_balance_ledger lbl
             ON lbl.employee_id = e.id
            AND lbl.leave_type_id = lt.id
            AND lbl.balance_year = ${year}
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC, lt.leave_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// leave-allocation-register
// ---------------------------------------------------------------------------
export async function leaveAllocationRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (filters.year) {
    clauses.push("la.allocation_year = ?");
    params.push(yearParam(filters.year));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("la.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT la.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           lt.leave_name, lt.leave_code,
           la.allocation_year, la.allocated_days,
           la.effective_from, la.effective_to, la.allocation_reason,
           b.branch_name, p.process_name
      FROM leave_allocation la
      JOIN employees e           ON e.id  = la.employee_id
      JOIN leave_type_master lt  ON lt.id = la.leave_type_id
      LEFT JOIN branch_master b  ON b.id  = e.branch_id
      LEFT JOIN process_master p ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY la.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// leave-utilization
// ---------------------------------------------------------------------------
export async function leaveUtilization(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("lr.approval_status = 'approved'");
  clauses.push("lr.from_date BETWEEN ? AND ?");
  params.push(from, to);

  // Worker cursor on e.id — all leave-type rows for one employee share the same cursor
  // value; keyset pagination resumes cleanly at the next employee.
  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           lt.leave_name, lt.leave_code,
           SUM(lr.number_of_days) AS days_used,
           COUNT(*) AS requests_count,
           b.branch_name, p.process_name
      FROM leave_request lr
      JOIN employees e           ON e.id  = lr.employee_id
      JOIN leave_type_master lt  ON lt.id = lr.leave_type_id
      LEFT JOIN branch_master b  ON b.id  = e.branch_id
      LEFT JOIN process_master p ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code,
              COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))),
              lt.id, lt.leave_name, lt.leave_code,
              b.branch_name, p.process_name
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// leave-trend-monthly
// ---------------------------------------------------------------------------
/**
 * Pure aggregate — no cursor.  applyPagination is used in all modes including worker.
 */
export async function leaveTrendMonthly(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("lr.approval_status = 'approved'");
  clauses.push("lr.from_date BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    SELECT LEFT(lr.from_date,7) AS leave_month,
           lt.leave_name, lt.leave_code,
           SUM(lr.number_of_days) AS total_days,
           COUNT(DISTINCT lr.employee_id) AS employee_count,
           b.branch_name, p.process_name
      FROM leave_request lr
      JOIN employees e           ON e.id  = lr.employee_id
      JOIN leave_type_master lt  ON lt.id = lr.leave_type_id
      LEFT JOIN branch_master b  ON b.id  = e.branch_id
      LEFT JOIN process_master p ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY LEFT(lr.from_date,7),
              lt.id, lt.leave_name, lt.leave_code,
              b.branch_name, p.process_name
     ORDER BY leave_month ASC, lt.leave_name ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options); // always — aggregate report has no cursor
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return {
    rows,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: total > rows.length,
  };
}

// ---------------------------------------------------------------------------
// leave-lwp-reconciliation
// ---------------------------------------------------------------------------
export async function leaveLwpReconciliation(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?", "adr.lwp_value > 0"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (filters.from || filters.to) {
    const today = new Date().toISOString().slice(0, 10);
    const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
    const to    = dateParam(filters.to, today);
    clauses.push("adr.record_date BETWEEN ? AND ?");
    params.push(from, to);
  }

  if (filters.month) {
    clauses.push("LEFT(adr.record_date,7) = ?");
    params.push(monthParam(filters.month));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name, p.process_name,
           SUM(adr.lwp_value) AS total_lwp_days,
           COUNT(lr.id) AS leave_applications,
           SUM(lr.number_of_days) AS leave_days_applied
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN leave_request lr
             ON lr.employee_id = e.id
            AND lr.approval_status = 'approved'
            AND DATE(lr.from_date) = adr.record_date
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code,
              COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))),
              b.branch_name, p.process_name
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// maternity-paternity-register
// ---------------------------------------------------------------------------
export async function maternityPaternityRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push(
    "(lt.leave_code IN ('MAT','PAT','ML','PL') OR LOWER(lt.leave_name) LIKE '%maternity%' OR LOWER(lt.leave_name) LIKE '%paternity%')"
  );

  if (filters.from || filters.to) {
    const today = new Date().toISOString().slice(0, 10);
    const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
    const to    = dateParam(filters.to, today);
    clauses.push("lr.from_date BETWEEN ? AND ?");
    params.push(from, to);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("lr.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT lr.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           lt.leave_name,
           lr.from_date, lr.to_date, lr.number_of_days,
           lr.approval_status, lr.approved_by_name,
           b.branch_name, p.process_name
      FROM leave_request lr
      JOIN employees e           ON e.id  = lr.employee_id
      JOIN leave_type_master lt  ON lt.id = lr.leave_type_id
      LEFT JOIN branch_master b  ON b.id  = e.branch_id
      LEFT JOIN process_master p ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY lr.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// leave-encashment-register
// ---------------------------------------------------------------------------
/**
 * Targets the dedicated leave_encashment_request table.
 * If that table does not exist at runtime, implement a fallback against
 * leave_request WHERE leave_type_code = 'encashment' or equivalent.
 */
export async function leaveEncashmentRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (filters.from || filters.to) {
    const today = new Date().toISOString().slice(0, 10);
    const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
    const to    = dateParam(filters.to, today);
    clauses.push("ler.requested_date BETWEEN ? AND ?");
    params.push(from, to);
  }

  if (filters.status) {
    clauses.push("ler.approval_status = ?");
    params.push(String(filters.status));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("ler.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT ler.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           lt.leave_name, lt.leave_code,
           ler.encashment_days, ler.amount,
           ler.approval_status, ler.requested_date,
           b.branch_name, p.process_name
      FROM leave_encashment_request ler
      JOIN employees e           ON e.id  = ler.employee_id
      JOIN leave_type_master lt  ON lt.id = ler.leave_type_id
      LEFT JOIN branch_master b  ON b.id  = e.branch_id
      LEFT JOIN process_master p ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ler.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// leave-lapse-summary
// ---------------------------------------------------------------------------
export async function leaveLapseSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[] = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  if (filters.year) {
    clauses.push("lbl.balance_year = ?");
    params.push(yearParam(filters.year));
  } else {
    clauses.push("lbl.balance_year < YEAR(CURDATE())");
  }

  // Only rows where leave actually lapsed (allocated minus used still positive)
  clauses.push("(COALESCE(lbl.allocated_days,0) - COALESCE(lbl.used_days,0)) > 0");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           lt.leave_name, lt.leave_code,
           lbl.balance_year,
           COALESCE(lbl.allocated_days,0) AS allocated,
           COALESCE(lbl.used_days,0) AS used,
           COALESCE(lbl.allocated_days,0) - COALESCE(lbl.used_days,0) AS lapsed_days
      FROM employees e
      JOIN leave_type_master lt ON lt.active_status = 1
      LEFT JOIN leave_balance_ledger lbl
             ON lbl.employee_id = e.id
            AND lbl.leave_type_id = lt.id
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC, lt.leave_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// holiday-master-list
// ---------------------------------------------------------------------------
/**
 * holiday_master is not employee-scoped; company and branch scope are applied directly
 * on hm columns.  Process / department / cost-centre scope dimensions are not applicable.
 * Assumes hm.company_id exists; if the column is absent, enforce isolation via
 * branch scope restriction alone and add company_id to the holiday_master schema.
 */
export async function holidayMasterList(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["hm.company_id = ?"];
  const params: unknown[] = [scope.companyId];

  // Branch scope applied directly on hm.branch_id (no employees table in this query)
  if (scope.branchScope.mode === "none") {
    throw new ReportScopeAccessDeniedError("branchScope");
  }
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(`hm.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }

  // User-selected branch narrowing
  if (filters.branchId) {
    clauses.push("hm.branch_id = ?");
    params.push(String(filters.branchId));
  }

  // Year filter
  if (filters.year) {
    clauses.push("hm.applicable_year = ?");
    params.push(yearParam(filters.year));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("hm.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT hm.id AS _cursor,
           hm.holiday_date, hm.holiday_name, hm.holiday_type,
           b.branch_name, hm.applicable_year
      FROM holiday_master hm
      LEFT JOIN branch_master b ON b.id = hm.branch_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY hm.holiday_date ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}
