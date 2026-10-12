import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Last active salary assignment's monthly gross (ctc_annual / 12) — the same
 * employee_salary_assignment/salary_structure_master lookup calculateGratuityFromEmployee
 * already uses. Shared here rather than queried twice per preview.
 */
export async function resolveGrossMonthly(employeeId: string): Promise<number | null> {
  // What the person was actually paid per month beats contract CTC, which stale or inactive salary
  // assignments can misstate. gross_before_lwp is the full-month base before loss-of-pay, from the
  // latest closed payroll run; CTC / 12 remains the fallback.
  try {
    const [paid] = await db.execute<RowDataPacket[]>(
      `SELECT spl.gross_before_lwp, spl.gross_salary, spl.final_payable_days, spl.working_days
         FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id
        WHERE spl.employee_id = ? AND spl.gross_salary > 0
          AND LOWER(spr.status) IN ('locked','finalized','disbursed','approved','completed')
          AND LOWER(spl.status) NOT IN ('excluded','blocked')
        ORDER BY spr.run_month DESC, spr.created_at DESC LIMIT 1`,
      [employeeId]
    );
    const r = (paid as Array<{ gross_before_lwp: number | null; gross_salary: number; final_payable_days: number | null; working_days: number | null }>)[0];
    if (r) {
      // Full-month base: gross_before_lwp when the calculator stored it, otherwise rebuilt from what
      // was actually paid (gross / paid days x days in the month). Older lines carry no base.
      const stored = Number(r.gross_before_lwp ?? 0);
      if (stored > 0) return stored;
      const days = Number(r.final_payable_days ?? 0);
      const month = Number(r.working_days ?? 0);
      if (days > 0 && month > 0) return Math.round((Number(r.gross_salary) / days) * month * 100) / 100;
      return Number(r.gross_salary);
    }
  } catch { /* fall through to CTC */ }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT esa.ctc_annual
       FROM employee_salary_assignment esa
      WHERE esa.employee_id = ? AND esa.active_status = 1
      ORDER BY esa.effective_from DESC
      LIMIT 1`,
    [employeeId]
  );
  const row = (rows as Array<{ ctc_annual: number }>)[0];
  if (!row) return null;
  return Number(row.ctc_annual) / 12;
}
