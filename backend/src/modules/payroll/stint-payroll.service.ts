/**
 * Rejoin v3 plan 3c — stint-aware payroll: the feature flag reader and the per-run stint loader the
 * payroll calculator uses. Default OFF; when off, the calculator never calls loadStintScopes.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { payableThrough } from "./employment-end-date.js";
import { stintEmploymentSummary, type Stint, type StintSummary } from "./stint-window.js";

export const STINT_PAYROLL_FLAG_KEY = "rejoin_stint_payroll_enabled";

/** Ids bound per query, so a very large run never builds one statement with thousands of placeholders. */
const ID_CHUNK = 1000;

interface Executor {
  execute<T extends RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

/** Default OFF: a missing row, a non-'true' value or ANY read error means the flag is off. */
export async function isStintPayrollEnabled(exec: Executor = db as unknown as Executor): Promise<boolean> {
  try {
    const [rows] = await exec.execute<RowDataPacket[]>(
      `SELECT config_value FROM payroll_config_flags WHERE branch_id IS NULL AND process_id IS NULL AND config_key = ? LIMIT 1`,
      [STINT_PAYROLL_FLAG_KEY],
    );
    if (!rows.length) return false;
    return String(rows[0]!.config_value).trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

export interface StintScope extends StintSummary {
  stints: Stint[];
}

/**
 * Stint scope for the employees of a run who have employment_stint rows (that is, rejoiners — stint 1 is only
 * ever written together with stint 2). Employees with no rows are NOT in the map and follow the unchanged
 * payroll path. ALL of an employee's stints are loaded, not just the ones overlapping the month: merging and
 * clamping happen in stintEmploymentSummary, and a month wholly inside the gap must still be recognised as
 * "a rejoiner with zero employed days" rather than "an employee with no stints".
 *
 * employmentEndByEmployee carries the calculator's resolved Last Working Day (employment_end_date). The open
 * stint has no end_date until a NEXT rejoin closes it, so a rejoiner who resigns again would otherwise be
 * measured to month end; capping at payableThrough() keeps the same leaver bound the flag-off path applies.
 */
export async function loadStintScopes(
  employeeIds: string[],
  monthStart: string,
  monthEnd: string,
  salaryStartByEmployee: Map<string, string | null>,
  employmentEndByEmployee: Map<string, string | null> = new Map(),
  exec: Executor = db as unknown as Executor,
): Promise<Map<string, StintScope>> {
  const out = new Map<string, StintScope>();
  if (employeeIds.length === 0) return out;

  const byEmployee = new Map<string, Stint[]>();
  for (let i = 0; i < employeeIds.length; i += ID_CHUNK) {
    const chunk = employeeIds.slice(i, i + ID_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const [rows] = await exec.execute<RowDataPacket[]>(
      `SELECT employee_id,
              DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
              DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
         FROM employment_stint
        WHERE employee_id IN (${placeholders})
        ORDER BY employee_id, stint_no`,
      chunk,
    );
    for (const r of rows) {
      const id = String(r.employee_id);
      const list = byEmployee.get(id) ?? [];
      list.push({ startDate: String(r.start_date), endDate: r.end_date ?? null });
      byEmployee.set(id, list);
    }
  }

  for (const [id, stints] of byEmployee) {
    const through = payableThrough(employmentEndByEmployee.get(id) ?? null, monthEnd);
    const summary = stintEmploymentSummary(stints, monthStart, through, salaryStartByEmployee.get(id) ?? null);
    out.set(id, { ...summary, stints });
  }
  return out;
}
