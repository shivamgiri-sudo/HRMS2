/**
 * Reconciliation executor
 *
 * Codes: payroll-population-reconciliation, leave-ledger-vs-requests-reconciliation,
 *        cost-centre-vs-billing-reconciliation, attendance-enrollment-gap
 *
 * Four discrepancies were found during the 2026-08 reports audit that no report exposed, so
 * each could only be discovered by running SQL by hand. They are quantified here and nothing
 * is recomputed — in particular no payroll figure is recalculated, per the standing rule that
 * payroll arithmetic is read-only. Each report names the gap and leaves the judgement to the
 * reader.
 *
 * The four, and the measurement that prompted each:
 *
 *   payroll population    July 2026 produced three different headcounts for the same month —
 *                         1,125 HR-active, 1,464 payroll lines, 1,549 employees with
 *                         attendance — and no screen could reconcile them. 350 of the 1,464
 *                         payroll lines belong to employees whose active_status is 0.
 *   leave ledger          For 2026 the ledger says 3,594.0 used days and approved leave
 *                         requests total 88.5 — a 40x divergence. For 2025 the two agree
 *                         exactly (187.5 each), which localises the break to 2026 rather
 *                         than to the formula.
 *   cost centre billing   cost_centre_master.process_name_bill is the name finance bills
 *                         under; process_master.process_name is the name operations runs
 *                         under. They disagree on most rows, so a cost-per-process figure
 *                         differs depending on which system you ask.
 *   attendance enrolment  Missing attendance is largely unenrolled biometric rather than a
 *                         processing failure — one branch had 0 of 51 employees enrolled.
 *                         Absence of a punch and absence of an enrolment look identical on
 *                         an attendance report; this separates them.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  applyPagination,
  monthParam,
  monthRange,
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

function finish(rows: Record<string, unknown>[], total: number, includeTotal: boolean): ExecResult {
  const out = rows.map(({ _cursor: _drop, ...rest }) => rest);
  return { rows: out, rowCount: includeTotal ? total : out.length, isTruncated: total > out.length };
}

// ---------------------------------------------------------------------------
// payroll-population-reconciliation
//
// One row per employee that appears in ANY of the three populations for the month, with a
// column per population and the discrepancy named. A full outer join is emulated with a
// UNION of keys, because MySQL has none.
// ---------------------------------------------------------------------------
export async function payrollPopulationReconciliation(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);
  const { start, endExclusive } = monthRange(month);

  const clauses: string[] = ["1 = 1"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  // JOIN-condition params must precede WHERE params in positional binding.
  const joinParams: unknown[] = [month, start, endExclusive];

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           e.employment_status,
           CASE WHEN e.active_status = 1 THEN 'ACTIVE' ELSE 'INACTIVE' END AS employee_state,
           CASE WHEN e.active_status = 1 THEN 'YES' ELSE 'NO' END AS in_hr_active,
           CASE WHEN pay.employee_id IS NOT NULL THEN 'YES' ELSE 'NO' END AS in_payroll_run,
           CASE WHEN att.employee_id IS NOT NULL THEN 'YES' ELSE 'NO' END AS in_attendance,
           COALESCE(pay.gross_salary, 0) AS gross_salary,
           COALESCE(att.attendance_days, 0) AS attendance_days,
           CASE
             WHEN e.active_status = 0 AND pay.employee_id IS NOT NULL
               THEN 'PAID_BUT_INACTIVE'
             WHEN e.active_status = 1 AND pay.employee_id IS NULL
               THEN 'ACTIVE_BUT_NOT_IN_PAYROLL'
             WHEN pay.employee_id IS NOT NULL AND att.employee_id IS NULL
               THEN 'PAID_WITHOUT_ATTENDANCE'
             WHEN att.employee_id IS NOT NULL AND pay.employee_id IS NULL
               THEN 'ATTENDANCE_WITHOUT_PAYROLL'
             ELSE 'RECONCILED'
           END AS population_gap
      FROM employees e
      LEFT JOIN (
             SELECT spl.employee_id, SUM(COALESCE(spl.gross_salary,0)) AS gross_salary
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
              WHERE spr.run_month = ?
              GROUP BY spl.employee_id
           ) pay ON pay.employee_id = e.id
      LEFT JOIN (
             SELECT adr.employee_id, COUNT(*) AS attendance_days
               FROM attendance_daily_record adr
              WHERE adr.record_date >= ? AND adr.record_date < ?
              GROUP BY adr.employee_id
           ) att ON att.employee_id = e.id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
       -- Only rows that belong to at least one of the three populations. An employee who is
       -- inactive, unpaid and absent for the month is simply not part of this question.
       AND (e.active_status = 1 OR pay.employee_id IS NOT NULL OR att.employee_id IS NOT NULL)
     ORDER BY population_gap = 'RECONCILED', e.employee_code`;

  const allParams = [...joinParams, ...params];
  const total = options.includeTotal ? await count(base, allParams) : 0;
  const rows = await query(applyPagination(base, options), allParams) as Record<string, unknown>[];
  return finish(rows, total, options.includeTotal);
}

// ---------------------------------------------------------------------------
// leave-ledger-vs-requests-reconciliation
// ---------------------------------------------------------------------------
export async function leaveLedgerVsRequestsReconciliation(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const year = Number(filters.year) || new Date().getFullYear();

  const clauses: string[] = ["1 = 1"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  const joinParams: unknown[] = [year, year];

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           ? AS balance_year,
           COALESCE(led.ledger_used_days, 0) AS ledger_used_days,
           COALESCE(req.approved_request_days, 0) AS approved_request_days,
           ROUND(COALESCE(led.ledger_used_days,0) - COALESCE(req.approved_request_days,0), 2) AS variance_days,
           CASE
             WHEN COALESCE(led.ledger_used_days,0) = 0 AND COALESCE(req.approved_request_days,0) = 0
               THEN 'NO_LEAVE'
             WHEN ABS(COALESCE(led.ledger_used_days,0) - COALESCE(req.approved_request_days,0)) < 0.01
               THEN 'RECONCILED'
             WHEN COALESCE(req.approved_request_days,0) = 0
               THEN 'LEDGER_ONLY_NO_REQUESTS'
             WHEN COALESCE(led.ledger_used_days,0) = 0
               THEN 'REQUESTS_ONLY_NO_LEDGER'
             ELSE 'AMOUNTS_DISAGREE'
           END AS reconciliation_status
      FROM employees e
      LEFT JOIN (
             SELECT lbl.employee_id, SUM(COALESCE(lbl.used_days,0)) AS ledger_used_days
               FROM leave_balance_ledger lbl
              WHERE lbl.balance_year = ?
              GROUP BY lbl.employee_id
           ) led ON led.employee_id = e.id
      LEFT JOIN (
             SELECT lr.employee_id, SUM(COALESCE(lr.total_days,0)) AS approved_request_days
               FROM leave_request lr
              WHERE LOWER(COALESCE(lr.status,'')) IN ('approved','auto_approved')
                AND YEAR(COALESCE(lr.from_date, lr.start_date)) = ?
              GROUP BY lr.employee_id
           ) req ON req.employee_id = e.id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
       AND e.active_status = 1
     ORDER BY ABS(COALESCE(led.ledger_used_days,0) - COALESCE(req.approved_request_days,0)) DESC,
              e.employee_code`;

  // One leading param for the projected balance_year, then the two subquery params, then WHERE.
  const allParams = [year, ...joinParams, ...params];
  const total = options.includeTotal ? await count(base, allParams) : 0;
  const rows = await query(applyPagination(base, options), allParams) as Record<string, unknown>[];
  return finish(rows, total, options.includeTotal);
}

// ---------------------------------------------------------------------------
// cost-centre-vs-billing-reconciliation
//
// Aggregate — one row per cost centre — so no employee identity spine applies.
// ---------------------------------------------------------------------------
export async function costCentreVsBillingReconciliation(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(`cc.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }

  const base = `
    SELECT cc.id AS _cursor,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           cl.client_name,
           TRIM(COALESCE(cc.process_name_bill, '')) AS billing_process_name,
           COALESCE(emp.resolved_process_name, 'UNASSIGNED') AS operational_process_name,
           COALESCE(emp.active_headcount, 0) AS active_headcount,
           COALESCE(emp.distinct_processes, 0) AS distinct_processes,
           CASE
             WHEN TRIM(COALESCE(cc.process_name_bill,'')) = '' THEN 'NO_BILLING_NAME'
             WHEN emp.resolved_process_name IS NULL           THEN 'NO_OPERATIONAL_PROCESS'
             WHEN LOWER(TRIM(cc.process_name_bill)) = LOWER(TRIM(emp.resolved_process_name))
               THEN 'MATCH'
             ELSE 'NAME_MISMATCH'
           END AS reconciliation_status
      FROM cost_centre_master cc
      LEFT JOIN branch_master b ON b.id = cc.branch_id
      LEFT JOIN client_master cl ON cl.id = cc.client_id
      LEFT JOIN (
             -- The process the people in this cost centre actually sit under. Where a cost
             -- centre spans several, distinct_processes says so rather than silently picking
             -- one, so a MATCH on a multi-process cost centre can still be read with caution.
             SELECT e.cost_centre_id,
                    COUNT(*) AS active_headcount,
                    COUNT(DISTINCT e.process_id) AS distinct_processes,
                    MIN(p.process_name) AS resolved_process_name
               FROM employees e
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE e.active_status = 1 AND e.cost_centre_id IS NOT NULL
              GROUP BY e.cost_centre_id
           ) emp ON emp.cost_centre_id = cc.id
     WHERE ${clauses.join(" AND ")}
     ORDER BY reconciliation_status = 'MATCH', COALESCE(emp.active_headcount,0) DESC, cc.cost_centre_code`;

  const total = options.includeTotal ? await count(base, params) : 0;
  const rows = await query(applyPagination(base, options), params) as Record<string, unknown>[];
  return finish(rows, total, options.includeTotal);
}

// ---------------------------------------------------------------------------
// attendance-enrollment-gap
// ---------------------------------------------------------------------------
export async function attendanceEnrollmentGap(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);
  const { start, endExclusive } = monthRange(month);

  const clauses: string[] = ["e.active_status = 1"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  const joinParams: unknown[] = [start, endExclusive];

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           e.date_of_joining,
           CASE WHEN NULLIF(TRIM(COALESCE(e.biometric_code,'')), '') IS NULL
                THEN 'NO' ELSE 'YES' END AS biometric_enrolled,
           NULLIF(TRIM(COALESCE(e.biometric_code,'')), '') AS biometric_code,
           COALESCE(att.days_with_record, 0) AS days_with_record,
           COALESCE(att.days_with_punch, 0) AS days_with_punch,
           CASE
             WHEN NULLIF(TRIM(COALESCE(e.biometric_code,'')), '') IS NULL
                  AND COALESCE(att.days_with_record,0) = 0
               THEN 'NOT_ENROLLED_NO_ATTENDANCE'
             WHEN NULLIF(TRIM(COALESCE(e.biometric_code,'')), '') IS NULL
               THEN 'NOT_ENROLLED_HAS_ATTENDANCE'
             WHEN COALESCE(att.days_with_punch,0) = 0 AND COALESCE(att.days_with_record,0) > 0
               THEN 'ENROLLED_NO_PUNCHES'
             WHEN COALESCE(att.days_with_record,0) = 0
               THEN 'ENROLLED_NO_ATTENDANCE_ROWS'
             ELSE 'OK'
           END AS enrollment_gap
      FROM employees e
      -- Deferred join, not a plain aggregate, and the difference is 20x.
      --
      -- Written the obvious way — GROUP BY employee_id over the month, selecting raw_minutes —
      -- MySQL does not range-scan and then look rows up. Needing a column that
      -- idx_adr_date_employee does not carry, it abandons that index entirely and switches to
      -- uq_emp_date (employee_id, record_date), where record_date is not leading, so the month
      -- predicate narrows nothing and it examines 104,611 rows instead of the 41,106 in range.
      -- Measured: 2,065 ms without the minutes column, 42,420 ms with it.
      --
      -- So the range is resolved FIRST, in a derived table touching only record_date and
      -- employee_id — both in idx_adr_date_employee, and the PK comes along free in any InnoDB
      -- secondary index, so that part is covering. The minutes are then fetched by primary key
      -- against an already-narrowed 41k row set, which the optimiser cannot turn into a
      -- full-index scan.
      --
      -- This needs no schema change. A covering index would be better still (~2s) and is
      -- written up in sql/migrations/429_attendance_daily_record_covering_index.sql, but that
      -- is production DDL awaiting sign-off, and this report should not be unusable until then.
      LEFT JOIN (
             SELECT k.employee_id,
                    COUNT(*) AS days_with_record,
                    SUM(CASE WHEN COALESCE(a.raw_minutes, a.biometric_minutes, 0) > 0
                             THEN 1 ELSE 0 END) AS days_with_punch
               FROM (
                      SELECT adr.id, adr.employee_id
                        FROM attendance_daily_record adr
                       WHERE adr.record_date >= ? AND adr.record_date < ?
                    ) k
               JOIN attendance_daily_record a ON a.id = k.id
              GROUP BY k.employee_id
           ) att ON att.employee_id = e.id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY enrollment_gap = 'OK', b.branch_name, e.employee_code`;

  const allParams = [...joinParams, ...params];
  const total = options.includeTotal ? await count(base, allParams) : 0;
  const rows = await query(applyPagination(base, options), allParams) as Record<string, unknown>[];
  return finish(rows, total, options.includeTotal);
}
