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
import { resolvePayrollMonth } from "../payroll-month.js";
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
  const runMonth = await resolvePayrollMonth(filters.month);

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
  //      attendance — 29,200 in total, every one an inactive employee — which line_flag
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
  const currentMonth = await resolvePayrollMonth(filters.month);

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
  const runMonth = await resolvePayrollMonth(filters.month);

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
           -- salary_prep_line has no other_allowances column, so this threw "Unknown column
           -- 'spl.other_allowances'" and the whole sheet 500'd. Verified on the live July 2026
           -- run that gross decomposes exactly into the three named components — 1,464 of 1,464
           -- lines, total residual 0.00 — so there is no missing earnings bucket to recover and
           -- the honest value is a structural zero. Kept as a column rather than dropped so the
           -- sheet's earnings block still balances visibly against gross.
           0 AS other_allowances,
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
           -- Second missing arrear column on this table (see arrearPaymentRegister below):
           -- salary_prep_line records no arrears at all. Arrears live only in
           -- legacy_payslip_snapshot.arrear, which is a different grain and a different run,
           -- so joining it into a current-month sheet would attribute a legacy payment to this
           -- month. Structural zero, same treatment as other_allowances above.
           0 AS arrear_amount
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
  const runMonth = await resolvePayrollMonth(filters.month);

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
  // This used to be optional — omit the month and get every payroll month at once. That was
  // the default, because the report library opens a tile with no parameters, and it was both
  // unusable and close to meaningless:
  //
  //   126s to answer, joining all 80,338 payroll lines and ordering by a computed variance, so
  //   neither narrowing nor pagination can help;
  //
  //   and attendance only exists from 2026-06-13 while salary_prep_run spans 65 months back to
  //   2021-03, so the large majority of those rows reported NO_ATTENDANCE_DATA. True, and not a
  //   finding — this report compares attendance against payroll, and for 63 of 65 months there
  //   is no attendance to compare.
  //
  // It now defaults to the latest month that has payroll, like every other payroll report. A
  // caller who wants a different month still passes one and gets exactly that month.
  const runMonth = await resolvePayrollMonth(filters.month);
  const attParams: unknown[] = [];
  let attWhere = "";
  clauses.push("spr.run_month = ?");
  params.push(runMonth);

  // Pin the attendance aggregate to the same month.
  //
  // Only rows whose ym equals spr.run_month can survive the join, so restricting the
  // subquery cannot change a single output row — verified by checksumming the full 1,464-row
  // output for 2026-07 both ways, not by comparing row counts.
  //
  // On the speed claim, which is smaller and more qualified than it first looked:
  //
  //   direct SQL, alternating runs, pinned first so any warm-cache advantage favours the
  //   OLD shape:  62.8s unrestricted vs 16.3s pinned, median of four pairs — 3.9x.
  //
  //   through the endpoint, alternating against a build without this change: 16.4s vs 16.0s.
  //   No measurable difference. MySQL 8 can push `spr.run_month = ?` into the derived table
  //   on its own through the `att.ym = spr.run_month` equality, and when it picks that plan
  //   this predicate is redundant. It is kept because the optimiser does not always pick it —
  //   the direct-SQL pair above is the same statement without the LIMIT, and there it did not.
  //
  // Two earlier numbers for this change were wrong and are recorded here so they are not
  // quoted again: a "6.9x" came from running the unrestricted query first and the pinned one
  // second, so the second read a warm buffer pool; and a "120s to 7.2s" endpoint figure was
  // measured against a backend another session had started from the main tree, which did not
  // contain this change at all. The database also swings badly under concurrent load — the
  // same statement measured 43s to 82s across four rounds — so single-run timings here are
  // not evidence of anything.
  //
  // Half-open range against the raw column so the predicate is sargable and can use
  // idx_adr_emp_date. A LEFT() or DATE_FORMAT() wrapper would not be — that is precisely
  // why the GROUP BY below is the expensive half of this query (EXPLAIN: type=ALL,
  // key=null, Using temporary) and why it is worth not feeding it the whole table.
  attWhere = "WHERE adr.record_date >= ? AND adr.record_date < DATE_ADD(?, INTERVAL 1 MONTH)";
  attParams.push(`${runMonth}-01`, `${runMonth}-01`);

  // This query used to return branch/process/month financial totals: employee_count,
  // total_gross, total_net and so on. Its catalog entry describes something else
  // entirely — "Reconciliation between attendance inputs and payroll outputs", one row
  // per employee per month, keyed on employee_code — and declares ten columns
  // (attendance_present_days, payroll_payable_days, day_variance, reconciliation_status,
  // ...) of which the query produced NOT ONE. The grid maps catalog keys onto row keys,
  // so this report rendered ten empty columns for every row.
  //
  // Restored to what it says it is. The branch/process totals it used to return are not
  // lost: payroll-cost-summary produces exactly that shape, so nothing is duplicated here.
  //
  // The reconciliation is worth having on its own terms. Against live 2026-07 it
  // immediately surfaces employees with 27 attendance days against 9 payroll payable
  // days — the attendance and payroll populations for a month do not agree (1,549
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
         ${attWhere}
         GROUP BY adr.employee_id, LEFT(adr.record_date, 7)
      ) att ON att.employee_id = spl.employee_id AND att.ym = spr.run_month
     WHERE ${clauses.join(" AND ")}
     ORDER BY ABS(COALESCE(spl.final_payable_days, spl.working_days, 0)
                  - COALESCE(att.present_days, 0)) DESC, spl.id ASC`;

  // The att subquery's placeholders sit inside the JOIN, ahead of the WHERE, and MySQL binds
  // positionally — so they lead the list. Appending them would hand the date range whatever
  // the scope filter contributed and silently shift every later value by one.
  params.unshift(...attParams);

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
  // This read salary_prep_line for arrear_month / arrear_amount / arrear_reason. None of the
  // three exists on that table — it has 58 columns and not one mentions arrears — so the
  // report 500'd with "Unknown column 'spl.arrear_month'" every time it was opened.
  //
  // Arrears are recorded in legacy_payslip_snapshot.arrear, the only arrear column anywhere in
  // mas_hrms. It holds real data: 20 rows carry a non-zero arrear, ₹13,590.47 in total, out of
  // 135,365 payslip rows. Repointed there rather than blocked, since the data exists and the
  // report is answerable — the amount is a recorded fact and nothing here recomputes it.
  //
  // Note the grain changes with the source: one row per legacy payslip (employee × pay_month),
  // not per current-run salary line, which is what an arrears register wants anyway.
  // LEFT JOIN, and no `e.id IS NOT NULL` requirement: 5 of the 20 arrear rows carry an
  // employee_id that resolves to no employees row. An inner join would drop a quarter of the
  // register without saying so, which is the failure mode this audit exists to remove. The
  // payslip's own employee_code and name are used as the fallback so those rows still appear.
  const clauses: string[] = ["1 = 1"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("COALESCE(lps.arrear, 0) <> 0");

  if (filters.month) {
    clauses.push("lps.pay_month = ?");
    params.push(monthParam(filters.month));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("lps.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT lps.id AS _cursor,
           COALESCE(e.employee_code, lps.employee_code) AS employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,'')),
                    NULLIF(lps.employee_name,''), 'UNRESOLVED') AS employee_name,
           CASE WHEN e.id IS NULL THEN 'NOT_IN_EMPLOYEE_MASTER' ELSE 'RESOLVED' END AS employee_link_status,
           b.branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           d.dept_name AS department_name,
           lps.pay_month AS arrear_month,
           COALESCE(lps.arrear, 0) AS arrear_amount,
           lps.pay_month AS payment_month,
           COALESCE(lps.gross_salary, 0) AS gross_salary,
           COALESCE(lps.net_salary, 0) AS net_pay
      FROM legacy_payslip_snapshot lps
      LEFT JOIN employees e ON e.id = lps.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
      LEFT JOIN department_master d ON d.id = e.department_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY lps.id ASC`;

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
  const runMonth = await resolvePayrollMonth(filters.month);

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

