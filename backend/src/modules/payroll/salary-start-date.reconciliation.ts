/**
 * Salary start date - reconciliation and the payroll gate switch. Read-only: finds approved
 * employees whose stored copies of the date disagree, and says whether that blocks a payroll run.
 * salary-start-date.service.ts re-exports everything here.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { dayOf } from "./salary-start-date.rules.js";

// ── Payroll gate switch ────────────────────────────────────────────────────────

export const SALARY_DATE_GATE_FLAG_KEY = "salary_start_date_gate_enforced";

/**
 * Whether a salary start date mismatch BLOCKS payroll calculation (true) or is only reported as a
 * warning (false, the default until the existing mismatches are repaired). A missing or unreadable
 * flag reads as false: turning the gate on is a deliberate act (Payroll Config Flags screen),
 * because switching it on with unrepaired data would stop every run.
 */
export async function isSalaryStartDateGateEnforced(): Promise<boolean> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT config_value FROM payroll_config_flags
        WHERE branch_id IS NULL AND process_id IS NULL AND config_key = ? LIMIT 1`,
      [SALARY_DATE_GATE_FLAG_KEY],
    );
    return rows.length > 0 && String(rows[0].config_value).trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

// ── Reconciliation ─────────────────────────────────────────────────────────────

export type SalaryDateMismatchReason =
  | "VALIDATION_DATE_DIFFERS"
  | "PACKAGE_DATE_DIFFERS"
  | "NO_ASSIGNMENT_ON_START_DATE"
  | "MULTIPLE_ACTIVE_ASSIGNMENTS"
  | "PRE_JOINING_WITHOUT_AUDIT";

export interface SalaryDateMismatchRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  date_of_joining: string | null;
  payroll_date: string | null;
  validation_date: string | null;
  package_date: string | null;
  assignment_date: string | null;
  active_assignments: number;
  reasons: SalaryDateMismatchReason[];
}

/**
 * Employees Payroll Head has approved whose stored copies of the salary start date disagree.
 * `employeeScopeWhere` is a boolean SQL fragment over alias `e` (the run's own employee scope), so
 * the check judges exactly the people the run would pay.
 */
export async function findSalaryStartDateMismatches(
  exec: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  employeeScopeWhere: string,
  params: unknown[],
  limit = 500,
): Promise<SalaryDateMismatchRow[]> {
  const sql = `
    SELECT e.id AS employee_id, e.employee_code, e.full_name, e.date_of_joining,
           e.salary_start_date AS payroll_date,
           v.salary_start_date AS validation_date,
           phr.package_effective_from AS package_date,
           (SELECT a.effective_from FROM employee_salary_assignment a
             WHERE a.employee_id = e.id AND a.active_status = 1
             ORDER BY a.effective_from DESC LIMIT 1) AS assignment_date,
           (SELECT COUNT(*) FROM employee_salary_assignment a
             WHERE a.employee_id = e.id AND a.active_status = 1) AS active_assignments,
           (SELECT COUNT(*) FROM employee_salary_assignment a
             WHERE a.employee_id = e.id AND a.effective_from = e.salary_start_date) AS on_start_date,
           (SELECT COUNT(*) FROM employee_salary_start_date_audit au
             WHERE au.employee_id = e.id AND au.pre_joining = 1) AS pre_joining_audits,
           (EXISTS (SELECT 1 FROM employee_salary_change_log l WHERE l.employee_id = e.id)
             OR EXISTS (SELECT 1 FROM salary_increment_request sir
                         WHERE sir.employee_id = e.id AND sir.status = 'implemented')) AS has_salary_change
      FROM employees e
      JOIN employee_payroll_head_review phr ON phr.employee_id = e.id AND phr.status = 'approved'
      LEFT JOIN ats_payroll_hr_validation v ON v.id = (
             SELECT v2.id FROM ats_payroll_hr_validation v2
              WHERE v2.candidate_id = phr.candidate_id ORDER BY v2.created_at DESC LIMIT 1)
     WHERE (${employeeScopeWhere})
     HAVING (validation_date IS NOT NULL AND NOT (validation_date <=> payroll_date))
         OR (package_date IS NOT NULL AND NOT (package_date <=> payroll_date))
         OR (payroll_date IS NOT NULL AND on_start_date = 0 AND has_salary_change = 0)
         OR active_assignments > 1
         OR (payroll_date < date_of_joining AND pre_joining_audits = 0)
     ORDER BY e.employee_code
     LIMIT ${Math.max(1, Math.floor(limit))}`;
  const [rows] = (await exec.query(sql, params)) as [RowDataPacket[], unknown];
  return rows.map((r) => {
    const reasons: SalaryDateMismatchReason[] = [];
    const payroll = dayOf(r.payroll_date);
    if (r.validation_date && dayOf(r.validation_date) !== payroll)
      reasons.push("VALIDATION_DATE_DIFFERS");
    if (r.package_date && dayOf(r.package_date) !== payroll)
      reasons.push("PACKAGE_DATE_DIFFERS");
    if (payroll && Number(r.on_start_date) === 0 && Number(r.has_salary_change) === 0)
      reasons.push("NO_ASSIGNMENT_ON_START_DATE");
    if (Number(r.active_assignments) > 1)
      reasons.push("MULTIPLE_ACTIVE_ASSIGNMENTS");
    if (
      payroll &&
      dayOf(r.date_of_joining) &&
      payroll < dayOf(r.date_of_joining) &&
      Number(r.pre_joining_audits) === 0
    ) {
      reasons.push("PRE_JOINING_WITHOUT_AUDIT");
    }
    return {
      employee_id: String(r.employee_id),
      employee_code: String(r.employee_code),
      full_name: String(r.full_name ?? ""),
      date_of_joining: dayOf(r.date_of_joining) || null,
      payroll_date: payroll || null,
      validation_date: dayOf(r.validation_date) || null,
      package_date: dayOf(r.package_date) || null,
      assignment_date: dayOf(r.assignment_date) || null,
      active_assignments: Number(r.active_assignments),
      reasons,
    };
  });
}

/** Every Payroll Head-approved employee whose salary start date differs across the stored copies. */
export async function listSalaryStartDateMismatches(limit = 1000): Promise<SalaryDateMismatchRow[]> {
  return findSalaryStartDateMismatches(db as unknown as { query: (sql: string, params?: unknown[]) => Promise<unknown> }, "1=1", [], limit);
}
