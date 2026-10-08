// Re-grades attendance days whose APR changed after the day was already graded.
//
// WHY THIS EXISTS: apr-vicidial-sync used to pull only "today" each hour. A dialler server that was down,
// or logins after the last run before midnight, left a ReportDate missing or short for good (Sep 2026:
// 21-29 Sep sync carried ~14-37 agents instead of ~195; 2 Oct had no APR row at all). The worker now
// re-pulls past days, but the attendance record for such a day was already written from the gap, so a
// late APR row alone changes nothing. This re-runs the engine for exactly the employee-days whose APR
// minutes changed.
//
// Never touches: today (not over yet), a locked record (manual override / regularization / payroll lock -
// upsertDailyRecord also refuses at SQL level), a day with no record (attendance-heal creates those), or any
// month where a payroll run has started - changing attendance under a run would make its stored lines
// disagree with the register. Those are counted so the run log shows what was left for payroll.
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { attendanceEngineService } from "./attendance-engine.service.js";

/** Payroll run states that never went anywhere, so they do not freeze a month. */
const IGNORED_PAYROLL_STATUSES = ["rejected", "cancelled"];
/** Upper bound per run; a larger backlog continues on the next run. */
export const REGRADE_LIMIT = 3000;

export interface RegradeResult {
  regraded: number;
  skippedPayroll: number;
  skippedLocked: number;
  noRecord: number;
  failed: number;
}

/** Months (YYYY-MM) that have any payroll run that is not rejected/cancelled. */
export function payrollStartedMonths(runs: Array<{ month: string; status: string }>): Set<string> {
  const months = new Set<string>();
  for (const r of runs) {
    if (IGNORED_PAYROLL_STATUSES.includes(String(r.status ?? "").toLowerCase())) continue;
    months.add(r.month);
  }
  return months;
}

/**
 * changes: ReportDate (YYYY-MM-DD) -> employee codes whose APR minutes changed on it.
 * today: IST date; that day and later are skipped.
 */
export async function regradeAprChanges(changes: Map<string, Set<string>>, today: string): Promise<RegradeResult> {
  const out: RegradeResult = { regraded: 0, skippedPayroll: 0, skippedLocked: 0, noRecord: 0, failed: 0 };
  const dates = [...changes.keys()].filter((d) => d < today && (changes.get(d)?.size ?? 0) > 0).sort();
  if (!dates.length) return out;

  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT LEFT(CAST(run_month AS CHAR), 7) AS month, status FROM salary_prep_run WHERE run_month IS NOT NULL`,
  );
  const frozen = payrollStartedMonths(runRows as Array<{ month: string; status: string }>);

  for (const date of dates) {
    const codes = [...(changes.get(date) ?? [])];
    if (frozen.has(date.slice(0, 7))) { out.skippedPayroll += codes.length; continue; }

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT adr.employee_id, adr.is_locked
         FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
        WHERE adr.record_date = ? AND e.employee_code IN (?)`,
      [date, codes],
    );
    out.noRecord += codes.length - (rows as RowDataPacket[]).length;
    for (const r of rows as RowDataPacket[]) {
      if (Number(r.is_locked) === 1) { out.skippedLocked++; continue; }
      if (out.regraded >= REGRADE_LIMIT) return out;
      try {
        const result = await attendanceEngineService.processEmployee(String(r.employee_id), date);
        await attendanceEngineService.upsertDailyRecord(result, "apr-sync-regrade");
        out.regraded++;
      } catch {
        out.failed++;
      }
    }
  }
  return out;
}
