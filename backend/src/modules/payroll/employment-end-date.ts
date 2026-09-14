/**
 * The ONE definition of when an employee's employment ended, for payroll purposes.
 *
 * Owner ruling 2026-08-16 (decision 1): Last Working Day is the business source of truth, and
 * `employees.date_of_leaving` must stop being the payroll eligibility field.
 *
 * PRECEDENCE
 *   1. A qualifying Exit/Resignation LWD —
 *      COALESCE(last_working_day_confirmed, last_working_day_proposed), and ONLY for a
 *      resignation in accepted / notice_serving / exited. A submitted, rejected or revoked
 *      request is explicitly not an end of employment: someone who withdrew their resignation
 *      must keep being paid.
 *   2. employees.date_of_exit — the persisted employee-master value and the historical fallback.
 *   3. employees.date_of_leaving — legacy, honoured only where actually populated.
 *
 * WHY THIS EXISTS
 * Payroll selected on `date_of_leaving`, which is NULL on all 58,840 employee rows — no write
 * path has ever populated it. So the leaver bound was inert, and the only thing excluding
 * leavers was `LOWER(employment_status) = 'active'`. That is a different question from "were
 * they employed during this month", and it produced errors in both directions:
 *
 *   - A mid-month leaver whom HR had already marked resigned vanished from the run entirely
 *     and was paid nothing for days they had worked.
 *   - Someone whose exit date was months ago but whose status had not been updated stayed in
 *     the run and was paid to month end. Measured live: 93 such employees for 2026-08.
 *
 * THE END-DATE-NULL RULE IS LOAD-BEARING
 * Simply dropping the status filter is not the fix. 28,425 non-active employees have no
 * resolvable end date at all — 28,203 of the 30,318 marked "Resigned" among them — so a
 * predicate keyed only on the window would admit every one of them. Where no end date
 * resolves, employment cannot be proven, and only `employment_status = 'active'` keeps the
 * employee in. Verified live: that combination admits ZERO of the 28,425.
 *
 * Measured effect of switching to this resolver:
 *   2026-07   1,255 -> 1,327   (+ mid-month leavers marked resigned/terminated, - 4 who left before)
 *   2026-08   1,326 -> 1,233   (- the 93 who had already left)
 */

/**
 * Resolves the employment end date. Expects the `employees` table aliased as `e`.
 *
 * Correlated subquery rather than a JOIN: an employee can hold more than one exit_request, and
 * joining would multiply the employee row and corrupt every aggregate built on top of it.
 */
export const EMPLOYMENT_END_DATE_SQL = `
  COALESCE(
    (SELECT COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed)
       FROM exit_request x
      WHERE x.employee_id = e.id
        AND LOWER(x.status) IN ('accepted','notice_serving','exited')
      ORDER BY COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed) DESC
      LIMIT 1),
    e.date_of_exit,
    e.date_of_leaving
  )`;

/**
 * Selected as a plain 'YYYY-MM-DD' string, never a DATE.
 *
 * mysql2 hands a DATE back as a JS Date in the host timezone, and this codebase has a
 * documented history of a local Date read back as UTC shifting the day — which on a leaver
 * bound is the difference between a paid and an unpaid final day. Formatting in SQL keeps the
 * value a string from end to end.
 */
export const EMPLOYMENT_END_DATE_SELECT = `DATE_FORMAT(${EMPLOYMENT_END_DATE_SQL}, '%Y-%m-%d')`;

/**
 * Who belongs in a run. Takes two bind parameters, both the run month as 'YYYY-MM': the first
 * closes the joining window, the second opens the leaving window.
 *
 * Reads as: employed by the end of the month, and either still employed into it, or — where no
 * end date exists to judge by — currently active.
 *
 * Deliberately NOT filtered on employment_status alone. A mid-month leaver is included and
 * prorated through their LWD even though HR has already changed their status, which is the
 * whole point of the ruling.
 */
export function employmentWindowPredicate(): string {
  return `
    COALESCE(e.salary_start_date, e.date_of_joining) <= LAST_DAY(CONCAT(?, '-01'))
    AND (
      ${EMPLOYMENT_END_DATE_SQL} >= CONCAT(?, '-01')
      OR (${EMPLOYMENT_END_DATE_SQL} IS NULL AND LOWER(e.employment_status) = 'active')
    )`;
}

/**
 * The last date of the month this employee should be paid through.
 *
 * Pure string comparison on 'YYYY-MM-DD', so it is timezone-independent by construction. An end
 * date after the month end means they worked the whole month; before the month start should
 * never reach here, because the selection predicate excludes it.
 */
export function payableThrough(
  employmentEndDate: string | null | undefined,
  monthEnd: string,
): string {
  const end = String(employmentEndDate ?? "").slice(0, 10);
  if (!end) return monthEnd;
  return end < monthEnd ? end : monthEnd;
}
