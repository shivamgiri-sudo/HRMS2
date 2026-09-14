/**
 * Read-only impact simulator for the G12 week_off_worked historical correction.
 *
 * The G12 bug (commit 5dc328de): `resolveOverridePriority` tested
 * `roster_status = 'Week Off'` — a literal that matched ZERO of the 413,386
 * rows in wfm_roster_assignment.  The real marker is `is_week_off = 1`, set
 * on 170 rows.  Consequence: every rostered week-off was invisible to the
 * engine, so:
 *
 *   - Employees who worked their week-off never received `week_off_worked`
 *     (no WFM review, no overtime flag).
 *   - Employees who were absent on their week-off received `absent` +
 *     lwp_value=1.00 — an LWP deduction for a day that was NOT a working day.
 *   - Employees with missing_punch on their week-off received
 *     `missing_punch` + mismatch_flag=1, triggering false regularisation
 *     pressure.
 *
 * The fix is already in the engine.  New runs will produce the correct
 * status.  Historical rows already written to attendance_daily_record are NOT
 * rewritten by the engine re-run guard (is_locked OR existing row not
 * overwritten when source unchanged).
 *
 * This simulator identifies every historical employee-date where
 * wfm_roster_assignment has is_week_off=1 but attendance_daily_record does
 * NOT carry `week_off` or `week_off_worked`, then maps the current recorded
 * status to its financial consequence.
 *
 * Salary impact formula (conservative estimate only, for Payroll approval):
 *   For an `absent` row on a rostered week-off:
 *     lwp_deducted = lwp_value (typically 1.00)
 *     salary_saved = (monthly_gross / days_in_month) * lwp_deducted
 *   For a `missing_punch` row with lwp_value > 0, same formula.
 *   For `present` / `week_off_worked`: no LWP loss; however the employee
 *     earned WFM-review / overtime credit that was never flagged.
 *
 * NO WRITE happens in any function in this file.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface WowImpactRow {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  branch_name: string | null;
  process_name: string | null;
  roster_date: string;
  current_status: string;
  lwp_value: number;
  is_locked: number;
  payroll_run_month: string | null;
  payroll_run_status: string | null;
  payroll_run_id: string | null;
  monthly_gross: number | null;
  days_in_month: number | null;
  estimated_lwp_salary_loss: number | null;
}

export interface WowImpactSummary {
  generated_at: string;
  total_affected_employee_dates: number;
  employees_affected: number;
  by_current_status: Record<string, number>;
  total_estimated_lwp_loss: number;
  finalized_run_rows: number;
  unlocked_rows: number;
  rows: WowImpactRow[];
}

/**
 * Returns all employee-dates where the roster says is_week_off=1 but
 * attendance_daily_record does not hold 'week_off' or 'week_off_worked'.
 * Joins salary_prep_line for estimated deduction impact on finalized runs.
 *
 * Scope: publish_status IN ('published','approved_final') only — draft or
 * pending rosters are not authoritative.
 *
 * @param fromDate  YYYY-MM-DD lower bound (defaults to 2026-01-01)
 * @param toDate    YYYY-MM-DD upper bound (defaults to today − 1 day)
 */
