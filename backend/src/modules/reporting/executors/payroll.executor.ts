/**
 * Payroll executor
 * Security classification: highly_restricted
 *
 * Covers codes: payroll-register, payroll-variance,
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
  fetchPageWithTotal,
} from "./types.js";
import {
  statusList,
  PRESENT_STATUSES,
  HALF_DAY_STATUS,
} from "../../../shared/attendanceStatus.js";
import { resolveAccountNumber } from "../../../shared/fieldEncryption.js";

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

/**
 * Payroll run statuses a report may read.
 *
 * 'draft' is excluded because a draft run has no calculated lines yet. Defined here and imported
 * by the high-risk router rather than declared in both, for the same reason the SELECTs are
 * shared: a status list that exists twice is a status list that will eventually differ, and the
 * two copies decide which payroll runs a report can see.
 */
export const PAYROLL_RUN_STATUSES = [
  "processing", "reviewed", "calculated", "approved",
  "locked", "disbursed", "finalized", "released", "paid",
] as const;

/**
 * payroll-variance and payslip-status SELECTs, shared with the high-risk router that serves the
 * screen — same reasoning as PAYROLL_REGISTER_BODY. Two separately maintained copies is what
 * made these two disagree; one copy cannot.
 *
 * payroll-variance: the screen's shape is authoritative here because the catalogue declares
 * exactly its eleven columns. The executor's own version returned a different set and, without
 * the run-month filter the screen applies, more than 5,000 rows — enough for the download to
 * refuse outright with TOO_LARGE while the screen showed 1,464.
 *
 * payslip-status: the catalogue declares NO columns for this code, so it cannot arbitrate, and
 * neither side was complete. The screen carried run_status and employee_code but no cost centre,
 * branch or process; the executor carried those three but not run_status or employee_code. The
 * union is used, which is also the only shape that satisfies the standing requirement that every
 * employee-grain report carry employee code, cost centre and process.
 *
 * The previous-month join in payroll-variance is the report: it self-joins salary_prep_run one
 * calendar month back, restricted to the same payroll statuses, so "previous_net" means the
 * prior run rather than whatever row happened to sort first. Its placeholders sit inside that
 * JOIN, ahead of the WHERE, which is why the caller prepends the status list to the parameters.
 */

/**
 * Shared by bank-advice and neft-transfer-file. These two payment files disagree about where an
 * employee's salary should go: bank-advice pays to employees.bank_account_number, neft-transfer
 * -file to employee_bank_detail (primary, active). Measured on the 2026-07 run across the 1,156
 * employees with a payable line — employees column present 1,121, bank_detail present 966, both
 * present and DIFFERENT 6, absent from both 35 — so the status column is how a payment run is
 * told which rows cannot safely be paid.
 *
 * Kept at module scope: they were briefly lost when the salary-sheet-onfido executor was removed
 * around them, and both remaining reports break without them.
 */
const ACCOUNT_SOURCE_JOIN = `
      LEFT JOIN employee_bank_detail acct_chk
             ON acct_chk.employee_id = e.id AND acct_chk.is_primary = 1 AND acct_chk.active_status = 1`;

const ACCOUNT_SOURCE_STATUS = `
           CASE
             WHEN (e.bank_account_number IS NULL OR e.bank_account_number = '')
              AND (acct_chk.account_number IS NULL OR acct_chk.account_number = '')
                  THEN 'MISSING'
             WHEN e.bank_account_number IS NOT NULL AND e.bank_account_number <> ''
              AND acct_chk.account_number IS NOT NULL AND acct_chk.account_number <> ''
              AND TRIM(e.bank_account_number) <> TRIM(acct_chk.account_number)
                  THEN 'CONFLICT'
             ELSE 'OK'
           END AS account_source_status`;

export const PAYROLL_VARIANCE_BODY = `
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(hcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(hcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(hpm.process_name, 'UNASSIGNED') AS process_name,
           spr.run_month,
           spl.net_salary AS current_net,
           prev.net_salary AS previous_net,
           ROUND(((spl.net_salary - COALESCE(prev.net_salary,0)) / NULLIF(prev.net_salary,0))*100,2) AS net_variance_pct,
           spl.lwp_days,
           CASE WHEN prev.id IS NULL THEN 'NO_PREVIOUS_MONTH'
                WHEN ABS(ROUND(((spl.net_salary - COALESCE(prev.net_salary,0)) / NULLIF(prev.net_salary,0))*100,2)) >= 20 THEN 'HIGH_VARIANCE'
                WHEN spl.net_salary < 0 THEN 'NEGATIVE_NET'
                ELSE 'OK' END AS variance_status
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN salary_prep_run pspr ON pspr.run_month = DATE_FORMAT(DATE_SUB(STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d'), INTERVAL 1 MONTH),'%Y-%m')
        AND LOWER(pspr.status) IN (__STATUS_PLACEHOLDERS__)
      LEFT JOIN salary_prep_line prev ON prev.run_id = pspr.id AND prev.employee_id = spl.employee_id
      LEFT JOIN cost_centre_master hcc ON hcc.id = e.cost_centre_id
      LEFT JOIN process_master hpm ON hpm.id = e.process_id`;

