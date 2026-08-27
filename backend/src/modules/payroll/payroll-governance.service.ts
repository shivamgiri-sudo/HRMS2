import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getPolicyValue } from "../policy-engine/policy-engine.cache.js";

export type PayrollReadinessSeverity = "blocker" | "warning";

/**
 * Layered readiness domains (2026-08-13). A payroll month can be "calculation
 * technically available" (source_data/attendance_payable_days/employee_master/
 * bank/statutory clear) while simultaneously NOT READY FOR PAYMENT (variable_pay/
 * recovery/full_and_final/payment_file still open) — that distinction must stay
 * visible to callers, not get collapsed into one percentage.
 */
export type PayrollReadinessCategory =
  | "source_data"
  | "employee_master"
  | "attendance_payable_days"
  | "bank"
  | "statutory"
  | "variable_pay"
  | "reimbursement"
  | "recovery_deduction"
  | "full_and_final"
  | "payment_file";

export interface PayrollReadinessIssue {
  code: string;
  severity: PayrollReadinessSeverity;
  category: PayrollReadinessCategory;
  count: number;
  message: string;
  sample?: Array<Record<string, unknown>>;
}

function monthRange(runMonth: string) {
  if (!/^\d{4}-\d{2}$/.test(runMonth)) throw new Error("Invalid run_month format");
  const [year, month] = runMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${runMonth}-01`,
    end: `${runMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

function todayIstDate() {
  const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return nowIst.toISOString().slice(0, 10);
}

function readinessEndDate(monthEnd: string) {
  const today = todayIstDate();
  if (today <= monthEnd) {
    const yesterday = new Date(`${today}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const completedDate = yesterday.toISOString().slice(0, 10);
    return completedDate < monthEnd ? completedDate : monthEnd;
  }
  return monthEnd;
}

async function getRun(runId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1`,
    [runId],
  );
  const run = rows[0] as any;
  if (!run) throw new Error("Payroll run not found");
  return run;
}

async function runHasPrepLines(runId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM salary_prep_line WHERE run_id = ?`,
    [runId],
  );
  return Number((rows[0] as any)?.count ?? 0) > 0;
}

function runEmployeeScopeSql(run: any, restrictToRunLines = false) {
  const clauses = [
    "e.active_status = 1",
    "LOWER(COALESCE(e.employment_status, 'active')) = 'active'",
    "(COALESCE(e.salary_start_date, e.date_of_joining) IS NULL OR COALESCE(e.salary_start_date, e.date_of_joining) <= ?)",
    "(COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date) IS NULL OR COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date) >= ?)",
  ];
  const params: unknown[] = [];
  const range = monthRange(run.run_month);
  params.push(range.end, range.start);

  if (run.branch_id) { clauses.push("e.branch_id = ?"); params.push(run.branch_id); }
  if (run.process_id) { clauses.push("e.process_id = ?"); params.push(run.process_id); }
  if (run.branch_filter) {
    clauses.push("e.branch_id IN (SELECT id FROM branch_master WHERE branch_name = ?)");
    params.push(run.branch_filter);
  }
  if (run.process_filter) {
    clauses.push("e.process_id IN (SELECT id FROM process_master WHERE process_name = ?)");
    params.push(run.process_filter);
  }
  if (restrictToRunLines) {
    clauses.push("EXISTS (SELECT 1 FROM salary_prep_line spl_scope WHERE spl_scope.run_id = ? AND spl_scope.employee_id = e.id)");
    params.push(run.id);
  }

  return { where: clauses.join(" AND "), params, range };
}

/**
 * Indian financial year containing `runMonth`, formatted as the tax tables store
 * it — "2026-27" for April 2026 through March 2027.
 *
 * Same derivation as payrollCalculate.service.ts, kept identical on purpose: if
 * the two disagree, this check would clear a year the calculation then refuses.
 */
export function financialYearForMonth(runMonth: string): string {
  const [year, month] = runMonth.split("-").map(Number);
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

/** The financial year after the one containing `runMonth`. */
export function nextFinancialYear(runMonth: string): string {
  const startYear = Number(financialYearForMonth(runMonth).slice(0, 4)) + 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

/**
 * First month of the ESI contribution period containing `runMonth`.
 *
 * The Act runs two fixed periods a year — April to September and October to March
 * — and coverage, once it attaches, holds to the end of the one it attached in.
 * A period is therefore not "the last six months": for January the period began
 * the previous October, which is why the year rolls back.
 */
export function esiContributionPeriodStart(runMonth: string): string {
  const [year, month] = runMonth.split("-").map(Number);
  if (month >= 4 && month <= 9) return `${year}-04`;
  if (month >= 10) return `${year}-10`;
  return `${year - 1}-10`; // Jan-Mar belongs to the period that opened last October
}

async function countIssue(sql: string, params: unknown[], code: string, severity: PayrollReadinessSeverity, message: string, category: PayrollReadinessCategory): Promise<PayrollReadinessIssue | null> {
  // Use db.query (text protocol) instead of db.execute (prepared statements) to avoid
  // "Incorrect arguments to mysqld_stmt_execute" when ? placeholders appear inside subqueries.
  const [countRows] = await (db as any).query(`SELECT COUNT(*) AS count FROM (${sql}) issue_rows`, params) as [RowDataPacket[], unknown];
  const count = Number((countRows as any)[0]?.count ?? 0);
  if (count === 0) return null;
  const [sample] = await (db as any).query(`${sql} LIMIT 10`, params) as [RowDataPacket[], unknown];
  return { code, severity, category, count, message, sample: sample as Array<Record<string, unknown>> };
}

/**
 * Wraps a single readiness check so a query/schema failure in ONE check (e.g. a
 * table that doesn't exist yet in an older environment) cannot silently resolve
 * to "no issue" and cannot abort every OTHER check via a rejected Promise.all.
 *
 * Fail-closed by construction: an exception becomes a blocker CHECK_ERROR, never
 * a pass. "Missing evidence is not green." Used for the five newer categories
 * (variable_pay/recovery_deduction/full_and_final/payment_file) whose source
 * tables were only mapped in this audit and are less battle-tested than the
 * original attendance/statutory checks above.
 */
async function checkedIssue(
  category: PayrollReadinessCategory,
  code: string,
  fn: () => Promise<PayrollReadinessIssue | null>,
): Promise<PayrollReadinessIssue | null> {
  try {
    return await fn();
  } catch (err) {
    return {
      code: `${code}_CHECK_ERROR`,
      severity: "blocker",
      category,
      count: 1,
      message: `Readiness check ${code} failed to execute (${err instanceof Error ? err.message : String(err)}). Treated as a blocker: a check that could not run is not evidence the underlying condition is clear.`,
    };
  }
}

function monthCalendarSql() {
  return `
    SELECT DATE_ADD(?, INTERVAL n DAY) AS record_date
      FROM (
        SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
        UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
        UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14
        UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19
        UNION ALL SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24
        UNION ALL SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29
        UNION ALL SELECT 30
      ) days
     WHERE n <= DATEDIFF(?, ?)`;
}

export const payrollGovernanceService = {
  async readiness(runId: string) {
    const run = await getRun(runId);
    const { where, params, range } = runEmployeeScopeSql(run, await runHasPrepLines(run.id));
    const effectiveEnd = readinessEndDate(range.end);
    const issues: PayrollReadinessIssue[] = [];

    // M+2 gate: final calculation is only allowed from a configured day of the
    // following month. It exists so night-shift attendance from the last working day
    // of the month has crossed over and been captured before payroll is sealed.
    //
    // The day was hardcoded to the 2nd, which set the floor for the whole disbursal
    // calendar: nothing can be paid earlier than this no matter how fast attendance
    // closes. It is now policy `payroll/readiness/earliest_calc_day_of_next_month`,
    // defaulting to "2" so behaviour is identical until someone deliberately changes
    // it. Only the timing moves — no payroll figure is computed differently.
    //
    // Lowering it trades safety for speed: night-shift days that cross midnight on
    // the last of the month may not be captured yet, so anyone setting 1 should know
    // they are choosing to seal payroll before that data lands.
    const today = todayIstDate();
    const [runYear, runMonthNum] = run.run_month.split("-").map(Number);
    const nextMonthYear  = runMonthNum === 12 ? runYear + 1 : runYear;
    const nextMonthNum   = runMonthNum === 12 ? 1 : runMonthNum + 1;
    const configuredDay = Number(
      await getPolicyValue("payroll", "readiness", "earliest_calc_day_of_next_month", "2"),
    );
    // A malformed or out-of-range value must not silently open the gate on the 1st or
    // push it into the middle of the month; refuse it and stand on the default.
    const earliestCalcDay = Number.isFinite(configuredDay) && configuredDay >= 1 && configuredDay <= 28
      ? Math.trunc(configuredDay)
      : 2;
    const earliestCalcDate = `${nextMonthYear}-${String(nextMonthNum).padStart(2, "0")}-${String(earliestCalcDay).padStart(2, "0")}`;
    if (today < earliestCalcDate) {
      issues.push({
        code: "MONTH_NOT_CLOSED",
        severity: "blocker",
        category: "source_data",
        count: 1,
        message: `Payroll for ${run.run_month} cannot be calculated before ${earliestCalcDate}. Final calculation is allowed from M+2 to ensure night-shift attendance is fully captured.`,
      });
    }

    // Tax configuration for the years this run needs, and the one after it.
    //
    // taxEngineService refuses when payroll_tax_fy_config / payroll_tax_slab_master
    // hold no row for a financial year, rather than falling back to hardcoded slabs
    // — a stale rate under-deducts, and the shortfall is the employer's liability.
    // Refusing is right, but discovering it during the first run of a new financial
    // year is not: the rates come from the Finance Act each February, and nobody is
    // reminded. This surfaces the gap while there is still time to act on it.
    //
    // Severity follows tds_mode, because the engine only runs when the mode is
    // 'auto' (payrollCalculate.service.ts). All 66 production runs are 'manual', so
    // a missing year does not currently break anything — but switching a run to
    // auto without the config would, so it is still worth saying.
    const [fyRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT financial_year FROM payroll_tax_fy_config WHERE active_status = 1`,
    );
    const seededFys = new Set((fyRows as Array<{ financial_year: string }>).map((r) => r.financial_year));
    const runFy = financialYearForMonth(run.run_month);
    const tdsMode = String((run as { tds_mode?: string }).tds_mode ?? "manual");

    if (!seededFys.has(runFy)) {
      issues.push({
        code: "TAX_CONFIG_MISSING_FOR_RUN_FY",
        severity: tdsMode === "auto" ? "blocker" : "warning",
        category: "statutory",
        count: 1,
        message:
          `No approved tax configuration for financial year ${runFy}. ` +
          (tdsMode === "auto"
            ? "This run is in auto TDS mode, so calculation will refuse until payroll_tax_fy_config and payroll_tax_slab_master are seeded for that year."
            : "This run is in manual TDS mode so it is unaffected, but switching it to auto would fail until payroll_tax_fy_config and payroll_tax_slab_master are seeded for that year."),
      });
    }

    // Lead time for the next year, raised only from January so it does not nag for
    // nine months. January to March is the last quarter of the financial year, and
    // the Budget lands in February — so the rates exist by the time this fires.
    const upcomingFy = nextFinancialYear(run.run_month);
    if (runMonthNum >= 1 && runMonthNum <= 3 && !seededFys.has(upcomingFy)) {
      issues.push({
        code: "TAX_CONFIG_MISSING_FOR_NEXT_FY",
        severity: "warning",
        category: "statutory",
        count: 1,
        message:
          `Financial year ${upcomingFy} begins on ${upcomingFy.slice(0, 4)}-04-01 and has no approved tax configuration yet. ` +
          `Seed payroll_tax_fy_config and payroll_tax_slab_master from the current Finance Act before the first payroll run of that year.`,
      });
    }

    const eligibleSql = `
      SELECT e.id, e.employee_code,
             COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name
        FROM employees e
       WHERE ${where}`;
    const calendarSql = monthCalendarSql();

    const checks: Array<Promise<PayrollReadinessIssue | null>> = [
      countIssue(
        `${eligibleSql}
          AND NOT EXISTS (
            SELECT 1 FROM employee_salary_assignment esa
             WHERE esa.employee_id = e.id
               AND esa.active_status = 1
               AND esa.effective_from <= ?
               AND (esa.effective_to IS NULL OR esa.effective_to >= ?)
          )`,
        [...params, range.end, range.start],
        "MISSING_SALARY_ASSIGNMENT",
        "blocker",
        "Employees missing active salary assignment for the payroll month",
        "employee_master",
      ),
      countIssue(
        `${eligibleSql}
          AND NOT EXISTS (
            SELECT 1 FROM employee_bank_detail ebd
             WHERE ebd.employee_id = e.id
               AND ebd.active_status = 1
               AND ebd.is_primary = 1
               AND COALESCE(ebd.verified, 0) = 1
          )`,
        params,
        "MISSING_VERIFIED_BANK",
        // Promoted to blocker: an unresolved missing bank prevents bank advice
        // generation. Previously this was a warning, meaning calculation proceeded
        // and the employee appeared in unpayableRows at export time — no active
        // gate. Blocking calculation ensures HR/Finance resolve it before the run
        // reaches disbursement, not at the moment someone clicks "generate NEFT".
        "blocker",
        "Employees missing verified primary bank account — resolve via bank-exception-report before disbursement",
        "bank",
      ),
      countIssue(
        `${eligibleSql}
          AND NOT EXISTS (
            SELECT 1 FROM attendance_daily_record adr
             WHERE adr.employee_id = e.id
               AND adr.record_date BETWEEN ? AND ?
          )`,
        [...params, range.start, effectiveEnd],
        "NO_ATTENDANCE_RECORDS",
        "blocker",
        "Employees missing attendance_daily_record rows for the payroll month",
        "attendance_payable_days",
      ),
      countIssue(
        `SELECT e.id, e.employee_code,
                COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
                GROUP_CONCAT(DATE_FORMAT(cal.record_date, '%Y-%m-%d') ORDER BY cal.record_date SEPARATOR ', ') AS missing_dates
           FROM employees e
           JOIN (${calendarSql}) cal
             ON cal.record_date BETWEEN COALESCE(e.salary_start_date, e.date_of_joining, ?)
                                    AND COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date, ?)
          WHERE ${where}
            AND NOT EXISTS (
              SELECT 1 FROM attendance_daily_record adr
               WHERE adr.employee_id = e.id
                 AND adr.record_date = cal.record_date
            )
          GROUP BY e.id, e.employee_code, employee_name`,
        [range.start, effectiveEnd, range.start, range.start, effectiveEnd, ...params],
        "PARTIAL_ATTENDANCE_DAYS_MISSING",
        "blocker",
        "Eligible employees have one or more missing attendance_daily_record dates in the payroll month",
        "attendance_payable_days",
      ),
      countIssue(
        `SELECT e.id, e.employee_code,
                COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
                DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
                adr.attendance_status,
                GREATEST(COALESCE(ibd.biometric_minutes, 0), COALESCE(was.total_login_minutes, 0)) AS biometric_minutes
           FROM employees e
           JOIN attendance_daily_record adr
             ON adr.employee_id = e.id
           LEFT JOIN integration_biometric_daily ibd
             ON ibd.employee_code = e.employee_code
            AND ibd.activity_date = adr.record_date
           LEFT JOIN wfm_attendance_session was
             ON was.employee_id = e.id
            AND was.session_date = adr.record_date
          WHERE ${where}
            AND adr.record_date BETWEEN ? AND ?
            AND adr.attendance_status = 'missing_punch'
            AND GREATEST(COALESCE(ibd.biometric_minutes, 0), COALESCE(was.total_login_minutes, 0)) > 0`,
        [...params, range.start, effectiveEnd],
        "MISSING_PUNCH_WITH_BIOMETRIC_EVIDENCE",
        "blocker",
        "Attendance is marked missing_punch even though biometric evidence has usable minutes",
        "attendance_payable_days",
      ),
      countIssue(
        `SELECT e.id, e.employee_code,
                COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
                DATE_FORMAT(apr_days.report_date, '%Y-%m-%d') AS record_date,
                apr_days.apr_minutes
           FROM employees e
           JOIN (
             SELECT UserID, ReportDate AS report_date, ROUND(SUM(TIME_TO_SEC(Net_Login)) / 60) AS apr_minutes
               FROM apr
              WHERE ReportDate BETWEEN ? AND ?
              GROUP BY UserID, ReportDate
           ) apr_days
             ON apr_days.UserID = e.employee_code
          WHERE ${where}
            AND NOT EXISTS (
              SELECT 1 FROM attendance_daily_record adr
               WHERE adr.employee_id = e.id
                 AND adr.record_date = apr_days.report_date
            )`,
        [range.start, effectiveEnd, ...params],
        "APR_MISSING_ATTENDANCE_DAILY_RECORD",
        "blocker",
        "APR source rows exist but attendance_daily_record is missing for the employee/date",
        "attendance_payable_days",
      ),
      countIssue(
        `SELECT e.id, e.employee_code,
                COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
                DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
                apr_days.apr_minutes,
                adr.raw_minutes,
                adr.dialler_minutes,
                adr.attendance_status,
                adr.source_system
           FROM employees e
           JOIN (
             SELECT UserID, ReportDate AS report_date, ROUND(SUM(TIME_TO_SEC(Net_Login)) / 60) AS apr_minutes
               FROM apr
              WHERE ReportDate BETWEEN ? AND ?
              GROUP BY UserID, ReportDate
           ) apr_days
             ON apr_days.UserID = e.employee_code
           JOIN attendance_daily_record adr
             ON adr.employee_id = e.id
            AND adr.record_date = apr_days.report_date
          WHERE ${where}
            AND adr.attendance_source = 'dialler'
            AND COALESCE(adr.is_locked, 0) = 0
            AND adr.override_by IS NULL
            AND adr.regularization_id IS NULL
            AND (
              ABS(COALESCE(adr.raw_minutes, 0) - apr_days.apr_minutes) > 1
              OR adr.source_system <> 'apr.ReportDate'
            )`,
        [range.start, effectiveEnd, ...params],
        "APR_ATTENDANCE_DAILY_RECORD_MISMATCH",
        "blocker",
        "APR source minutes/source do not match unlocked attendance_daily_record rows",
        "attendance_payable_days",
      ),
      countIssue(
        `SELECT e.id, e.employee_code,
                COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
                DATE_FORMAT(ar.session_date, '%Y-%m-%d') AS record_date,
                ar.id AS regularization_id
           FROM employees e
           JOIN attendance_regularization ar
             ON ar.employee_id = e.id
            AND ar.status = 'approved'
            AND ar.session_date BETWEEN ? AND ?
          WHERE ${where}
            AND NOT EXISTS (
              SELECT 1 FROM attendance_daily_record adr
               WHERE adr.employee_id = ar.employee_id
                 AND adr.record_date = ar.session_date
                 AND adr.regularization_id = ar.id
                 AND adr.is_locked = 1
            )`,
        [range.start, effectiveEnd, ...params],
        "APPROVED_REGULARIZATION_MISSING_ADR",
        "blocker",
        "Approved attendance regularization is missing from locked attendance_daily_record",
        "attendance_payable_days",
      ),
      // Root-caused 2026-08-13: apr-payroll-reconciliation.service.ts (the only
      // writer of this issue_type) has zero callers anywhere in the reachable
      // codebase — no route, no worker. Its 455 unresolved July rows were all
      // detected in one 90-minute manual invocation on 2026-07-25 against a run
      // id that no longer exists in salary_prep_run (deleted/superseded since),
      // while every OTHER issue_type in this table has a real daily 2am refresh
      // (attendance-reconciliation.worker.ts) that keeps resolving/re-detecting.
      // Without the `runId` match below, this check counts phantom blockers tied
      // to a run nobody can act on. Binding to the run actually being evaluated
      // means: (a) truly stale rows (wrong/deleted run) stop blocking calculation
      // for the live run, and (b) a genuine mismatch detected against THIS run
      // still blocks, exactly as before, if the reconciliation job is ever rerun.
      // This does not touch attendance_daily_record, salary_prep_line or any
      // payroll figure — it only changes which pre-existing rows this gate reads.
      countIssue(
        `SELECT e.id, e.employee_code,
                COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
                DATE_FORMAT(ari.issue_date, '%Y-%m-%d') AS issue_date,
                ari.source_payload_json
           FROM employees e
           JOIN attendance_reconciliation_issue ari
             ON ari.employee_id = e.id
            AND ari.issue_date BETWEEN ? AND ?
            AND ari.issue_type = 'salary_payable_days_mismatch'
            AND ari.resolved_at IS NULL
            AND JSON_UNQUOTE(JSON_EXTRACT(ari.source_payload_json, '$.runId')) = ?
          WHERE ${where}`,
        [range.start, effectiveEnd, run.id, ...params],
        "SALARY_PAYABLE_DAYS_MISMATCH",
        "blocker",
        "Salary prep final payable days do not match recomputed attendance_daily_record payable days for THIS run",
        "attendance_payable_days",
      ),
      countIssue(
        `${eligibleSql}
          AND EXISTS (
            SELECT 1 FROM attendance_daily_record adr
             WHERE adr.employee_id = e.id
               AND adr.record_date BETWEEN ? AND ?
               AND adr.attendance_status = 'unreconciled'
          )`,
        [...params, range.start, effectiveEnd],
        "UNRECONCILED_ATTENDANCE",
        "blocker",
        "Employees with unreconciled attendance in payroll month",
        "attendance_payable_days",
      ),
      countIssue(
        `${eligibleSql}
          AND EXISTS (
            SELECT 1 FROM attendance_daily_record adr
             WHERE adr.employee_id = e.id
               AND adr.record_date BETWEEN ? AND ?
               AND adr.is_locked = 0
          )`,
        [...params, range.start, effectiveEnd],
        "ATTENDANCE_NOT_LOCKED",
        "warning",
        "Employees have attendance rows not locked/frozen for payroll",
        "attendance_payable_days",
      ),
      countIssue(
        `${eligibleSql}
          AND COALESCE(e.pan_number, '') = ''`,
        params,
        "MISSING_PAN",
        // Under the Income Tax Act, an employee without PAN must be deducted at
        // the maximum slab rate (currently 20%). When tds_mode = 'auto' the engine
        // cannot compute the correct rate without PAN; leaving this as a warning
        // means under-deduction, which is the employer's liability.
        // Remains a warning for manual-TDS runs: the HR team controls the manual
        // amount and is responsible for applying the correct rate.
        tdsMode === "auto" ? "blocker" : "warning",
        tdsMode === "auto"
          ? "Employees missing PAN — auto-TDS cannot apply the correct rate without PAN; under-deduction is employer liability. Resolve or switch to manual TDS before calculation."
          : "Employees missing PAN number (manual TDS run — verify rate is applied correctly)",
        "statutory",
      ),
      countIssue(
        // PAN format: 5 uppercase letters, 4 digits, 1 uppercase letter (Income Tax Act).
        // A stored value that is non-empty but fails this pattern is a placeholder or typo
        // (e.g. "AAAAA0000A", "PANAPPLIED", "N/A") — the engine cannot treat it as a
        // genuine identity any more than a missing PAN can. Same TDS-mode severity rule
        // as MISSING_PAN: auto-TDS needs a valid PAN to look up the correct slab.
        `${eligibleSql}
          AND COALESCE(e.pan_number, '') <> ''
          AND e.pan_number NOT REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]{1}$'`,
        params,
        "INVALID_PAN_FORMAT",
        tdsMode === "auto" ? "blocker" : "warning",
        tdsMode === "auto"
          ? "Employees have a PAN stored but it does not match the 10-character format (AAAAA0000A). Auto-TDS treats these as placeholder/invalid and cannot compute correct rate — resolve before calculation."
          : "Employees have a PAN stored that does not match the valid 10-character format (AAAAA0000A) — verify before TDS filing.",
        "statutory",
      ),
      // Root-caused 2026-08-13: this previously checked ONLY `employee_uan`
      // (schema exists, 0 rows ever — a table that was scaffolded but never
      // populated) against the FULL eligible-for-payroll population, which is
      // why it read as ~100% missing (1,229-1,234 of ~1,250). Real UAN data
      // lives in `employee_statutory_info.uan_number` instead (53 real values
      // among active employees) — a different table the check never looked at.
      // Separately, only 54 of 1,327 active employees are `pf_eligible = 1`;
      // UAN is a PF/EPFO concept and does not apply to the rest. Fixed to (a)
      // accept either source as evidence, and (b) scope the requirement to
      // PF-eligible employees only, matching the already-configured
      // `employee_statutory_info.pf_eligible` flag rather than inventing a new
      // rule. Verified live: this drops the count from ~1,234 to 1 genuine gap.
      countIssue(
        `${eligibleSql}
          AND EXISTS (
            SELECT 1 FROM employee_statutory_info esi
             WHERE esi.employee_id = e.id AND esi.pf_eligible = 1
          )
          AND COALESCE((SELECT esi2.uan_number FROM employee_statutory_info esi2 WHERE esi2.employee_id = e.id), '') = ''
          AND NOT EXISTS (
            SELECT 1 FROM employee_uan eu
             WHERE eu.employee_id = e.id AND eu.is_active = 1
          )`,
        params,
        "MISSING_UAN",
        "warning",
        "PF-eligible employees missing a UAN in both employee_statutory_info.uan_number and employee_uan",
        "statutory",
      ),
      countIssue(
        `${eligibleSql}
          AND EXISTS (
            SELECT 1 FROM employee_joining_document_checklist ejdc
             WHERE ejdc.employee_id = e.id
               AND ejdc.mandatory = 1
               AND ejdc.status NOT IN ('verified','completed','esign_completed','signed_verified','wet_signed_uploaded')
          )`,
        params,
        "INCOMPLETE_JOINING_DOCUMENTS",
        "warning",
        "Employees with mandatory joining documents pending completion/signing",
        "employee_master",
      ),
      countIssue(
        `${eligibleSql}
          AND EXISTS (
            SELECT 1 FROM leave_request lr
             WHERE lr.employee_id = e.id
               AND lr.status = 'pending'
               AND lr.from_date <= ?
               AND lr.to_date >= ?
          )`,
        [...params, range.end, range.start],
        "PENDING_LEAVE_REQUESTS",
        "warning",
        "Employees have pending (unapproved) leave requests for this payroll month — these will be lapsed as LWP at cycle close if not resolved",
        "attendance_payable_days",
      ),
      // ESI contribution-period continuity.
      //
      // calculateNetSalary decides ESI from that month's gross alone
      // (gross <= esic_wage_limit), re-evaluated every run. Under the ESI Act a person
      // covered at the start of a contribution period — April-September or
      // October-March — stays covered to the end of it even if a mid-period raise takes
      // them past the ceiling. The code drops them the month they cross.
      //
      // Reported rather than deducted: correcting the deduction automatically would
      // change the statutory calculation for every employee on every run, and the
      // affected population is small (5 employees in April-September 2026). This
      // surfaces exactly who is affected so payroll can handle them, without altering
      // anyone's pay. Fixing the rule itself needs a contribution-period table and a
      // reconciliation pass; tracked separately.
      countIssue(
        `SELECT e.id, e.employee_code,
                COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
                ROUND(MIN(prior.gross_salary), 2) AS gross_when_covered,
                ROUND(MAX(prior.gross_salary), 2) AS gross_after_crossing,
                MIN(prior_run.run_month)          AS covered_from_month
           FROM employees e
           JOIN salary_prep_line prior     ON prior.employee_id = e.id
           JOIN salary_prep_run  prior_run ON prior_run.id = prior.run_id
          WHERE ${where}
            AND LOWER(prior.status) NOT IN ('excluded', 'blocked')
            AND LOWER(prior_run.status) NOT IN ('draft', 'cancelled')
            -- earlier month, same contribution period (Apr-Sep or Oct-Mar) as this run
            AND prior_run.run_month < ?
            AND prior_run.run_month >= ?
            AND prior.gross_salary > 0
          GROUP BY e.id, e.employee_code, employee_name
            -- Both halves are the point: within one period they were at or under the
            -- ceiling (so coverage attached) AND have since gone over it (so the
            -- month-by-month test drops them). Testing only the first half matches
            -- everyone still under the ceiling — 775 employees against 27 real
            -- crossings — and a warning that noisy is one nobody reads.
            HAVING MIN(prior.gross_salary) <= (
                     SELECT COALESCE(MAX(config_value), 21000) FROM statutory_config
                      WHERE LOWER(config_key) = 'esic_wage_limit' AND is_active = 1)
               AND MAX(prior.gross_salary) > (
                     SELECT COALESCE(MAX(config_value), 21000) FROM statutory_config
                      WHERE LOWER(config_key) = 'esic_wage_limit' AND is_active = 1)`,
        [...params, run.run_month, esiContributionPeriodStart(run.run_month)],
        "ESI_MID_PERIOD_CEILING_CROSSING",
        "warning",
        "Employees were within the ESI wage ceiling earlier in this contribution period. Under the ESI Act they remain covered until the period ends (30 Sep / 31 Mar) even if their gross has since crossed the ceiling — verify ESI is still being deducted for them",
        "statutory",
      ),

      // ============================================================
      // Five categories added 2026-08-13. Each is mapped to a real, verified
      // source table — none invent a workflow or business rule. Where the real
      // engine has a known integration bug (reimbursements, incentive double
      // -count), the check reports the gap; it does not patch
      // payrollCalculate.service.ts, which stays read-only per standing
      // instruction — payroll arithmetic is quantified and reported, not
      // "corrected" by this audit.
      // ============================================================

      // VARIABLE_PAY / INCENTIVES — source: incentive_upload_batch +
      // incentive_upload_line (backend/src/modules/incentives/incentives.service.ts).
      // This one DOES work: payrollCalculate.service.ts pulls approved lines
      // automatically on every calculation (no manual step required).
      checkedIssue("variable_pay", "INCENTIVE_BATCH_PENDING_APPROVAL", () => countIssue(
        `SELECT ib.id, ib.batch_ref, ib.total_employees, ib.total_amount, ib.status
           FROM incentive_upload_batch ib
          WHERE ib.pay_month = ?
            AND ib.status IN ('draft', 'pending_approval')`,
        [run.run_month],
        "INCENTIVE_BATCH_PENDING_APPROVAL",
        "warning",
        "Incentive batches for this payroll month are not yet approved (status draft/pending_approval) — their amounts will not be included until approved.",
        "variable_pay",
      )),
      // REMOVED 2026-08-27: INCENTIVE_APPLY_TO_RUN_DOUBLE_COUNT_RISK.
      //
      // This raised a BLOCKER on any batch at status='applied' — which is the normal,
      // correct end state of the Apply step, not a fault. It described behaviour
      // incentives.service.ts::applyToRun no longer has: that function used to do
      // `gross_salary = gross_salary + total` on top of the amount
      // payrollCalculate.service.ts §5f already pulls, and it no longer touches
      // gross_salary, net_salary or incentive_total at all (see its docblock — the
      // engine is the authoritative writer of all three, and applyToRun is now
      // idempotent, writing only the INCEN_<code> component rows and INCENTIVE rollup
      // the payslip renders).
      //
      // Left as-was, this check blocked a payroll run for doing the right thing, and
      // told whoever read it to go hunting for a double-count that cannot occur. A
      // guard that fires on correct behaviour is worse than no guard: it trains people
      // to override blockers. Deleted rather than downgraded — there is no residual
      // risk here to report at any severity.

      // REIMBURSEMENT — source: employee_reimbursement_claim
      // (backend/src/modules/payroll/reimbursements.routes.ts). Real
      // draft->submitted->approved->processed lifecycle exists, but
      // payrollCalculate.service.ts:1074 selects a column, `claim_amount`, that
      // does not exist on this table (real columns are amount_claimed /
      // amount_approved) — the query throws ER_BAD_FIELD_ERROR on every run and
      // is silently swallowed by a catch, so approved reimbursements NEVER reach
      // gross/net or salary_prep_line.reimbursement_total. Any approved claim
      // for this run's month is proof of real money that structurally cannot be
      // paid through the current calculation path.
      checkedIssue("reimbursement", "REIMBURSEMENT_APPROVED_NOT_INTEGRATED", () => countIssue(
        `SELECT erc.id, erc.employee_id, e.employee_code, erc.claim_type, erc.amount_approved, erc.status
           FROM employee_reimbursement_claim erc
           JOIN employees e ON e.id = erc.employee_id
          WHERE erc.claim_month = ?
            AND erc.status = 'approved'`,
        [run.run_month],
        "REIMBURSEMENT_APPROVED_NOT_INTEGRATED",
        "blocker",
        "Approved reimbursement claims exist for this payroll month, but payrollCalculate.service.ts's automatic pull references a non-existent column (claim_amount instead of amount_approved) and fails silently on every run — these approved amounts never reach gross/net pay. This is a live integration bug in existing code, reported per the payroll-arithmetic change restriction; needs a one-line column-name correction with Payroll/Engineering sign-off.",
        "reimbursement",
      )),

      // RECOVERY / DEDUCTION — sources: salary_advance_log + employee_loans +
      // employee_deduction_entries, all read by payrollCalculate.service.ts.
      // salary_advance_log's recovery query filters `WHERE status = 'active'`
      // (payrollCalculate.service.ts:1030) — moving an advance to status
      // 'approved' via PATCH /advances/:id/approve therefore REMOVES it from
      // recovery instead of confirming it, while a real balance may still be
      // outstanding. This is real, incorrect money movement (employee is paid
      // more than owed because a recovery silently stopped) — a P0-class gap by
      // the standing severity model, not a cosmetic status quirk.
      checkedIssue("recovery_deduction", "RECOVERY_APPROVAL_STATUS_STOPS_DEDUCTION", () => countIssue(
        `${eligibleSql}
          AND EXISTS (
            SELECT 1 FROM salary_advance_log sal
             WHERE sal.employee_id = e.id
               AND sal.status = 'approved'
               AND COALESCE(sal.recovered_amount, 0) < sal.amount
          )`,
        params,
        "RECOVERY_APPROVAL_STATUS_STOPS_DEDUCTION",
        "blocker",
        "Salary advances with status='approved' are excluded from the recovery query (payrollCalculate.service.ts sums only status='active' rows) while a balance remains outstanding — approving an advance silently stops its recovery instead of confirming it. These employees will not have their outstanding advance deducted this run.",
        "recovery_deduction",
      )),
      // 2026-08-19: excludes status='pending_approval' — that is the new loan-approval-gate
      // state (loans.routes.ts POST /:id/approve), an expected pre-activation hold with real
      // provenance, not an anomalous "recovery stopped" condition this warning exists to catch.
      // 'rejected' loans are deliberately still flagged: an approver explicitly declined the
      // loan, but if pending_amount is still nonzero that is worth a human look, same as any
      // other non-active status with a balance.
      checkedIssue("recovery_deduction", "LOAN_RECOVERY_STOPPED_WITH_BALANCE", () => countIssue(
        `${eligibleSql}
          AND EXISTS (
            SELECT 1 FROM employee_loans el
             WHERE el.employee_id = e.id
               AND el.status NOT IN ('active', 'pending_approval')
               AND COALESCE(el.pending_amount, 0) > 0.01
          )`,
        params,
        "LOAN_RECOVERY_STOPPED_WITH_BALANCE",
        "warning",
        "Employee loans have an outstanding pending_amount but status is not 'active' (deduction_per_month is only summed from status='active' rows) — recovery has stopped while a balance remains. Verify whether this is an intended hold or a status error. (Loans awaiting approval, status='pending_approval', are excluded — that is an expected pre-activation state, not an anomaly.)",
        "recovery_deduction",
      )),

      // FULL & FINAL — source: full_final_calculation, joined by employee_id.
      // No calculation ENGINE exists for F&F (net_payable is summed client-side
      // in NativeFullFinal.tsx from operator-typed values; the reusable gratuity
      // formula is never called from any route), so this check validates
      // existence/lifecycle only — it cannot and does not verify F&F amount
      // correctness, because there is no authoritative computed figure to check
      // against. Root-caused 2026-08-13: the tracked exit_request workflow that
      // is supposed to trigger F&F is essentially unused in production —
      // exit_request has 2 rows and full_final_calculation has 1 row, ever,
      // against 57,513 active_status=0 employees all-time and 372 in the last
      // two months alone (306 resigned + 66 terminated, real names/DOJ, zero of
      // them with an exit_request row). Real exits are recorded directly on
      // `employees` by an untracked path that bypasses F&F entirely. Scoped here
      // to exits in this run's month or the prior month so the count is
      // actionable against the current cycle, not the full historical backlog
      // (that backlog is a separate, org-wide finding — see report).
      checkedIssue("full_and_final", "FF_MISSING_FOR_RECENT_EXIT", () => countIssue(
        `SELECT e.id, e.employee_code,
                COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
                COALESCE(e.date_of_exit, e.date_of_leaving) AS exit_date,
                e.employment_status
           FROM employees e
          WHERE e.active_status = 0
            AND COALESCE(e.date_of_exit, e.date_of_leaving) BETWEEN DATE_SUB(?, INTERVAL 1 MONTH) AND ?
            AND NOT EXISTS (
              SELECT 1 FROM full_final_calculation ffc WHERE ffc.employee_id = e.id
            )`,
        [range.start, range.end],
        "FF_MISSING_FOR_RECENT_EXIT",
        "blocker",
        "Employees who exited in this run's month or the previous month have no full_final_calculation record at all. The tracked exit_request -> F&F workflow is effectively unused in production (see report for full scope) — real exits bypass it.",
        "full_and_final",
      )),

      // PAYMENT FILE — sources: employee_bank_detail (export input),
      // profile_update_approval (bank-change approval queue). One reachable
      // export path remains: payroll.routes.ts neft-export. The other two are
      // payroll-extended.routes.ts neft-export [shadowed/dead by route order]
      // and disbursal.routes.ts bank-export [RETIRED 2026-08-17, answers 410].
      //
      // UPDATED 2026-08-17. This block previously said none of them check
      // MISSING_VERIFIED_BANK or a pending bank-change request, and that the
      // reachable neft-export writes "NOT_LINKED" while still adding that
      // net_salary to the declared total. Both were true when written; neither
      // is true of neft-export now, and a governance message that describes a
      // fixed bug sends whoever reads it looking for the wrong thing.
      //
      // neft-export today: unpayable rows are excluded from TOTAL and itemised
      // in an EXCLUDED block, and the route reconciles its payable set against
      // bank-payment-readiness before releasing anything — so MISSING_VERIFIED_BANK
      // and a pending bank-change both now refuse the file (PAYMENT_POPULATION_MISMATCH),
      // because readiness classes them MISSING and PENDING_APPROVAL rather than READY.
      //
      // disbursal.routes.ts bank-export checked NEITHER, which is why it was
      // retired the same day rather than re-gated (section 6). These two checks
      // stay regardless: surfacing the affected population before an export is
      // attempted is worth more than a refusal at the point of export, which
      // arrives after payroll believes it is finished.
      checkedIssue("payment_file", "PAYMENT_FILE_NEFT_EXPORT_OVERSTATEMENT_RISK", () => countIssue(
        `${eligibleSql}
          AND NOT EXISTS (
            SELECT 1 FROM employee_bank_detail ebd
             WHERE ebd.employee_id = e.id AND ebd.active_status = 1 AND ebd.is_primary = 1
          )`,
        params,
        "PAYMENT_FILE_NEFT_EXPORT_OVERSTATEMENT_RISK",
        "warning",
        "Employees have no active primary bank record, so they cannot be paid by bank transfer. GET /api/payroll/runs/:id/neft-export no longer overstates the total for them — they are excluded from TOTAL and itemised in an EXCLUDED block, and the route now refuses the file outright because its payable set will not reconcile against bank payment readiness. The consequence is therefore a REFUSED export, not a wrong one: resolve MISSING_VERIFIED_BANK for these employees, or they will be left unpaid while the rest of the run waits on them. The second exporter that would have emitted a file without them was retired on 2026-08-17.",
        "payment_file",
      )),
      checkedIssue("payment_file", "PAYMENT_FILE_PENDING_BANK_CHANGE_AT_RISK", () => countIssue(
        `${eligibleSql}
          AND EXISTS (
            SELECT 1 FROM profile_update_approval pua
             WHERE pua.employee_id = e.id
               AND pua.request_type = 'bank_details'
               AND pua.status = 'pending'
          )`,
        params,
        "PAYMENT_FILE_PENDING_BANK_CHANGE_AT_RISK",
        "blocker",
        "Employees have a pending, unapproved bank-change request, so the account on file may be about to be superseded. GET /api/payroll/runs/:id/neft-export now refuses the file for them — bank payment readiness classes a pending request PENDING_APPROVAL rather than READY, and the export reconciles against it. The second exporter that would have paid to the stale account while the change was in flight was retired on 2026-08-17. Resolve via /api/payroll/bank-change-requests before export.",
        "payment_file",
      )),
    ];

    for (const issue of await Promise.all(checks)) {
      if (issue) issues.push(issue);
    }

    // MISSING_UAN's SCOPE is not authoritative, so its COUNT must not be read as the filing
    // population. Business ruling 2026-08-13, recorded here because a number this small is
    // otherwise read as reassurance.
    //
    // MISSING_UAN above scopes the requirement to employee_statutory_info.pf_eligible = 1 and
    // reports 1. Reconciled live against the July run, that flag does not describe this
    // workforce:
    //
    //   July-eligible employees ................................. 1,239
    //   PF ACTUALLY deducted (salary_prep_line.pf_employee > 0) .. 1,111
    //   employee_statutory_info.pf_eligible = 1 ..................    53
    //   PF deducted while the flag says NOT eligible ............. 1,100  (99%)
    //   PF deducted with no UAN in ANY of the three stores .......   655
    //
    // So a gate scoped to that flag cannot go red, and "MISSING_UAN: 1" would certify as clean a
    // workforce where 655 people have PF taken from their pay with no member account to credit
    // it to. The defensible figure is carried by
    // payroll-readiness-categories.service.ts's STATUTORY_UAN_MISSING_FOR_PF_DEDUCTED (655) and
    // STATUTORY_PF_ELIGIBLE_FLAG_UNRELIABLE (1,098).
    //
    // This marker is emitted UNCONDITIONALLY and is what forces the statutory category to
    // LEGACY_SCOPE_UNVERIFIED instead of PASS. It is not a defect claim about any employee — it
    // is a statement that the population this check measures has not been approved. It is
    // deliberately NOT resolvable by flipping pf_eligible flags to make the numbers agree;
    // Payroll must first approve the canonical PF applicability and filing population, at which
    // point this marker and the scope it guards are revisited together.
    issues.push({
      code: "MISSING_UAN_SCOPE_UNVERIFIED",
      severity: "warning",
      category: "statutory",
      count: 1,
      message:
        "UAN readiness is UNVERIFIED, not clear. MISSING_UAN is scoped to " +
        "employee_statutory_info.pf_eligible, which is set on 53 of 1,239 July-eligible employees and " +
        "disagrees with what payroll actually deducts for 1,100 of the 1,111 employees PF is taken from " +
        "(99%). Measured against PF actually deducted, 655 employees have no UAN in employees.uan_number, " +
        "employee_statutory_info.uan_number or employee_uan. Treat MISSING_UAN's count as LEGACY SCOPE / " +
        "UNVERIFIED and not as the statutory filing population until Payroll approves the canonical PF " +
        "applicability population. Do not resolve this by editing pf_eligible flags to make the figures agree.",
    });

    // ── NEW JOINER: Payroll Head review gate pending ──────────────────────────
    // Employees created via HRMS whose payroll_head_review row is still
    // pending_review are silently excluded from every payroll run until a
    // Payroll Head approves them. Surface this as a warning so it is visible
    // on the Branch Readiness page before the run is triggered.
    try {
      const [phrRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.employee_code, e.full_name
           FROM employee_payroll_head_review phr
           JOIN employees e ON e.id = phr.employee_id
          WHERE phr.status = 'pending_review'
            AND ${where.replace(/\be\./g, 'e.')}
          LIMIT 20`,
        params,
      );
      if ((phrRows as RowDataPacket[]).length > 0) {
        issues.push({
          code: "NEW_JOINER_PAYROLL_HEAD_REVIEW_PENDING",
          severity: "warning",
          category: "employee_master",
          count: (phrRows as RowDataPacket[]).length,
          message: `${(phrRows as RowDataPacket[]).length} new joiner(s) are pending Payroll Head review and will be excluded from this payroll run until approved.`,
          sample: (phrRows as RowDataPacket[]).slice(0, 5).map((r: any) => ({
            employee_code: r.employee_code,
            full_name: r.full_name,
          })),
        });
      }
    } catch (phrErr) {
      issues.push({ code: "NEW_JOINER_PAYROLL_HEAD_REVIEW_CHECK_ERROR", severity: "warning", category: "employee_master", count: 0, message: "Could not check payroll head review status for new joiners.", sample: [] });
    }

    // ── NEW JOINER: No salary structure assigned ──────────────────────────────
    // Employees with no salary_component_assignments AND no employee_salary_assignment
    // will either get ₹0 salary or be skipped entirely. Surface as a blocker.
    try {
      const [noSalaryRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.employee_code, e.full_name, e.date_of_joining
           FROM employees e
          WHERE ${where}
            AND NOT EXISTS (
              SELECT 1 FROM salary_component_assignments sca
               WHERE sca.employee_id = e.id AND sca.basic > 0
            )
            AND NOT EXISTS (
              SELECT 1 FROM employee_salary_assignment esa
               WHERE esa.employee_id = e.id AND esa.active_status = 1 AND esa.ctc_annual > 0
            )
          LIMIT 20`,
        params,
      );
      if ((noSalaryRows as RowDataPacket[]).length > 0) {
        issues.push({
          code: "NEW_JOINER_SALARY_STRUCTURE_MISSING",
          severity: "blocker",
          category: "employee_master",
          count: (noSalaryRows as RowDataPacket[]).length,
          message: `${(noSalaryRows as RowDataPacket[]).length} employee(s) have no salary structure. Payroll HR must complete the salary component assignment in ATS before payroll can be calculated.`,
          sample: (noSalaryRows as RowDataPacket[]).slice(0, 5).map((r: any) => ({
            employee_code: r.employee_code,
            full_name: r.full_name,
            date_of_joining: r.date_of_joining,
          })),
        });
      }
    } catch (noSalErr) {
      issues.push({ code: "NEW_JOINER_SALARY_STRUCTURE_CHECK_ERROR", severity: "warning", category: "employee_master", count: 0, message: "Could not check salary structure for new joiners.", sample: [] });
    }

    const [eligibleCountRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM employees e WHERE ${where}`,
      params,
    );
    const eligibleEmployees = Number(eligibleCountRows[0]?.count ?? 0);
    const blockerCount = issues.filter((issue) => issue.severity === "blocker").length;

    // Layered readiness: a payroll month can be "calculation technically
    // available" (source_data/attendance_payable_days/employee_master/bank/
    // statutory all clear) while simultaneously NOT READY FOR PAYMENT
    // (variable_pay/recovery_deduction/full_and_final/payment_file still open).
    // Every category present in ALL_CATEGORIES gets a status even when it has
    // zero issues, so a caller can render "PASS" explicitly rather than infer it
    // from absence — a category that was never evaluated (e.g. a check that
    // failed to run at all, outside the try/catch) must not read the same as one
    // that ran clean.
    const ALL_CATEGORIES: PayrollReadinessCategory[] = [
      "source_data", "employee_master", "attendance_payable_days", "bank",
      "statutory", "variable_pay", "reimbursement", "recovery_deduction", "full_and_final", "payment_file",
    ];
    // LEGACY_SCOPE_UNVERIFIED sits between BLOCKED and WARNING deliberately.
    //
    // It is not "a problem was found" — it is "the population this category measures has not
    // been approved, so a clean result here is not evidence of anything". That makes it closer
    // in kind to CHECK_ERROR than to WARNING: both mean the answer cannot be trusted, rather
    // than that the answer is bad. It ranks below BLOCKED only because a real blocker is the
    // more actionable thing to show first.
    //
    // Any issue whose code ends _SCOPE_UNVERIFIED raises it, so a future category can adopt the
    // same treatment without touching this logic.
    const categories: Record<PayrollReadinessCategory, {
      status: "PASS" | "WARNING" | "BLOCKED" | "CHECK_ERROR" | "LEGACY_SCOPE_UNVERIFIED";
      blockers: number;
      warnings: number;
      issueCodes: string[];
    }> = {} as any;
    for (const cat of ALL_CATEGORIES) {
      const catIssues = issues.filter((issue) => issue.category === cat);
      const hasCheckError = catIssues.some((issue) => issue.code.endsWith("_CHECK_ERROR"));
      const hasUnverifiedScope = catIssues.some((issue) => issue.code.endsWith("_SCOPE_UNVERIFIED"));
      const blockers = catIssues.filter((issue) => issue.severity === "blocker").length;
      const warnings = catIssues.filter((issue) => issue.severity === "warning").length;
      categories[cat] = {
        status: hasCheckError
          ? "CHECK_ERROR"
          : blockers > 0
            ? "BLOCKED"
            : hasUnverifiedScope
              ? "LEGACY_SCOPE_UNVERIFIED"
              : warnings > 0
                ? "WARNING"
                : "PASS",
        blockers,
        warnings,
        issueCodes: catIssues.map((issue) => issue.code),
      };
    }

    return {
      runId,
      runMonth: run.run_month,
      status: run.status,
      eligibleEmployees,
      canCalculate: blockerCount === 0,
      attendanceSnapshotLocked: Boolean(run.attendance_snapshot_locked),
      complianceChecked: Boolean(run.compliance_checked),
      issues,
      categories,
      summary: {
        blockers: issues.filter((issue) => issue.severity === "blocker").length,
        warnings: issues.filter((issue) => issue.severity === "warning").length,
      },
    };
  },

  async freezeAttendance(runId: string, actorUserId: string) {
    const run = await getRun(runId);
    const readiness = await this.readiness(runId);
    const hardBlockers = readiness.issues.filter((issue) => issue.severity === "blocker" && issue.code !== "ATTENDANCE_NOT_LOCKED");
    if (hardBlockers.length > 0) {
      throw new Error(`Cannot freeze attendance. Resolve blockers first: ${hardBlockers.map((issue) => issue.code).join(", ")}`);
    }

    const { where, params, range } = runEmployeeScopeSql(run, await runHasPrepLines(run.id));
    const [result] = await db.execute<any>(
      `UPDATE attendance_daily_record adr
         JOIN employees e ON e.id = adr.employee_id
        SET adr.is_locked = 1,
            adr.override_by = COALESCE(adr.override_by, ?),
            adr.override_reason = COALESCE(NULLIF(adr.override_reason, ''), 'Locked by payroll attendance freeze'),
            adr.processed_at = NOW()
       WHERE adr.record_date BETWEEN ? AND ?
         AND ${where}
         AND adr.is_locked = 0`,
      [actorUserId, range.start, range.end, ...params],
    );

    await db.execute(
      `UPDATE salary_prep_run
          SET attendance_snapshot_locked = 1,
              compliance_checked = 1,
              compliance_checked_at = NOW(),
              compliance_issues_count = ?
        WHERE id = ?`,
      [readiness.issues.length, runId],
    );

    await db.execute(
      `INSERT INTO payroll_calculation_audit
         (id, run_id, employee_id, event_type, event_detail, actor_user_id)
       VALUES (UUID(), ?, NULL, 'ATTENDANCE_FREEZE', ?, ?)`,
      [runId, JSON.stringify({ runMonth: run.run_month, lockedRows: result?.affectedRows ?? 0, issues: readiness.issues }), actorUserId],
    );

    return {
      runId,
      runMonth: run.run_month,
      lockedRows: result?.affectedRows ?? 0,
      attendanceSnapshotLocked: true,
      issuesAtFreeze: readiness.issues,
    };
  },
};