export async function simulateWowImpact(
  fromDate?: string,
  toDate?: string,
): Promise<WowImpactSummary> {
  const from = fromDate ?? "2026-01-01";
  const to   = toDate   ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // All impacted attendance_daily_record rows:
  //   - roster says is_week_off = 1 (published/approved_final)
  //   - attendance_daily_record does NOT have week_off or week_off_worked
  //   - record is in our scan window
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       adr.employee_id,
       e.employee_code,
       TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,''))) AS employee_name,
       b.branch_name,
       pm.process_name,
       DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS roster_date,
       adr.attendance_status                     AS current_status,
       COALESCE(adr.lwp_value, 0)                AS lwp_value,
       adr.is_locked,
       LEFT(spr.run_month, 7)                    AS payroll_run_month,
       spr.status                                AS payroll_run_status,
       spr.id                                    AS payroll_run_id,
       COALESCE(spl.gross_salary, 0)             AS monthly_gross,
       DAY(LAST_DAY(spr.run_month))              AS days_in_month
     FROM attendance_daily_record adr
     JOIN employees e ON e.id = adr.employee_id
     LEFT JOIN branches b  ON b.id = e.branch_id
     LEFT JOIN process_master pm ON pm.id = adr.process_id
     -- Roster: this employee had is_week_off=1 on this date
     JOIN wfm_roster_assignment ra
       ON  ra.employee_id   = adr.employee_id
       AND ra.roster_date   = adr.record_date
       AND ra.is_week_off   = 1
       AND ra.publish_status IN ('published','approved_final')
     -- Payroll run covering this month (most authoritative per run-status hierarchy)
     LEFT JOIN salary_prep_run spr
       ON  LEFT(spr.run_month, 7) = DATE_FORMAT(adr.record_date, '%Y-%m')
       AND spr.id = (
         SELECT spr2.id
           FROM salary_prep_run spr2
          WHERE LEFT(spr2.run_month, 7) = DATE_FORMAT(adr.record_date, '%Y-%m')
          ORDER BY
            CASE UPPER(spr2.status)
              WHEN 'FINALIZED'  THEN 1
              WHEN 'DISBURSED'  THEN 2
              WHEN 'LOCKED'     THEN 3
              WHEN 'APPROVED'   THEN 4
              WHEN 'COMPLETED'  THEN 5
              WHEN 'PROCESSING' THEN 6
              WHEN 'DRAFT'      THEN 7
              ELSE 8
            END,
            spr2.created_at DESC
          LIMIT 1
       )
     -- Employee's gross in that run (for LWP loss estimate)
     LEFT JOIN salary_prep_line spl
       ON  spl.employee_id = adr.employee_id
       AND spl.run_id      = spr.id
     WHERE adr.record_date BETWEEN ? AND ?
       AND adr.attendance_status NOT IN ('week_off', 'week_off_worked')
     ORDER BY adr.record_date DESC, e.employee_code`,
    [from, to],
  );

  const impacted = rows as WowImpactRow[];

  const byStatus: Record<string, number> = {};
  let totalLwpLoss = 0;
  let finalizedRunRows = 0;
  let unlockedRows = 0;

  for (const r of impacted) {
    byStatus[r.current_status] = (byStatus[r.current_status] ?? 0) + 1;

    const lwp = Number(r.lwp_value ?? 0);
    const gross = Number(r.monthly_gross ?? 0);
    const days = Number(r.days_in_month ?? 30);

    if (lwp > 0 && gross > 0 && days > 0) {
      r.estimated_lwp_salary_loss = Math.round((gross / days) * lwp * 100) / 100;
      totalLwpLoss += r.estimated_lwp_salary_loss;
    } else {
      r.estimated_lwp_salary_loss = null;
    }

    const runStatus = String(r.payroll_run_status ?? "").toLowerCase();
    if (["finalized", "disbursed", "locked"].includes(runStatus)) {
      finalizedRunRows++;
    }
    if (!r.is_locked) {
      unlockedRows++;
    }
  }

  const employeesAffected = new Set(impacted.map((r) => r.employee_id)).size;

  return {
    generated_at: new Date().toISOString(),
    total_affected_employee_dates: impacted.length,
    employees_affected: employeesAffected,
    by_current_status: byStatus,
    total_estimated_lwp_loss: Math.round(totalLwpLoss * 100) / 100,
    finalized_run_rows: finalizedRunRows,
    unlocked_rows: unlockedRows,
    rows: impacted,
  };
}

/**
 * Returns only the rows from finalized/disbursed/locked payroll runs.
 * These are the ones where a correction requires Payroll Head sign-off and
 * a manual controlled reprocessing — unlocked rows can be re-run by the
 * engine without that gate.
 */
export async function simulateWowFinalizedImpact(
  fromDate?: string,
  toDate?: string,
): Promise<WowImpactSummary> {
  const full = await simulateWowImpact(fromDate, toDate);
  const finalizedRows = full.rows.filter((r) => {
    const s = String(r.payroll_run_status ?? "").toLowerCase();
    return ["finalized", "disbursed", "locked"].includes(s);
  });

  const byStatus: Record<string, number> = {};
  let totalLwpLoss = 0;
  for (const r of finalizedRows) {
    byStatus[r.current_status] = (byStatus[r.current_status] ?? 0) + 1;
    totalLwpLoss += Number(r.estimated_lwp_salary_loss ?? 0);
  }

  return {
    generated_at: full.generated_at,
    total_affected_employee_dates: finalizedRows.length,
    employees_affected: new Set(finalizedRows.map((r) => r.employee_id)).size,
    by_current_status: byStatus,
    total_estimated_lwp_loss: Math.round(totalLwpLoss * 100) / 100,
    finalized_run_rows: finalizedRows.length,
    unlocked_rows: 0,
    rows: finalizedRows,
  };
}
