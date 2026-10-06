// Re-grades recent days whose evidence arrived after the day was graded.
//
// WHY THIS EXISTS: a day is graded once (nightly sweep / heal / live punch). If biometric punches or dialler
// minutes reach HRMS later - a COSEC sync that ran late, an APR re-pull - the record keeps the verdict it got
// from the gap. October 2026: 110 days stayed "absent" for employees with 9h+ of punches, because the punches
// landed after grading; re-grading gave "present". apr-sync-regrade covers APR changes the sync itself makes;
// this covers every source, by comparing what a record was graded on with what the engine's own sources hold now.
//
// Candidates: unlocked days (no override, no regularization) in the window, graded absent / missing_punch /
// half_day / unreconciled, where wfm_attendance_session, integration_biometric_daily or apr now hold MORE
// minutes than the record stored. Each is re-run through the engine and written only if the result changed.
// Never touched: locked days, months with a payroll run (counted, left for payroll), dates outside employment
// (upsertDailyRecord refuses them).
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { attendanceEngineService } from "./attendance-engine.service.js";
import { payrollStartedMonths } from "./apr-sync-regrade.service.js";

export const STALE_REGRADE_LIMIT = 2000;

export interface StaleRegradeResult {
  candidates: number;
  regraded: number;
  unchanged: number;
  heldPayroll: number;
  failed: number;
}

/** Days graded on less evidence than the engine's sources now hold. */
export async function findStaleGradedDays(from: string, to: string, limit = STALE_REGRADE_LIMIT): Promise<Array<{ employeeId: string; date: string; status: string; lwp: number }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.employee_id, DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS d, adr.attendance_status AS st, adr.lwp_value AS lwp
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
      WHERE adr.record_date BETWEEN ? AND ?
        AND adr.is_locked = 0 AND adr.override_by IS NULL AND adr.regularization_id IS NULL
        AND adr.attendance_status IN ('absent', 'missing_punch', 'half_day', 'unreconciled')
        AND (
          (SELECT COALESCE(SUM(s.total_login_minutes), 0) FROM wfm_attendance_session s
            WHERE s.employee_id = adr.employee_id AND s.session_date = adr.record_date) > COALESCE(adr.biometric_minutes, 0)
          OR (SELECT COALESCE(MAX(ibd.biometric_minutes), 0) FROM integration_biometric_daily ibd
               WHERE ibd.activity_date = adr.record_date AND ibd.employee_code IN (e.employee_code, e.biometric_code)) > COALESCE(adr.biometric_minutes, 0)
          OR (SELECT COALESCE(SUM(TIME_TO_SEC(a.Net_Login)), 0) DIV 60 FROM apr a
               WHERE a.UserID = e.employee_code AND a.ReportDate = adr.record_date) > COALESCE(adr.dialler_minutes, 0)
        )
      ORDER BY adr.record_date
      LIMIT ${Math.max(1, Math.min(limit, STALE_REGRADE_LIMIT))}`,
    [from, to],
  );
  return (rows as RowDataPacket[]).map((r) => ({
    employeeId: String(r.employee_id), date: String(r.d), status: String(r.st), lwp: Number(r.lwp ?? 0),
  }));
}

export async function regradeStaleDays(from: string, to: string, actor = "system:stale-regrade"): Promise<StaleRegradeResult> {
  const out: StaleRegradeResult = { candidates: 0, regraded: 0, unchanged: 0, heldPayroll: 0, failed: 0 };
  const days = await findStaleGradedDays(from, to);
  out.candidates = days.length;
  if (!days.length) return out;

  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT LEFT(CAST(run_month AS CHAR), 7) AS month, status FROM salary_prep_run WHERE run_month IS NOT NULL`,
  );
  const frozen = payrollStartedMonths(runRows as Array<{ month: string; status: string }>);

  for (const d of days) {
    if (frozen.has(d.date.slice(0, 7))) { out.heldPayroll++; continue; }
    try {
      const result = await attendanceEngineService.processEmployee(d.employeeId, d.date);
      if (result.status === d.status && Number(result.lwpValue) === d.lwp) { out.unchanged++; continue; }
      await attendanceEngineService.upsertDailyRecord(result, actor);
      out.regraded++;
    } catch {
      out.failed++;
    }
  }
  return out;
}
