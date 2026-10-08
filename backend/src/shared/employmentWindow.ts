// The ONE answer to "was this person employed on this date?" for attendance writes.
//
// Rule (owner, 2026-10-05): attendance exists only from the salary start date to the exit date.
// Before this, every attendance writer checked at most "is the employee active today" or
// employees.date_of_exit, never the date itself against the employment window. So:
//   - a resignation whose last working day had passed but was not yet marked exited (date_of_exit
//     NULL, still active) kept getting nightly absent / present rows;
//   - punches, APR, roster imports, leave and regularizations landing after the exit date wrote rows;
//   - on rejoin, date_of_exit is cleared, so the whole gap between exit and rejoin looked employed.
//
// Windows:
//   - Employee with employment_stint rows (has rejoined): each stint [start_date, end_date]; the open
//     stint ends at the currently resolved end date (a new resignation), else open-ended. The gap
//     between stints is NOT employed.
//   - Otherwise: [COALESCE(salary_start_date, date_of_joining), resolved end date], where the end date
//     is payroll's EMPLOYMENT_END_DATE_SQL (date_of_exit, else the accepted / notice-serving / exited LWD,
//     then date_of_leaving). A missing bound is open.
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { EMPLOYMENT_END_DATE_SELECT, EMPLOYMENT_END_DATE_SQL } from "../modules/payroll/employment-end-date.js";

export type Window = { from: string | null; to: string | null };

/** Pure: the employment windows for one employee. */
export function employmentWindows(input: {
  salaryStartDate: string | null;
  dateOfJoining: string | null;
  endDate: string | null;
  stints: Array<{ start: string; end: string | null }>;
}): Window[] {
  if (input.stints.length) {
    return input.stints.map((s) => ({ from: s.start, to: s.end ?? input.endDate }));
  }
  return [{ from: input.salaryStartDate ?? input.dateOfJoining, to: input.endDate }];
}

/** Pure: is `date` (YYYY-MM-DD) inside any window. */
export function isWithinWindows(date: string, windows: Window[]): boolean {
  return windows.some((w) => (!w.from || date >= w.from) && (!w.to || date <= w.to));
}

/**
 * Employment windows for many employees at once. An employee id with no employees row gets no entry
 * (callers treat that as "not proven outside": the FK on attendance_daily_record rejects it anyway).
 * Plain placeholders + execute, so it behaves the same under every db mock in the test suite.
 */
export async function loadEmploymentWindows(employeeIds: string[]): Promise<Map<string, Window[]>> {
  const out = new Map<string, Window[]>();
  const ids = [...new Set(employeeIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const ph = chunk.map(() => "?").join(",");
    const [emps] = await db.execute<RowDataPacket[]>(
      `SELECT e.id,
              DATE_FORMAT(e.salary_start_date, '%Y-%m-%d') AS salary_start_date,
              DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS date_of_joining,
              ${EMPLOYMENT_END_DATE_SELECT} AS end_date
         FROM employees e WHERE e.id IN (${ph})`,
      chunk,
    );
    let stintRows: RowDataPacket[] = [];
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, DATE_FORMAT(start_date, '%Y-%m-%d') AS s, DATE_FORMAT(end_date, '%Y-%m-%d') AS en
           FROM employment_stint WHERE employee_id IN (${ph}) ORDER BY employee_id, stint_no`,
        chunk,
      );
      stintRows = (rows ?? []) as RowDataPacket[];
    } catch {
      // employment_stint missing in this environment: nobody has rejoined, single window for all.
    }
    const stints = new Map<string, Array<{ start: string; end: string | null }>>();
    for (const r of stintRows) {
      const list = stints.get(String(r.employee_id)) ?? [];
      list.push({ start: String(r.s), end: r.en ? String(r.en) : null });
      stints.set(String(r.employee_id), list);
    }
    for (const e of (emps ?? []) as RowDataPacket[]) {
      if (!e || e.id === undefined) continue;
      out.set(String(e.id), employmentWindows({
        salaryStartDate: e.salary_start_date ? String(e.salary_start_date) : null,
        dateOfJoining: e.date_of_joining ? String(e.date_of_joining) : null,
        endDate: e.end_date ? String(e.end_date) : null,
        stints: stints.get(String(e.id)) ?? [],
      }));
    }
  }
  return out;
}

/** False only when the employee is known AND `date` is outside every employment window. */
export async function isEmployedOn(employeeId: string, date: string): Promise<boolean> {
  const windows = (await loadEmploymentWindows([employeeId])).get(employeeId);
  return windows ? isWithinWindows(String(date).slice(0, 10), windows) : true;
}

/** Splits (employee, date) items into those inside and outside the employment window. */
export async function partitionByEmployment<T>(
  items: T[],
  employeeIdOf: (t: T) => string,
  dateOf: (t: T) => string,
): Promise<{ inside: T[]; outside: T[] }> {
  const windows = await loadEmploymentWindows(items.map(employeeIdOf));
  const inside: T[] = [];
  const outside: T[] = [];
  for (const t of items) {
    const w = windows.get(employeeIdOf(t));
    (!w || isWithinWindows(String(dateOf(t)).slice(0, 10), w) ? inside : outside).push(t);
  }
  return { inside, outside };
}

/** Message used by routes that refuse a write outside the window. */
export const OUTSIDE_EMPLOYMENT_MESSAGE =
  "This date is outside the employee's employment period (salary start date to exit date); attendance cannot be recorded for it.";

/**
 * SQL predicate: the attendance row `adrRef` (an alias, or the table name when the query has no alias)
 * falls inside its employee's employment window - the same rule as employmentWindows() above.
 * Used by every payroll / salary-days / F&F attendance read, so a row written outside the window
 * (before the salary start date, after the exit date, or in a rejoiner's gap) is never counted for pay.
 * Self-contained: binds no parameters, correlates on `${adrRef}.employee_id` / `${adrRef}.record_date`.
 */
export function attendanceInEmploymentWindowSql(adrRef: string): string {
  const d = `${adrRef}.record_date`;
  const end = EMPLOYMENT_END_DATE_SQL;
  return `EXISTS (
    SELECT 1 FROM employees e
     WHERE e.id = ${adrRef}.employee_id
       AND (
         (NOT EXISTS (SELECT 1 FROM employment_stint st0 WHERE st0.employee_id = e.id)
           AND ${d} >= COALESCE(e.salary_start_date, e.date_of_joining, ${d})
           AND ${d} <= COALESCE(${end}, ${d}))
         OR EXISTS (SELECT 1 FROM employment_stint st
                     WHERE st.employee_id = e.id
                       AND ${d} >= st.start_date
                       AND ${d} <= COALESCE(st.end_date, ${end}, ${d}))
       )
  )`;
}