export const PAYSLIP_STATUS_BODY = `
    SELECT spr.run_month,
           spr.status AS run_status,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           sp.payslip_ref,
           sp.file_url,
           sp.acknowledged_at,
           CASE WHEN sp.id IS NULL THEN 'NOT_GENERATED'
                WHEN sp.acknowledged_at IS NULL THEN 'RELEASED_NOT_ACKNOWLEDGED'
                ELSE 'ACKNOWLEDGED' END AS payslip_status
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN salary_payslip sp ON sp.prep_line_id = spl.id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id`;

/**
 * The payroll register's SELECT and joins, shared by the executor below and by the high-risk
 * router that serves the screen.
 *
 * It is a shared constant rather than two copies because two copies is exactly what went wrong:
 * the screen showed run_status, net_mismatch_amount and payroll_risk while the download showed a
 * component breakdown plus employee_state, deduction_applied and line_flag, and neither side
 * carried the other's columns. Both were deliberately maintained — this is the one divergence in
 * the suite where the executor had NOT rotted — so the shapes are merged rather than one being
 * chosen over the other, and now they cannot drift apart again.
 *
 * The three diagnostics are the reason the merge goes this way rather than trimming the download
 * to match the screen. Measured on the 2026-07 run:
 *
 *   employee_state      1,464 lines, 350 of them for employees with active_status = 0. Without
 *                       it an exited employee is indistinguishable from a current one.
 *   deduction_applied   454 lines carry a 200 deduction against zero gross while net_salary
 *                       floors at 0, so SUM(total_deductions) overstates money actually
 *                       deducted by 38,800.
 *   line_flag           146 of those lines pay net_salary = 200 against zero gross and zero
 *                       attendance — 29,200 in total, every one an inactive employee.
 *
 * Column names follow the catalogue where the two sides disagreed: run_month (not
 * payroll_month) and net_salary (not net_pay).
 *
 * Payroll arithmetic is untouched. Verified against live mas_hrms: gross - total_deductions =
 * net_salary holds on every line where gross_salary > 0. Nothing here recomputes a figure; it
 * makes facts visible that a total taken from the register would otherwise flatten.
 */