// ---------------------------------------------------------------------------
// lwp-deduction-register
//
// Folded in from an inline `case` block. Behaviour preserved: one row per employee per
// run month where lwp_days > 0, MAX() over the line values because an employee can hold
// more than one line in a run. Gains cost centre.
// ---------------------------------------------------------------------------
export async function lwpDeductionRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = await resolvePayrollMonth(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);
  clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");
  clauses.push("spl.lwp_days > 0");

  const base = `
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           b.branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           spr.run_month,
           MAX(spl.lwp_days) AS lwp_days,
           MAX(spl.lwp_deduction) AS lwp_deduction_amount,
           MAX(spl.gross_salary) AS gross_salary,
           MAX(spl.net_salary) AS net_salary
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     -- ONLY_FULL_GROUP_BY: cost centre columns belong here as well as in the SELECT.
     GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, spr.run_month,
              b.branch_name, p.process_name, sp_cc.cost_centre_code, sp_cc.cost_centre_name
     ORDER BY lwp_days DESC`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// neft-transfer-file
//
// Folded in from an inline `case` block, behaviour preserved.
//
// CAST(ebd.account_number AS CHAR) is load-bearing and must stay: the column is varbinary,
// so without the cast it reaches JSON as a Buffer and the account number is unusable in
// the payout file. Account numbers are also deliberately NOT masked here — this is the
// file a bank is paid from, and a masked account number would make it worthless. The
// report is highly_restricted and gated on exportRoles instead, which is the right
// control for a payout instruction.
// ---------------------------------------------------------------------------
export async function neftTransferFile(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = await resolvePayrollMonth(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);
  clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");
  clauses.push("spl.net_salary > 0");

  const base = `
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           b.branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           ebd.bank_name,
           CAST(ebd.account_number AS CHAR) AS account_number,
           ebd.ifsc_code,
           ebd.account_holder_name,
           ebd.account_type,
           MAX(spl.net_salary) AS transfer_amount,
           spr.run_month
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
      LEFT JOIN employee_bank_detail ebd
             ON ebd.employee_id = e.id AND ebd.is_primary = 1 AND ebd.active_status = 1
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name,
              b.branch_name, p.process_name, ebd.bank_name, ebd.account_number,
              ebd.ifsc_code, ebd.account_holder_name, ebd.account_type, spr.run_month,
              sp_cc.cost_centre_code, sp_cc.cost_centre_name
     ORDER BY ebd.bank_name, employee_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// payslip-status
//
// Folded in from an inline `case` block, behaviour preserved. One row per payroll line
// with the payslip's generation and acknowledgement state; a NULL salary_payslip row means
// NOT_GENERATED, which is the state this report exists to surface. Gains cost centre,
// process and branch — a payslip chase-list is worked branch by branch.
// ---------------------------------------------------------------------------
export async function payslipStatus(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = await resolvePayrollMonth(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);

  const base = `
    SELECT spr.run_month,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           b.branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           sp.payslip_ref,
           sp.file_url,
           sp.acknowledged_at,
           CASE
             WHEN sp.id IS NULL THEN 'NOT_GENERATED'
             WHEN sp.acknowledged_at IS NULL THEN 'RELEASED_NOT_ACKNOWLEDGED'
             ELSE 'ACKNOWLEDGED'
           END AS payslip_status
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN salary_payslip sp ON sp.prep_line_id = spl.id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY payslip_status DESC, employee_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, params) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

