/**
 * Payroll executor
 * Security classification: highly_restricted
 *
 * Covers codes: payroll-register, payroll-variance, salary-sheet-onfido,
 * bank-advice, payroll-reconciliation, arrear-payment-register, payroll-cost-summary
 *
 * Sensitive fields (pan_number, uan_number, bank_account_number) are masked to
 * '***MASKED***' when scope.canViewSensitiveFields is false.
 *
 * Every query includes WHERE e.company_id = :companyId to enforce tenant isolation.
 * (For the current single-tenant deployment company_id = '1' everywhere; the guard
 * prevents a future misconfiguration from leaking cross-tenant data.)
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
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
// payroll-register
// ---------------------------------------------------------------------------
export async function payrollRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = monthParam(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           spr.run_month AS payroll_month,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name,
           p.process_name,
           d.dept_name AS department_name,
           des.designation_name,
           COALESCE(spl.basic,0) AS basic_pay,
           COALESCE(spl.hra,0) AS hra,
           COALESCE(spl.gross_salary,0) AS gross_salary,
           COALESCE(spl.pf_employee,0) AS pf_employee,
           COALESCE(spl.esic_employee,0) AS esic_employee,
           COALESCE(spl.professional_tax,0) AS professional_tax,
           COALESCE(spl.tds,0) AS tds,
           COALESCE(spl.lwp_deduction,0) AS lwp_deduction,
           COALESCE(spl.total_deductions,0) AS total_deductions,
           spl.net_salary AS net_pay,
           COALESCE(spl.final_payable_days, spl.working_days, 0) AS payable_days,
           COALESCE(spl.lwp_days,0) AS lwp_days
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN designation_master des ON des.id = e.designation_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY spl.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// payroll-variance
// ---------------------------------------------------------------------------
export async function payrollVariance(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const currentMonth = monthParam(filters.month);

  // Resolve previous month: use explicit filter or subtract one calendar month
  let previousMonth: string;
  if (typeof filters.previousMonth === "string" && /^\d{4}-\d{2}$/.test(filters.previousMonth)) {
    previousMonth = filters.previousMonth;
  } else {
    const [y, m] = currentMonth.split("-").map(Number);
    const prevDate = new Date(y, m - 2, 1); // JS months 0-indexed; m-2 yields prior month
    previousMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  }

  // JOIN ON params must precede WHERE params in positional binding
  const joinParams: unknown[] = [currentMonth, previousMonth];
  const clauses: string[] = ["e.id IS NOT NULL"];
  const whereParams: unknown[] = [];
  appendScopeConditions(scope, clauses, whereParams);
  appendFilterConditions(filters, clauses, whereParams);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("curr.id > ?");
    whereParams.push(options.cursor);
  }

  const params = [...joinParams, ...whereParams];

  const base = `
    SELECT curr.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name,
           p.process_name,
           d.dept_name AS department_name,
           curr_run.run_month,
           COALESCE(curr.gross_salary,0) AS current_gross,
           COALESCE(prev.gross_salary,0) AS previous_gross,
           COALESCE(curr.gross_salary,0) - COALESCE(prev.gross_salary,0) AS variance_gross,
           COALESCE(curr.net_salary,0) AS current_net,
           COALESCE(prev.net_salary,0) AS previous_net,
           COALESCE(curr.net_salary,0) - COALESCE(prev.net_salary,0) AS variance_net,
           CASE
             WHEN ABS(COALESCE(curr.net_salary,0) - COALESCE(prev.net_salary,0)) > 5000 THEN 'HIGH_VARIANCE'
             WHEN ABS(COALESCE(curr.net_salary,0) - COALESCE(prev.net_salary,0)) > 1000 THEN 'MEDIUM_VARIANCE'
             ELSE 'NORMAL'
           END AS variance_flag
      FROM salary_prep_line curr
      JOIN salary_prep_run curr_run ON curr_run.id = curr.run_id AND curr_run.run_month = ?
      LEFT JOIN salary_prep_line prev ON prev.employee_id = curr.employee_id
      LEFT JOIN salary_prep_run prev_run ON prev_run.id = prev.run_id AND prev_run.run_month = ?
      JOIN employees e ON e.id = curr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY curr.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// salary-sheet-onfido
// ---------------------------------------------------------------------------
export async function salarySheetOnfido(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = monthParam(filters.month);

  // Sensitive field projections — masked when caller lacks canViewSensitiveFields
  const panField  = scope.canViewSensitiveFields ? "e.pan_number"          : "'***MASKED***' AS pan_number";
  const uanField  = scope.canViewSensitiveFields ? "e.uan_number"          : "'***MASKED***' AS uan_number";
  const bankField = scope.canViewSensitiveFields ? "e.bank_account_number" : "'***MASKED***' AS bank_account_number";

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           spr.run_month AS payroll_month,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name,
           p.process_name,
           d.dept_name AS department_name,
           des.designation_name,
           ${panField},
           ${uanField},
           ${bankField},
           COALESCE(spl.basic,0) AS basic_pay,
           COALESCE(spl.hra,0) AS hra,
           COALESCE(spl.special_allowance,0) AS special_allowance,
           COALESCE(spl.other_allowances,0) AS other_allowances,
           COALESCE(spl.gross_salary,0) AS gross_salary,
           COALESCE(spl.pf_employee,0) AS pf_employee,
           COALESCE(spl.esic_employee,0) AS esic_employee,
           COALESCE(spl.professional_tax,0) AS professional_tax,
           COALESCE(spl.tds,0) AS tds,
           COALESCE(spl.lwp_deduction,0) AS lwp_deduction,
           COALESCE(spl.advance_recovery,0) AS advance_recovery,
           COALESCE(spl.other_deductions,0) AS other_deductions,
           COALESCE(spl.total_deductions,0) AS total_deductions,
           spl.net_salary AS net_pay,
           COALESCE(spl.final_payable_days, spl.working_days, 0) AS payable_days,
           COALESCE(spl.lwp_days,0) AS lwp_days,
           COALESCE(spl.arrear_amount,0) AS arrear_amount
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN designation_master des ON des.id = e.designation_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY spl.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// bank-advice
// ---------------------------------------------------------------------------
export async function bankAdvice(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = monthParam(filters.month);

  // Bank fields are always present but masked when caller lacks canViewSensitiveFields
  const bankField = scope.canViewSensitiveFields ? "e.bank_account_number" : "'***MASKED***' AS bank_account_number";
  const ifscField = scope.canViewSensitiveFields ? "e.ifsc_code"           : "'***MASKED***' AS ifsc_code";
  const bankName  = scope.canViewSensitiveFields ? "e.bank_name"           : "'***MASKED***' AS bank_name";

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name,
           p.process_name,
           ${bankField},
           ${ifscField},
           ${bankName},
           COALESCE(spl.net_salary,0) AS amount,
           spr.run_month
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY spl.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// payroll-reconciliation  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function payrollReconciliation(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  // Month is optional: omit to get multi-month view; supply to pin to one period
  if (filters.month) {
    const runMonth = monthParam(filters.month);
    clauses.push("spr.run_month = ?");
    params.push(runMonth);
  }

  const base = `
    SELECT b.branch_name,
           p.process_name,
           spr.run_month,
           COUNT(*) AS employee_count,
           SUM(COALESCE(spl.gross_salary,0)) AS total_gross,
           SUM(COALESCE(spl.total_deductions,0)) AS total_deductions,
           SUM(COALESCE(spl.net_salary,0)) AS total_net,
           SUM(COALESCE(spl.pf_employee,0)) AS total_pf_employee,
           SUM(COALESCE(spl.esic_employee,0)) AS total_esic_employee,
           SUM(COALESCE(spl.tds,0)) AS total_tds,
           SUM(COALESCE(spl.lwp_deduction,0)) AS total_lwp_deduction
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY b.branch_name, p.process_name, spr.run_month
     ORDER BY spr.run_month DESC, b.branch_name, p.process_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// arrear-payment-register
// ---------------------------------------------------------------------------
export async function arrearPaymentRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  // Only rows that carry an arrear component
  clauses.push("COALESCE(spl.arrear_amount, 0) > 0");

  if (filters.month) {
    const runMonth = monthParam(filters.month);
    clauses.push("spr.run_month = ?");
    params.push(runMonth);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           b.branch_name,
           p.process_name,
           d.dept_name AS department_name,
           COALESCE(spl.arrear_month, spr.run_month) AS arrear_month,
           COALESCE(spl.arrear_amount,0) AS arrear_amount,
           spr.run_month AS payment_month,
           COALESCE(spl.arrear_reason, '') AS reason,
           COALESCE(spl.net_salary,0) AS net_pay
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY spl.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// payroll-cost-summary  (aggregate — no cursor)
// ---------------------------------------------------------------------------
export async function payrollCostSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = monthParam(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);

  const base = `
    SELECT b.branch_name,
           p.process_name,
           d.dept_name AS department_name,
           spr.run_month,
           COUNT(*) AS employee_count,
           SUM(COALESCE(spl.gross_salary,0)) AS total_gross,
           SUM(COALESCE(spl.pf_employer,0)) AS total_pf_employer,
           SUM(COALESCE(spl.esic_employer,0)) AS total_esic_employer,
           SUM(COALESCE(spl.gross_salary,0))
             + SUM(COALESCE(spl.pf_employer,0))
             + SUM(COALESCE(spl.esic_employer,0)) AS total_ctc,
           SUM(COALESCE(spl.net_salary,0)) AS total_net
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY b.branch_name, p.process_name, d.dept_name, spr.run_month
     ORDER BY b.branch_name, p.process_name, d.dept_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}
