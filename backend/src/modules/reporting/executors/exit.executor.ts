/**
 * Exit & Attrition executor
 *
 * Covers codes: resignation-register, fnf-pending-register, fnf-settlement-register,
 * clearance-status-register, monthly-attrition-summary, exit-reason-analysis,
 * tenure-distribution, early-attrition-report
 *
 * Every query includes WHERE e.company_id = :companyId to enforce tenant isolation.
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
// resignation-register
// ---------------------------------------------------------------------------
export async function resignationRegister(
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
  clauses.push("(e.resignation_date IS NOT NULL OR eer.id IS NOT NULL)");
  clauses.push("COALESCE(eer.resignation_date, e.resignation_date) BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(eer.resignation_date, e.resignation_date) AS resignation_date,
           COALESCE(eer.last_working_day, e.last_working_day) AS last_working_day,
           COALESCE(eer.exit_reason, e.resignation_reason) AS exit_reason,
           COALESCE(eer.approval_status, e.exit_status) AS status,
           COALESCE(eer.notice_period_served, 0) AS notice_days,
           b.branch_name, p.process_name
      FROM employees e
      LEFT JOIN exit_request eer ON eer.employee_id = e.id
      LEFT JOIN branch_master b           ON b.id = e.branch_id
      LEFT JOIN process_master p          ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// fnf-pending-register
// ---------------------------------------------------------------------------
export async function fnfPendingRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.employment_status IN ('resigned','separated')");
  clauses.push("COALESCE(e.fnf_status,'PENDING') NOT IN ('completed','settled')");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_exit,
           e.last_working_day,
           e.employment_status,
           COALESCE(e.fnf_status,'PENDING') AS fnf_status,
           DATEDIFF(CURDATE(), COALESCE(e.date_of_exit, e.last_working_day)) AS days_since_exit,
           b.branch_name, p.process_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// fnf-settlement-register
// NOTE: Uses employee_fnf_settlement via LEFT JOIN. If that table does not yet
// exist in your schema, the LEFT JOIN will throw a runtime SQL error. In that
// case, remove the LEFT JOIN and replace fs.* columns with NULL AS column_name.
// ---------------------------------------------------------------------------
export async function fnfSettlementRegister(
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
  clauses.push("e.fnf_status = 'completed'");
  clauses.push("COALESCE(fs.settlement_date, e.last_working_day) BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(fs.settlement_date, e.last_working_day) AS settlement_date,
           fs.total_earnings,
           fs.total_deductions,
           fs.net_payable,
           COALESCE(fs.payment_status, e.fnf_status) AS payment_status,
           LEFT(COALESCE(fs.settlement_date, e.last_working_day), 7) AS settlement_month,
           b.branch_name, p.process_name
      FROM employees e
      LEFT JOIN employee_fnf_settlement fs ON fs.employee_id = e.id
      LEFT JOIN branch_master b            ON b.id = e.branch_id
      LEFT JOIN process_master p           ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// clearance-status-register
// NOTE: Uses employee_clearance via LEFT JOIN. If that table does not exist,
// remove the LEFT JOIN; ec.* columns will return NULL, giving a plain exited-
// employee list with empty clearance fields.
// ---------------------------------------------------------------------------
export async function clearanceStatusRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.employment_status IN ('resigned','separated','exited')");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ec.clearance_type,
           ec.clearance_status,
           ec.cleared_by,
           ec.clearance_date,
           ec.remarks,
           b.branch_name, p.process_name
      FROM employees e
      LEFT JOIN employee_clearance ec ON ec.employee_id = e.id
      LEFT JOIN branch_master b       ON b.id = e.branch_id
      LEFT JOIN process_master p      ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// monthly-attrition-summary  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function monthlyAttritionSummary(
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
  clauses.push("COALESCE(e.date_of_exit, e.last_working_day, e.resignation_date) BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    SELECT LEFT(COALESCE(e.date_of_exit, e.last_working_day, e.resignation_date), 7) AS exit_month,
           b.branch_name,
           p.process_name,
           COUNT(*) AS attrition_count
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY exit_month, b.branch_name, p.process_name
     ORDER BY exit_month ASC, b.branch_name, p.process_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// exit-reason-analysis  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function exitReasonAnalysis(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("COALESCE(e.date_of_exit, e.last_working_day, e.resignation_date) IS NOT NULL");

  const base = `
    SELECT COALESCE(e.resignation_reason, 'Not Specified') AS exit_reason,
           COUNT(*) AS count,
           b.branch_name,
           p.process_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY exit_reason, b.branch_name, p.process_name
     ORDER BY count DESC, b.branch_name, p.process_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// tenure-distribution  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function tenureDistribution(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.company_id = ?"];
  const params: unknown[]  = [scope.companyId];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1", "LOWER(COALESCE(e.employment_status,'active')) = 'active'");

  const base = `
    SELECT CASE
             WHEN TIMESTAMPDIFF(MONTH, e.date_of_joining, CURDATE()) < 3  THEN '0-3 months'
             WHEN TIMESTAMPDIFF(MONTH, e.date_of_joining, CURDATE()) < 6  THEN '3-6 months'
             WHEN TIMESTAMPDIFF(MONTH, e.date_of_joining, CURDATE()) < 12 THEN '6-12 months'
             WHEN TIMESTAMPDIFF(YEAR,  e.date_of_joining, CURDATE()) < 2  THEN '1-2 years'
             WHEN TIMESTAMPDIFF(YEAR,  e.date_of_joining, CURDATE()) < 5  THEN '2-5 years'
             ELSE '5+ years'
           END AS tenure_bucket,
           COUNT(*) AS headcount,
           b.branch_name,
           p.process_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY tenure_bucket, b.branch_name, p.process_name
     ORDER BY b.branch_name, p.process_name, tenure_bucket`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// early-attrition-report  (left within 90 days of joining)
// ---------------------------------------------------------------------------
export async function earlyAttritionReport(
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
  clauses.push("COALESCE(e.date_of_exit, e.last_working_day) IS NOT NULL");
  clauses.push("DATEDIFF(COALESCE(e.date_of_exit, e.last_working_day), e.date_of_joining) <= 90");
  clauses.push("COALESCE(e.date_of_exit, e.last_working_day) BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_joining,
           COALESCE(e.date_of_exit, e.last_working_day) AS date_of_exit,
           DATEDIFF(COALESCE(e.date_of_exit, e.last_working_day), e.date_of_joining) AS days_employed,
           e.resignation_reason,
           b.branch_name, p.process_name
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}