export const PAYROLL_REGISTER_BODY = `
    SELECT spl.id AS _cursor,
           spr.run_month,
           spr.status AS run_status,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
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
           spl.net_salary,
           (COALESCE(spl.gross_salary,0) - COALESCE(spl.total_deductions,0) - COALESCE(spl.net_salary,0)) AS net_mismatch_amount,
           CASE WHEN COALESCE(spl.net_salary,0) < 0 THEN 'NEGATIVE_NET'
                WHEN ABS(COALESCE(spl.gross_salary,0) - COALESCE(spl.total_deductions,0) - COALESCE(spl.net_salary,0)) > 1 THEN 'NET_MISMATCH'
                ELSE 'OK' END AS payroll_risk,
           CASE
             WHEN COALESCE(spl.gross_salary,0) = 0 AND COALESCE(spl.net_salary,0) > 0
               THEN 'PAID_WITHOUT_GROSS'
             WHEN COALESCE(spl.gross_salary,0) = 0 THEN 'ZERO_GROSS'
             ELSE 'OK'
           END AS line_flag,
           spl.status AS line_status,
           COALESCE(spl.working_days,0) AS working_days,
           COALESCE(spl.present_days,0) AS present_days,
           COALESCE(spl.leave_days,0) AS leave_days,
           COALESCE(spl.final_payable_days, spl.working_days, 0) AS payable_days,
           COALESCE(spl.lwp_days,0) AS lwp_days
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN designation_master des ON des.id = e.designation_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id`;

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
  const base = `${PAYROLL_REGISTER_BODY}
     WHERE ${clauses.join(" AND ")}
     ORDER BY spl.id ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

/**
 * payroll-variance
 *
 * Uses PAYROLL_VARIANCE_BODY, shared with the high-risk router that serves the screen, so the
 * two cannot drift again.
 *
 * This executor previously ran its own query with no run-month restriction, so the download
 * gathered over 5,000 rows and refused with TOO_LARGE while the screen showed 1,464 for the
 * month. The catalogue declares exactly the screen's eleven columns, which is why the screen's
 * shape is the shared one.
 *
 * Bind order: the previous-month JOIN carries the payroll-status placeholders and sits ahead of
 * the WHERE, so the status list is prepended to the parameters.
 */
export async function payrollVariance(
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
  clauses.push(`LOWER(spr.status) IN (${PAYROLL_RUN_STATUSES.map(() => "?").join(",")})`);
  params.push(...PAYROLL_RUN_STATUSES);

  const body = PAYROLL_VARIANCE_BODY.replace(
    "__STATUS_PLACEHOLDERS__", PAYROLL_RUN_STATUSES.map(() => "?").join(","));
  const base = `${body}
     WHERE ${clauses.join(" AND ")}
     ORDER BY ABS(COALESCE(net_variance_pct,0)) DESC`;

  const all = [...PAYROLL_RUN_STATUSES, ...params];
  const total = options.includeTotal ? await count(base, all) : 0;
  const sql   = applyPagination(base, options);
  const rows  = await query(sql, all) as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length, nextCursor: null };
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

  // A bank advice is an instruction to pay. It had no run-status guard at all, so a run still in
  // draft — or one that had been cancelled — would produce a fully formed payable file complete
  // with account number, IFSC and amount. neft-transfer-file does the same job from the same run
  // and has always excluded those states; this brings the two into line rather than inventing a
  // rule. Verified on 2026-07, where the only run is 'processing': 1,464 rows and the same
  // 13,951,142.07 total before and after, so no current output moves. The guard is not
  // hypothetical though — 1,148 payroll lines sit in draft runs across other months, and opening
  // this report for one of those would have produced a fully payable file from an uncommitted
  // run.
  //
  // Two related defects are deliberately NOT changed here, because each needs a decision rather
  // than a guess, and both are recorded so they are not lost:
  //   - the two payment files read DIFFERENT account sources — this one
  //     employees.bank_account_number, neft-transfer-file employee_bank_detail. Seven employees
  //     in the 2026-07 run hold conflicting numbers between the two, so the same salary would
  //     reach a different account depending on which file the bank is given.
  //   - this report emits 308 rows with net_salary <= 0 that neft-transfer-file excludes. A zero
  //     value transfer instruction is meaningless, but quietly dropping 308 rows from a payment
  //     report is not a change to make unasked.
  clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("spl.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT spl.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           ${bankField},
           ${ifscField},
           ${bankName},
           ${ACCOUNT_SOURCE_STATUS},
           COALESCE(spl.net_salary,0) AS amount,
           spr.run_month
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
      LEFT JOIN department_master d ON d.id = e.department_id
      ${ACCOUNT_SOURCE_JOIN}
     WHERE ${clauses.join(" AND ")}
     ORDER BY spl.id ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
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
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
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

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
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
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
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

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
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
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           -- Cost centre, requested for the payroll cost summary. UNASSIGNED rather than NULL
           -- because 271 of 1,327 active employees carry no cost_centre_id (measured
           -- 2026-08-12), and a blank cell reads as a rendering fault where the label reads as
           -- a fact about those employees — which is what it is.
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
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
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     -- Grouped by cost centre as well, so the totals split by it rather than repeating a
     -- branch/process total against every cost centre in that group. employee_count and every
     -- SUM below move with this: the grain of the report changes, which is the point of the
     -- request, but it means these figures no longer match the pre-change output row-for-row.
     GROUP BY b.branch_name, p.process_name, d.dept_name, cc.cost_centre_code, cc.cost_centre_name, spr.run_month
     ORDER BY b.branch_name, p.process_name, d.dept_name, cc.cost_centre_code`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
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
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
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

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
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
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
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

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
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
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           ebd.bank_name,
           ebd.account_number_enc, ebd.account_number AS account_number_legacy,
           ebd.ifsc_code,
           ebd.account_holder_name,
           ebd.account_type,
           ${ACCOUNT_SOURCE_STATUS},
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
      ${ACCOUNT_SOURCE_JOIN}
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name,
              b.branch_name, p.process_name, ebd.bank_name, ebd.account_number_enc,
              ebd.account_number, ebd.ifsc_code, ebd.account_holder_name, ebd.account_type,
              spr.run_month, sp_cc.cost_centre_code, sp_cc.cost_centre_name,
              e.bank_account_number, acct_chk.account_number
     ORDER BY ebd.bank_name, employee_name`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const sql   = applyPagination(base, options);
  const rawRows = await query(sql, params) as Record<string, unknown>[];
  const rows = rawRows.map((r: any) => ({
    ...r,
    account_number: resolveAccountNumber({ account_number_enc: r.account_number_enc, account_number: r.account_number_legacy }),
  }));
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

/**
 * payslip-status
 *
 * Uses PAYSLIP_STATUS_BODY, shared with the high-risk router that serves the screen.
 *
 * The catalogue declares no columns for this code, so it could not arbitrate between the two
 * shapes, and neither was complete: the screen had run_status and employee_code but no cost
 * centre, branch or process; this executor had those three but neither run_status nor
 * employee_code. The shared body is the union, which is also the only shape that satisfies the
 * standing requirement for employee code, cost centre and process on an employee-grain report.
 */
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

  const base = `${PAYSLIP_STATUS_BODY}
     WHERE ${clauses.join(" AND ")}
     ORDER BY payslip_status DESC, employee_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length, nextCursor: null };
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
      ebd.account_number_enc AS ac_no_enc,
      ebd.account_number AS ac_no_legacy,
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

  // Resolve encrypted account numbers before building output rows
  lineRows.forEach((r: any) => {
    r.ac_no = resolveAccountNumber({ account_number_enc: r.ac_no_enc, account_number: r.ac_no_legacy }) ?? "";
  });

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
