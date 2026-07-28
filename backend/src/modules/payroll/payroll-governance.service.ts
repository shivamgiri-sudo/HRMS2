import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type PayrollReadinessSeverity = "blocker" | "warning";

export interface PayrollReadinessIssue {
  code: string;
  severity: PayrollReadinessSeverity;
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

async function countIssue(sql: string, params: unknown[], code: string, severity: PayrollReadinessSeverity, message: string): Promise<PayrollReadinessIssue | null> {
  // Use db.query (text protocol) instead of db.execute (prepared statements) to avoid
  // "Incorrect arguments to mysqld_stmt_execute" when ? placeholders appear inside subqueries.
  const [countRows] = await (db as any).query(`SELECT COUNT(*) AS count FROM (${sql}) issue_rows`, params) as [RowDataPacket[], unknown];
  const count = Number((countRows as any)[0]?.count ?? 0);
  if (count === 0) return null;
  const [sample] = await (db as any).query(`${sql} LIMIT 10`, params) as [RowDataPacket[], unknown];
  return { code, severity, count, message, sample: sample as Array<Record<string, unknown>> };
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

    // M+2 gate: final calculation is only allowed on or after the 2nd of the following month.
    // This ensures night-shift attendance from the last working day of the month has crossed
    // over and been captured before payroll is sealed.
    const today = todayIstDate();
    const [runYear, runMonthNum] = run.run_month.split("-").map(Number);
    const nextMonthYear  = runMonthNum === 12 ? runYear + 1 : runYear;
    const nextMonthNum   = runMonthNum === 12 ? 1 : runMonthNum + 1;
    const earliestCalcDate = `${nextMonthYear}-${String(nextMonthNum).padStart(2, "0")}-02`;
    if (today < earliestCalcDate) {
      issues.push({
        code: "MONTH_NOT_CLOSED",
        severity: "blocker",
        count: 1,
        message: `Payroll for ${run.run_month} cannot be calculated before ${earliestCalcDate}. Final calculation is allowed from M+2 to ensure night-shift attendance is fully captured.`,
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
        "warning",
        "Employees missing verified primary bank account; resolve before disbursement",
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
      ),
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
          WHERE ${where}`,
        [range.start, effectiveEnd, ...params],
        "SALARY_PAYABLE_DAYS_MISMATCH",
        "blocker",
        "Salary prep final payable days do not match recomputed attendance_daily_record payable days",
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
      ),
      countIssue(
        `${eligibleSql}
          AND COALESCE(e.pan_number, '') = ''`,
        params,
        "MISSING_PAN",
        "warning",
        "Employees missing PAN number",
      ),
      countIssue(
        `${eligibleSql}
          AND NOT EXISTS (
            SELECT 1 FROM employee_uan eu
             WHERE eu.employee_id = e.id AND eu.is_active = 1
          )`,
        params,
        "MISSING_UAN",
        "warning",
        "Employees missing active UAN/PF record",
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
      ),
    ];

    for (const issue of await Promise.all(checks)) {
      if (issue) issues.push(issue);
    }

    const [eligibleCountRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM employees e WHERE ${where}`,
      params,
    );
    const eligibleEmployees = Number(eligibleCountRows[0]?.count ?? 0);
    const blockerCount = issues.filter((issue) => issue.severity === "blocker").length;

    return {
      runId,
      runMonth: run.run_month,
      status: run.status,
      eligibleEmployees,
      canCalculate: blockerCount === 0,
      attendanceSnapshotLocked: Boolean(run.attendance_snapshot_locked),
      complianceChecked: Boolean(run.compliance_checked),
      issues,
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