// ---------------------------------------------------------------------------
// salary-sheet-export
//
// The last of the inline `case` blocks in report-suite.routes.ts, and the only one that
// was not a mechanical move: it ran a line query, then a second query for component
// amounts, then assembled a bespoke ~100-column payload in JS and returned its own
// response. That shape is preserved here in full; every column and alias is unchanged, so
// an existing consumer sees the same workbook.
//
// One behaviour DOES change, deliberately. The inline version ignored limit and offset and
// always returned every row, on preview as well as export. Through the executor layer it
// obeys the standard options, so the on-screen preview now pages like every other report
// while the export path keeps its full allowance. That also makes the component lookup
// cheaper: it resolves components only for the lines actually returned, not the whole run.
//
// The original block recorded that e.cost_center_code, e.department, e.designation and
// e.uan do not exist on employees and that the master-table joins are the only real source.
// That is still true, and those joins are kept.
// ---------------------------------------------------------------------------
export async function salarySheetExport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const runMonth = await resolvePayrollMonth(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("spr.run_month = ?");
  params.push(runMonth);
  clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");

  const base = `
    SELECT
      e.employee_code,
      CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS emp_name,
      COALESCE(cc.cost_centre_code, '') AS cost_center_code,
      COALESCE(cc.cost_centre_name, '') AS cost_center,
      COALESCE(dept.dept_name, '') AS department,
      COALESCE(desig.designation_name, '') AS designation,
      COALESCE(e.profile_type, '') AS profile,
      CASE WHEN COALESCE(e.is_billable, 1) = 1 THEN 'InHouse' ELSE 'Non-Billable' END AS employee_for,
      CASE WHEN COALESCE(e.is_billable, 1) = 1 THEN 'Yes' ELSE 'No' END AS billable,
      COALESCE(b.branch_name, '') AS branch,
      COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
      spl.id AS line_id,
      spl.employee_id,
      COALESCE(spl.basic, 0) AS basic,
      COALESCE(spl.hra, 0) AS hra,
      COALESCE(spl.special_allowance, 0) AS special_allowance,
      COALESCE(spl.gross_salary, 0) AS gross,
      COALESCE(spl.working_days, 0) AS working_days,
      COALESCE(esa.ctc_annual, 0) AS ctc_offered,
      COALESCE(esa.ctc_annual, 0) AS current_ctc,
      COALESCE(spl.active_calendar_days, 30) AS actual_days,
      COALESCE(spl.final_payable_days, spl.present_days, 0) AS earned_days,
      COALESCE(spl.holiday_work_extra_payout, 0) AS extra_day,
      COALESCE(spl.leave_days, 0) AS leave_days,
      CASE WHEN COALESCE(spl.esic_employee, 0) > 0 THEN 'Yes' ELSE 'No' END AS esi_elig,
      CASE WHEN COALESCE(spl.pf_employee, 0) > 0 THEN 'Yes' ELSE 'No' END AS pf_elig,
      COALESCE(spl.esic_employee, 0) AS esic,
      COALESCE(spl.pf_employee, 0) AS epf,
      COALESCE(spl.tds_amount, spl.tds, 0) AS income_tax,
      COALESCE(spl.advance_recovery, 0) AS adv_paid,
      COALESCE(spl.loan_emi, 0) AS loan_ded,
      COALESCE(spl.professional_tax, 0) AS pro_tax_deduction,
      COALESCE(spl.lwp_deduction, 0) AS leave_deduction,
      COALESCE(spl.other_deductions, 0) AS other_deduction,
      COALESCE(spl.total_deductions, 0) AS total_deduction,
      COALESCE(spl.incentive_total, 0) AS incentive,
      COALESCE(spl.overtime_pay, 0) AS extra_day_incentive,
      COALESCE(spl.net_salary, 0) AS net_salary,
      COALESCE(spl.esic_employer, 0) AS esic_company,
      COALESCE(spl.pf_employer, 0) AS epf_company,
      0 AS admin_chrg,
      COALESCE(esa.ctc_annual, 0) AS ctc,
      spr.id AS run_id,
      DATE_FORMAT(spr.created_at, '%Y-%m-%d') AS sal_date,
      COALESCE(eu.uan, '') AS uan,
      COALESCE(e.epf_number, eu.member_id, '') AS epf_no,
      COALESCE(e.esic_number, '') AS esic_no,
      COALESCE(e.employment_status, 'Active') AS left_status,
      'Bank Transfer' AS salary_payment_mode,
      COALESCE(CAST(ebd.account_number AS CHAR), '') AS ac_no,
      COALESCE(ebd.ifsc_code, '') AS ifsc_code,
      COALESCE(ebd.bank_name, '') AS ac_bank,
      COALESCE(ebd.bank_branch, '') AS ac_branch
    FROM salary_prep_line spl
    JOIN salary_prep_run spr ON spr.id = spl.run_id
    JOIN employees e ON e.id = spl.employee_id
    LEFT JOIN department_master dept ON dept.id = e.department_id
    LEFT JOIN designation_master desig ON desig.id = e.designation_id
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
    LEFT JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
    LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = e.id AND ebd.is_primary = 1 AND ebd.active_status = 1
    LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
    WHERE ${clauses.join(" AND ")}
    ORDER BY e.employee_code`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql = applyPagination(base, options);
  const lineRows = await query(sql, params) as Record<string, unknown>[];
  if (lineRows.length === 0) {
    return { rows: [], rowCount: options.includeTotal ? total : 0, isTruncated: false };
  }

  // Component amounts for exactly the lines being returned.
  const lineIds = lineRows.map(r => r.line_id);
  const compRows = await query(
    `SELECT line_id, component_code, amount
       FROM salary_prep_line_component
      WHERE line_id IN (${lineIds.map(() => "?").join(",")})`,
    lineIds
  ) as Record<string, unknown>[];

  const compMap = new Map<string, Record<string, number>>();
  for (const c of compRows) {
    const key = String(c.line_id);
    if (!compMap.has(key)) compMap.set(key, {});
    compMap.get(key)![String(c.component_code)] = Number(c.amount);
  }

  const rows = lineRows.map((row, idx) => {
    const comp = compMap.get(String(row.line_id)) ?? {};
    const basic = Number(row.basic) || comp["BASIC"] || 0;
    const hra = Number(row.hra) || comp["HRA"] || 0;
    const bonus = comp["BONUS"] || 0;
    const conv = comp["CONV"] || comp["TA"] || 0;
    const portfolio = comp["PORTFOLIO"] || 0;
    const medAllw = comp["MA"] || 0;
    const lta = comp["LTA"] || 0;
    const special = Number(row.special_allowance) || comp["SPECIAL"] || comp["PA"] || 0;
    const otherAllw = comp["OTHER"] || 0;
    const pli1 = comp["PLI"] || 0;
    const gross = Number(row.gross)
      || (basic + hra + bonus + conv + portfolio + medAllw + lta + special + otherAllw + pli1);

    const earnedDays = Number(row.earned_days) || 0;
    const workingDays = Number(row.working_days) || 1;
    const earnRatio = earnedDays / workingDays;
    const incomeTax = Number(row.income_tax);

    return {
      sno: (options.offset ?? 0) + idx + 1,
      emp_code: row.employee_code,
      emp_name: row.emp_name,
      cost_center_code: row.cost_center_code,
      cost_center: row.cost_center,
      department: row.department,
      designation: row.designation,
      process_name: row.process_name,
      profile: row.profile,
      employee_for: row.employee_for,
      billable: row.billable,
      branch: row.branch,
      basic, hra, bonus, conv, portfolio,
      medical_allowance: medAllw,
      lta, special_allowance: special,
      other_allowance: otherAllw,
      pli1, gross,
      working_days: row.working_days,
      ctc_offered: row.ctc_offered,
      current_ctc: row.current_ctc,
      actual_days: row.actual_days,
      earned_days: earnedDays,
      extra_day: row.extra_day,
      leave: row.leave_days,
      basic1: Math.round(basic * earnRatio),
      hra1: Math.round(hra * earnRatio),
      bonus1: Math.round(bonus * earnRatio),
      conv1: Math.round(conv * earnRatio),
      portfolio1: Math.round(portfolio * earnRatio),
      special_allowance1: Math.round(special * earnRatio),
      other_allowance1: Math.round(otherAllw * earnRatio),
      medical_allowance1: Math.round(medAllw * earnRatio),
      gross1: Math.round(gross * earnRatio),
      esi_elig: row.esi_elig,
      pf_elig: row.pf_elig,
      esic: row.esic,
      epf: row.epf,
      income_tax: row.income_tax,
      adv_taken: 0,
      adv_paid: row.adv_paid,
      loan_taken: 0,
      loan_ded: row.loan_ded,
      mobile_deduction: comp["MOB_DED"] || 0,
      short_collection: comp["SHORT_COLL"] || 0,
      asset_recovery: comp["ASSET_REC"] || 0,
      insurance: comp["INSURANCE"] || 0,
      pro_tax_deduction: row.pro_tax_deduction,
      leave_deduction: row.leave_deduction,
      other_deduction: row.other_deduction,
      other_deduction_remarks: "",
      total_deduction: row.total_deduction,
      incentive: row.incentive,
      extra_day_incentive: row.extra_day_incentive,
      arrear: comp["ARREAR"] || 0,
      pli: comp["PLI"] || 0,
      net_salary: row.net_salary,
      esic_company: row.esic_company,
      epf_company: row.epf_company,
      admin_chrg: row.admin_chrg,
      ctc: row.ctc,
      shsh: String(row.run_id ?? "").slice(-8).toUpperCase(),
      sal_date: row.sal_date,
      uan: row.uan,
      epf_no: row.epf_no,
      esic_no: row.esic_no,
      cheque_number: "",
      cheque_date: "",
      print_date: new Date().toISOString().slice(0, 10),
      left_status: row.left_status,
      tax_total_gross: gross * 12,
      tax_section10: 0,
      tax_balance: 0,
      tax_under_hd: 0,
      deduction_under24: 0,
      tax_gross_total: gross * 12,
      tax_agg_chapter6: 0,
      total_income: gross * 12,
      tax_on_total_income: incomeTax * 12,
      edu_cess: Math.round(incomeTax * 12 * 0.04),
      tax_pay_edu_cess: Math.round(incomeTax * 12 * 1.04),
      tax_deducted_till_prev_month: 0,
      balance_tax: 0,
      salary_payment_mode: row.salary_payment_mode,
      ac_no: row.ac_no,
      ifsc_code: row.ifsc_code,
      ac_bank: row.ac_bank,
      ac_branch: row.ac_branch,
    };
  });

  return {
    rows,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > rows.length : rows.length === options.limit,
  };
}
