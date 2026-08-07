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

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("eer.id IS NOT NULL");
  // exit_request has no resignation_date; employees.resignation_date is the real one
  // (29,070 rows populated).
  clauses.push("e.resignation_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.resignation_date,
           -- exit_request stores proposed and confirmed separately; neither is called
           -- last_working_day, and employees has date_of_exit rather than that name.
           COALESCE(eer.last_working_day_confirmed, eer.last_working_day_proposed, e.date_of_exit)
             AS last_working_day,
           eer.exit_reason_category AS exit_reason,
           eer.status,
           COALESCE(eer.notice_period_days, 0) AS notice_days,
           b.branch_name, p.process_name
      FROM employees e
      LEFT JOIN exit_request eer ON eer.employee_id = e.id
      LEFT JOIN branch_master b           ON b.id = e.branch_id
      LEFT JOIN process_master p          ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
  } catch (err: unknown) {
    const mysqlCode = (err as Record<string, unknown>)?.["code"];
    if (mysqlCode === "ER_BAD_FIELD_ERROR" || mysqlCode === "ER_NO_SUCH_TABLE") {
      return { rows: [], rowCount: 0, isTruncated: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// fnf-pending-register
// ---------------------------------------------------------------------------
export async function fnfPendingRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  // employment_status is stored in mixed case: 28,200 rows 'Resigned' against 2,118
  // 'resigned' (measured 2026-08-07). The column collates utf8mb4_unicode_ci, which is
  // case-insensitive, so a bare lowercase IN(...) already matches all 30,318 — verified
  // both forms return the same count. The LOWER() is harmless insurance against a future
  // case-sensitive collation, not a fix for a comparison that failed.
  //
  // (An earlier note here said the lowercase form "matched nothing and this register was
  // always empty". That is not what the data shows; whatever emptied the register, it was
  // not the casing.)
  //
  // Note 'terminated' (501 rows) is deliberately still excluded — whether termination
  // belongs in the F&F pending register is a policy call, not a schema fix.
  clauses.push("LOWER(e.employment_status) IN ('resigned','separated')");
  // employees has no fnf_status. The F&F state lives on full_final_calculation,
  // reached through exit_request.
  clauses.push("COALESCE(ffc.status,'PENDING') NOT IN ('completed','settled')");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           e.date_of_exit,
           COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed, e.date_of_exit)
             AS last_working_day,
           e.employment_status,
           COALESCE(ffc.status,'PENDING') AS fnf_status,
           DATEDIFF(CURDATE(), COALESCE(e.date_of_exit, er.last_working_day_confirmed,
                                        er.last_working_day_proposed)) AS days_since_exit,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           b.branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employees e
      LEFT JOIN exit_request er            ON er.employee_id = e.id
      LEFT JOIN full_final_calculation ffc ON ffc.exit_request_id = er.id
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.id ASC`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
  } catch (err: unknown) {
    const mysqlCode = (err as Record<string, unknown>)?.["code"];
    if (mysqlCode === "ER_BAD_FIELD_ERROR" || mysqlCode === "ER_NO_SUCH_TABLE") {
      return { rows: [], rowCount: 0, isTruncated: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// fnf-settlement-register
// Actual table: full_final_calculation (011_exit_management.sql), joined via exit_request.
// ---------------------------------------------------------------------------
export async function fnfSettlementRegister(
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
  clauses.push("e.employment_status IN ('Exited','Separated','Resigned')");
  clauses.push("COALESCE(ffc.approved_at, e.date_of_exit) BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(ffc.approved_at, e.date_of_exit) AS settlement_date,
           NULL AS total_earnings,   -- full_final_calculation stores components, not a gross total
           NULL AS total_deductions, -- deriving one would be inventing payroll arithmetic
           COALESCE(ffc.net_payable, 0)       AS net_payable,
           COALESCE(ffc.status, 'pending')    AS payment_status,
           ffc.is_ff_provisional,
           LEFT(COALESCE(ffc.approved_at, e.date_of_exit), 7) AS settlement_month,
           b.branch_name, p.process_name
      FROM employees e
      LEFT JOIN exit_request er            ON er.employee_id = e.id
      LEFT JOIN full_final_calculation ffc ON ffc.exit_request_id = er.id
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
// Actual table: exit_clearance_checklist (011_exit_management.sql).
// One row per dept per exit — aggregate across depts for a summary view.
// ---------------------------------------------------------------------------
export async function clearanceStatusRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
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
           er.status AS exit_status,
           er.last_working_day_confirmed AS last_working_day,
           SUM(CASE WHEN ec.status = 'cleared' THEN 1 ELSE 0 END) AS depts_cleared,
           COUNT(ec.id) AS depts_total,
           MAX(CASE WHEN ec.status NOT IN ('cleared','waived') THEN ec.department ELSE NULL END) AS pending_dept,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           b.branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employees e
      LEFT JOIN exit_request er              ON er.employee_id = e.id
      LEFT JOIN exit_clearance_checklist ec  ON ec.exit_request_id = er.id
      LEFT JOIN branch_master b              ON b.id = e.branch_id
      LEFT JOIN process_master p             ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc     ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     -- ONLY_FULL_GROUP_BY: cost centre columns belong here as well as in the SELECT.
     GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name,
              er.status, er.last_working_day_confirmed, b.branch_name, p.process_name,
              sp_cc.cost_centre_code, sp_cc.cost_centre_name
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

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("COALESCE(e.date_of_exit, e.resignation_date) BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    SELECT LEFT(COALESCE(e.date_of_exit, e.resignation_date), 7) AS exit_month,
           b.branch_name,
           p.process_name,
           COUNT(*) AS attrition_count
      FROM employees e
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY exit_month, b.branch_name, p.process_name
     ORDER BY exit_month ASC, b.branch_name, p.process_name`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err: unknown) {
    const mysqlCode = (err as Record<string, unknown>)?.["code"];
    if (mysqlCode === "ER_BAD_FIELD_ERROR" || mysqlCode === "ER_NO_SUCH_TABLE") {
      return { rows: [], rowCount: 0, isTruncated: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// exit-reason-analysis  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function exitReasonAnalysis(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("COALESCE(e.date_of_exit, e.resignation_date) IS NOT NULL");

  const base = `
    -- employees carries no resignation_reason; the reason is recorded on exit_request.
    -- Only 2 exit_request rows exist against ~29k exited employees, so almost every row
    -- will read 'Not Specified' — that is the truth about the data, not a defect here.
    SELECT COALESCE(er.resignation_reason, er.exit_reason_category, 'Not Specified') AS exit_reason,
           COUNT(*) AS count,
           b.branch_name,
           p.process_name
      FROM employees e
      LEFT JOIN exit_request er  ON er.employee_id = e.id
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY exit_reason, b.branch_name, p.process_name
     ORDER BY count DESC, b.branch_name, p.process_name`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err: unknown) {
    const mysqlCode = (err as Record<string, unknown>)?.["code"];
    if (mysqlCode === "ER_BAD_FIELD_ERROR" || mysqlCode === "ER_NO_SUCH_TABLE") {
      return { rows: [], rowCount: 0, isTruncated: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// tenure-distribution  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function tenureDistribution(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
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

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.date_of_exit IS NOT NULL");
  clauses.push("DATEDIFF(e.date_of_exit, e.date_of_joining) <= 90");
  clauses.push("e.date_of_exit BETWEEN ? AND ?");
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
           e.date_of_exit AS date_of_exit,
           DATEDIFF(e.date_of_exit, e.date_of_joining) AS days_employed,
           -- see the note in exit-reason-analysis: the reason lives on exit_request
           COALESCE(er.resignation_reason, er.exit_reason_category) AS resignation_reason,
           b.branch_name, p.process_name
      FROM employees e
      LEFT JOIN exit_request er  ON er.employee_id = e.id
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
