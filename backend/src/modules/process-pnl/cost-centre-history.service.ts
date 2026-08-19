import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface CostCentrePeriod {
  costCentreId: string;
  fromDate: string;
  toDate: string;
  days: number;
}

/**
 * Returns the employee's cost_centre_id as of a specific date.
 *
 * Reads employee_job_history for cost_centre_change events. If no history exists
 * before asOfDate, returns the earliest change's from_cost_centre_id (pre-transfer value)
 * or falls back to the current employees.cost_centre_id.
 */
export async function getCostCentreAtDate(
  employeeId: string,
  asOfDate: string
): Promise<string | null> {
  // Most recent cost_centre_change on or before asOfDate
  const [historyRows] = await db.execute<RowDataPacket[]>(
    `SELECT to_cost_centre_id
     FROM employee_job_history
     WHERE employee_id = ?
       AND change_type = 'cost_centre_change'
       AND effective_date <= ?
     ORDER BY effective_date DESC, created_at DESC
     LIMIT 1`,
    [employeeId, asOfDate]
  );
  if ((historyRows as RowDataPacket[])[0]?.to_cost_centre_id) {
    return String((historyRows as RowDataPacket[])[0].to_cost_centre_id);
  }

  // Date is before any recorded change — use from_cost_centre_id of earliest change
  const [earliestRows] = await db.execute<RowDataPacket[]>(
    `SELECT from_cost_centre_id, effective_date
     FROM employee_job_history
     WHERE employee_id = ?
       AND change_type = 'cost_centre_change'
     ORDER BY effective_date ASC, created_at ASC
     LIMIT 1`,
    [employeeId]
  );
  const earliest = (earliestRows as RowDataPacket[])[0];
  if (earliest && asOfDate < String(earliest.effective_date).slice(0, 10)) {
    return earliest.from_cost_centre_id ? String(earliest.from_cost_centre_id) : null;
  }

  // No history at all — fall back to current assignment
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT cost_centre_id FROM employees WHERE id = ?`,
    [employeeId]
  );
  return (empRows as RowDataPacket[])[0]?.cost_centre_id
    ? String((empRows as RowDataPacket[])[0].cost_centre_id)
    : null;
}

/**
 * Returns all cost centre periods (with day counts) within a date range.
 * Used for mid-month salary apportionment when an employee changes cost centres.
 *
 * Example: employee transfers on 2026-08-15, monthStart=2026-08-01, monthEnd=2026-08-31
 * Returns: [{CC_OLD, 2026-08-01, 2026-08-14, 14}, {CC_NEW, 2026-08-15, 2026-08-31, 17}]
 */
export async function getCostCentrePeriods(
  employeeId: string,
  monthStart: string,
  monthEnd: string
): Promise<CostCentrePeriod[]> {
  // Changes that land WITHIN the month (strictly after monthStart, on or before monthEnd)
  const [changeRows] = await db.execute<RowDataPacket[]>(
    `SELECT effective_date, to_cost_centre_id
     FROM employee_job_history
     WHERE employee_id = ?
       AND change_type = 'cost_centre_change'
       AND effective_date > ? AND effective_date <= ?
     ORDER BY effective_date ASC, created_at ASC`,
    [employeeId, monthStart, monthEnd]
  );
  const changes = changeRows as RowDataPacket[];

  const startingCC = await getCostCentreAtDate(employeeId, monthStart);
  if (!startingCC && changes.length === 0) return [];
  // If no starting CC but changes exist, we can't accurately split — return empty
  // so the caller uses the single-row path with the current employee CC.
  if (!startingCC) return [];

  const periods: CostCentrePeriod[] = [];
  let currentCC: string | null = startingCC;
  let periodStart = monthStart;

  for (const change of changes) {
    const changeDate = String(change.effective_date).slice(0, 10);
    // Period ends the day before the change
    const endMs = new Date(changeDate).getTime() - 86400000;
    const periodEnd = new Date(endMs).toISOString().slice(0, 10);

    if (currentCC && periodStart <= periodEnd) {
      const days =
        Math.round((new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 86400000) + 1;
      periods.push({ costCentreId: currentCC, fromDate: periodStart, toDate: periodEnd, days });
    }
    currentCC = change.to_cost_centre_id ? String(change.to_cost_centre_id) : null;
    periodStart = changeDate;
  }

  // Final period to monthEnd
  if (currentCC && periodStart <= monthEnd) {
    const days =
      Math.round((new Date(monthEnd).getTime() - new Date(periodStart).getTime()) / 86400000) + 1;
    periods.push({ costCentreId: currentCC, fromDate: periodStart, toDate: monthEnd, days });
  }

  return periods;
}
