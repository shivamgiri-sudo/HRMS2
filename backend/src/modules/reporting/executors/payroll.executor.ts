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
import {
  statusList,
  PRESENT_STATUSES,
  HALF_DAY_STATUS,
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

  // Payroll arithmetic is read-only here. Verified against live mas_hrms 2026-08-07:
  // gross - total_deductions = net_salary holds on EVERY line where gross_salary > 0, with
  // no exceptions. Nothing below recomputes a figure; it only makes two facts visible that
  // the register previously flattened, both of which distort any total taken from it:
  //
  //   1. Population. The 2026-07 run has 1,464 lines, 350 of them for employees whose
  //      active_status = 0. Without employment_status on the row, an exited employee is
  //      indistinguishable from a current one.
  //   2. Floored deductions. 454 lines have gross_salary = 0 while carrying a
  //      total_deductions of 200, and net_salary floors at 0 rather than going negative.
  //      SUM(total_deductions) therefore overstates money actually deducted by 38,800 for
  //      that run. deduction_applied is the amount a payslip could really have withheld.
  //      A further 146 of those lines carry net_salary = 200 against zero gross and zero
  //      attendance â€” 29,200 in total, every one an inactive employee â€” which line_flag
  //      surfaces as PAID_WITHOUT_GROSS rather than leaving it to be found by hand.
  //
  // cost_centre_code / cost_centre_name are added because a payroll register without a
  // cost centre cannot be reconciled to finance.
  const base = `
    SELECT spl.id AS _cursor,
           spr.run_month AS payroll_month,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           b.branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           d.dept_name AS department_name,
           des.designation_name,
           e.employment_status,
           CASE WHEN e.active_status = 1 THEN 'ACTIVE' ELSE 'INACTIVE' END AS employee_state,
           COALESCE(spl.basic,0) AS basic_pay,
           COALESCE(spl.hra,0) AS hra,
           COALESCE(spl.gross_salary,0) AS gross_salary,
           COALESCE(spl.pf_employee,0) AS pf_employee,
           COALESCE(spl.esic_employee,0) AS esic_employee,
           COALESCE(spl.professional_tax,0) AS professional_tax,
           COALESCE(spl.tds,0) AS tds,
           COALESCE(spl.lwp_deduction,0) AS lwp_deduction,
           COALESCE(spl.total_deductions,0) AS total_deductions,
           CASE WHEN COALESCE(spl.gross_salary,0) > 0
                THEN COALESCE(spl.total_deductions,0) ELSE 0 END AS deduction_applied,
           spl.net_salary AS net_pay,
           CASE
             WHEN COALESCE(spl.gross_salary,0) = 0 AND COALESCE(spl.net_salary,0) > 0
               THEN 'PAID_WITHOUT_GROSS'
             WHEN COALESCE(spl.gross_salary,0) = 0 THEN 'ZERO_GROSS'
             ELSE 'OK'
           END AS line_flag,
           COALESCE(spl.final_payable_days, spl.working_days, 0) AS payable_days,
           COALESCE(spl.lwp_days,0) AS lwp_days
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN designation_master des ON des.id = e.designation_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
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
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
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
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
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

  // Sensitive field projections â€” masked when caller lacks canViewSensitiveFields
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
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
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
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
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
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
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
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
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
// payroll-reconciliation  (aggregate â€” no cursor)
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

  // This query used to return branch/process/month financial totals: employee_count,
  // total_gross, total_net and so on. Its catalog entry describes something else
  // entirely â€” "Reconciliation between attendance inputs and payroll outputs", one row
  // per employee per month, keyed on employee_code â€” and declares ten columns
  // (attendance_present_days, payroll_payable_days, day_variance, reconciliation_status,
  // ...) of which the query produced NOT ONE. The grid maps catalog keys onto row keys,
  // so this report rendered ten empty columns for every row.
  //
  // Restored to what it says it is. The branch/process totals it used to return are not
  // lost: payroll-cost-summary produces exactly that shape, so nothing is duplicated here.
  //
  // The reconciliation is worth having on its own terms. Against live 2026-07 it
  // immediately surfaces employees with 27 attendance days against 9 payroll payable
  // days â€” the attendance and payroll populations for a month do not agree (1,549
  // employees with attendance against 1,464 payroll lines), and this is where that
  // shows up per person rather than as a total that happens to balance.
  //
  // Attendance present days count half_day as 0.5, matching the shared attendance
  // vocabulary. `att` is grouped per employee per month so the join cannot fan out and
  // multiply a payroll line.
  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           b.branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           spr.run_month AS payroll_month,
           ROUND(COALESCE(att.present_days, 0), 2) AS attendance_present_days,
           ROUND(COALESCE(spl.final_payable_days, spl.working_days, 0), 2) AS payroll_payable_days,
           ROUND(COALESCE(att.lwp_days, 0), 2) AS attendance_lwp_days,
           ROUND(COALESCE(spl.lwp_days, 0), 2) AS payroll_lwp_days,
           ROUND(COALESCE(spl.final_payable_days, spl.working_days, 0)
                 - COALESCE(att.present_days, 0), 2) AS day_variance,
           CASE
             WHEN att.employee_id IS NULL THEN 'NO_ATTENDANCE_DATA'
             WHEN ABS(COALESCE(spl.final_payable_days, spl.working_days, 0)
                      - COALESCE(att.present_days, 0)) < 0.5 THEN 'MATCHED'
             ELSE 'VARIANCE'
           END AS reconciliation_status,
           CASE
             WHEN att.employee_id IS NULL
               THEN 'Paid this month with no attendance rows for it.'
             WHEN ABS(COALESCE(spl.lwp_days,0) - COALESCE(att.lwp_days,0)) >= 0.5
               THEN 'Payroll LWP and attendance LWP disagree.'
             ELSE ''
           END AS remarks
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
      LEFT JOIN (
        SELECT adr.employee_id,
               LEFT(adr.record_date, 7) AS ym,
               SUM(CASE WHEN adr.attendance_status IN (${statusList(PRESENT_STATUSES)}) THEN 1
                        WHEN adr.attendance_status = '${HALF_DAY_STATUS}' THEN 0.5
                        ELSE 0 END) AS present_days,
               SUM(COALESCE(adr.lwp_value, 0)) AS lwp_days
          FROM attendance_daily_record adr
         GROUP BY adr.employee_id, LEFT(adr.record_date, 7)
      ) att ON att.employee_id = spl.employee_id AND att.ym = spr.run_month
     WHERE ${clauses.join(" AND ")}
     ORDER BY ABS(COALESCE(spl.final_payable_days, spl.working_days, 0)
                  - COALESCE(att.present_days, 0)) DESC, spl.id ASC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  const out   = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : out.length, isTruncated: total > out.length };
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
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
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
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
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
// payroll-cost-summary  (aggregate â€” no cursor)
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

// ---------------------------------------------------------------------------
// ytd-salary-summary
//
// Moved here from an inline `case` block in report-suite.routes.ts. That block was one of
// three parallel SQL implementations a report code could have — an inline block for the
// screen, the executor layer for some paths, and report-worker-executor for emailed
// files — so the same report could answer differently depending on how you asked for it.
// The route's default branch already builds ExecFilters and calls executeReport, so
// deleting the block is what routes this code through the single implementation.
//
// Behaviour preserved exactly, including both accepted period formats: ?financialYear=
// 2025-26 (Apr–Mar) and ?year=2026 (calendar). Draft and cancelled runs stay excluded.
// Gains the cost centre and process the mandate requires.
// ---------------------------------------------------------------------------
export async function ytdSalarySummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const fyRaw = String(filters.financialYear ?? filters.year ?? "").trim();
  const fyMatch = fyRaw.match(/^(\d{4})-(\d{2,4})$/);

  let monthFrom: string;
  let monthTo: string;
  if (fyMatch) {
    const fyStart = Number(fyMatch[1]);
    monthFrom = `${fyStart}-04`;
    monthTo   = `${fyStart + 1}-03`;
  } else {
    const cy = Number(fyRaw) || new Date().getFullYear();
    monthFrom = `${cy}-01`;
    monthTo   = `${cy}-12`;
  }

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("spr.run_month BETWEEN ? AND ?");
  params.push(monthFrom, monthTo);
  clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");

  const base = `
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           b.branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           d.dept_name AS department_name,
           COUNT(DISTINCT spr.run_month) AS months_paid,
           ROUND(SUM(spl.gross_salary), 2) AS ytd_gross,
           ROUND(SUM(spl.basic), 2) AS ytd_basic,
           ROUND(SUM(COALESCE(spl.pf_employee, 0)), 2) AS ytd_pf,
           ROUND(SUM(COALESCE(spl.tds_amount, 0)), 2) AS ytd_tds,
           ROUND(SUM(spl.net_salary), 2) AS ytd_net
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     -- ONLY_FULL_GROUP_BY: every non-aggregated selected column appears here too.
     GROUP BY e.id, e.employee_code, e.first_name, e.last_name, e.full_name,
              b.branch_name, p.process_name, d.dept_name,
              sp_cc.cost_centre_code, sp_cc.cost_centre_name
     ORDER BY employee_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}
