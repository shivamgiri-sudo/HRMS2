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

async function getRun(runId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1`,
    [runId],
  );
  const run = rows[0] as any;
  if (!run) throw new Error("Payroll run not found");
  return run;
}

function runEmployeeScopeSql(run: any) {
  const clauses = [
    "e.active_status = 1",
    "LOWER(COALESCE(e.employment_status, 'active')) = 'active'",
    "(e.date_of_joining IS NULL OR e.date_of_joining <= ?)",
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

export const payrollGovernanceService = {
  async readiness(runId: string) {
    const run = await getRun(runId);
    const { where, params, range } = runEmployeeScopeSql(run);
    const issues: PayrollReadinessIssue[] = [];

    const eligibleSql = `
      SELECT e.id, e.employee_code,
             COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name
        FROM employees e
       WHERE ${where}`;

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
        "blocker",
        "Employees missing verified primary bank account",
      ),
      countIssue(
        `${eligibleSql}
          AND NOT EXISTS (
            SELECT 1 FROM attendance_daily_record adr
             WHERE adr.employee_id = e.id
               AND adr.record_date BETWEEN ? AND ?
          )`,
        [...params, range.start, range.end],
        "NO_ATTENDANCE_RECORDS",
        "blocker",
        "Employees missing attendance_daily_record rows for the payroll month",
      ),
      countIssue(
        `${eligibleSql}
          AND EXISTS (
            SELECT 1 FROM attendance_daily_record adr
             WHERE adr.employee_id = e.id
               AND adr.record_date BETWEEN ? AND ?
               AND adr.attendance_status = 'unreconciled'
          )`,
        [...params, range.start, range.end],
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
        [...params, range.start, range.end],
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

    const { where, params, range } = runEmployeeScopeSql(run);
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
