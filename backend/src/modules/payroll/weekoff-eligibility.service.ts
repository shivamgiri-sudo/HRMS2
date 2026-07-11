import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ─── Slab helper ──────────────────────────────────────────────────────────────

/**
 * Returns the maximum week-offs allowed by the paid-days slab.
 * Returns Infinity when paidBase >= 26 (no cap — use actual count).
 */
export function getSlabMaxWeekoffs(paidBase: number): number {
  if (paidBase < 7)  return 0;
  if (paidBase < 12) return 1;
  if (paidBase < 18) return 2;
  if (paidBase < 24) return 3;
  if (paidBase < 26) return 4;
  return Infinity; // paidBase >= 26
}

// ─── Last day of month ────────────────────────────────────────────────────────

function lastDayOfMonth(runMonth: string): number {
  const [year, month] = runMonth.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

// ─── Actual week-off count resolver ──────────────────────────────────────────

/**
 * Resolves the actual number of week-offs for an employee in the given run month.
 *
 * Priority:
 * 1. WFM roster assignments flagged is_week_off=1 (active statuses)
 * 2. Process-level week-off day rule (process_weekoff_day_rule)
 * 3. Fallback: count of Sundays in the month
 */
export async function resolveActualWeekoffCount(
  employeeId: string,
  runMonth: string
): Promise<number> {
  const [year, month] = runMonth.split("-").map(Number);
  const lastDay = lastDayOfMonth(runMonth);
  const dateFrom = `${runMonth}-01`;
  const dateTo   = `${runMonth}-${String(lastDay).padStart(2, "0")}`;

  // ── 1. WFM roster assignments ──────────────────────────────────────────────
  const [rosterRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM wfm_roster_assignment
     WHERE employee_id = ?
       AND is_week_off = 1
       AND roster_date BETWEEN ? AND ?
       AND final_roster_status NOT IN ('rejected', 'cancelled')`,
    [employeeId, dateFrom, dateTo]
  );
  const rosterCount = Number((rosterRows as Array<{ cnt: number }>)[0]?.cnt ?? 0);
  if (rosterCount > 0) return rosterCount;

  // ── 2. Process week-off day rule ───────────────────────────────────────────
  // Fetch employee's process_id first
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const processId = (empRows as Array<{ process_id: string | null }>)[0]?.process_id ?? null;

  if (processId) {
    // Find rules whose week_start_date falls within this month
    const [ruleRows] = await db.execute<RowDataPacket[]>(
      `SELECT max_weekoff_sunday, max_weekoff_monday, max_weekoff_tuesday,
              max_weekoff_wednesday, max_weekoff_thursday, max_weekoff_friday, max_weekoff_saturday
       FROM process_weekoff_day_rule
       WHERE process_id = ?
         AND week_start_date BETWEEN ? AND ?
         AND is_active = 1`,
      [processId, dateFrom, dateTo]
    );

    if (ruleRows.length > 0) {
      let total = 0;
      for (const row of ruleRows as Array<Record<string, number>>) {
        total +=
          (row.max_weekoff_sunday    ?? 0) +
          (row.max_weekoff_monday    ?? 0) +
          (row.max_weekoff_tuesday   ?? 0) +
          (row.max_weekoff_wednesday ?? 0) +
          (row.max_weekoff_thursday  ?? 0) +
          (row.max_weekoff_friday    ?? 0) +
          (row.max_weekoff_saturday  ?? 0);
      }
      if (total > 0) return total;
    }
  }

  // ── 3. Fallback: count Sundays in the month ────────────────────────────────
  let sundays = 0;
  for (let day = 1; day <= lastDay; day++) {
    if (new Date(year, month - 1, day).getDay() === 0) sundays++;
  }
  return sundays;
}

// ─── Main eligibility calculator ─────────────────────────────────────────────

/**
 * Returns the number of eligible week-offs for payroll computation.
 * If employee worked all available working days (calendar - actual weekoffs),
 * they earn all weekoffs. Otherwise apply the paid-base slab cap.
 */
export async function calculateWeekoffEligibility(
  employeeId: string,
  paidBase: number,
  runMonth: string
): Promise<number> {
  const actualCount = await resolveActualWeekoffCount(employeeId, runMonth);

  // Calculate available working days (total - actual weekoffs)
  const [year, month] = runMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const availableWorkingDays = daysInMonth - actualCount;

  // If employee worked all available working days, they get all weekoffs
  if (paidBase >= availableWorkingDays) {
    return actualCount;
  }

  // Otherwise apply the paid-base slab cap
  const slabMax = getSlabMaxWeekoffs(paidBase);
  if (slabMax === Infinity) return actualCount;
  return Math.min(slabMax, actualCount);
}
