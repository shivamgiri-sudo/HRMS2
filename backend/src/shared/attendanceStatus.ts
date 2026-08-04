/**
 * Single source of truth for attendance status vocabulary.
 *
 * `attendance_daily_record.attendance_status` is an ENUM whose live values are:
 *   present, half_day, absent, leave_approved, holiday, week_off, unreconciled,
 *   missing_punch, week_off_worked
 *
 * Dashboard code had drifted away from that list in three ways, each producing a
 * silently wrong number rather than an error:
 *
 *   1. Counting `attendance_status = 'late'`. There is no 'late' member — lateness is
 *      the separate `late_mark` flag — so every "late arrivals" figure read 0 while
 *      ~500 late marks existed on the day.
 *   2. Excluding 'on_leave' / 'leave' from the expected-to-work denominator. Neither
 *      is a member; the real value is 'leave_approved', which was therefore counted as
 *      expected to work and depressed every attendance percentage.
 *   3. Counting only 'present' as present, omitting 'week_off_worked'.
 *
 * The employee self endpoint already used the correct definition; the org-wide metric
 * did not, so the same employee saw two different attendance percentages. Both now
 * import from here.
 */

/** Statuses that count as a full day worked. */
export const PRESENT_STATUSES = ["present", "week_off_worked"] as const;

/** Counted as half a day in the numerator. */
export const HALF_DAY_STATUS = "half_day" as const;

/** Approved absence. Not a failure to attend, and not expected to work. */
export const LEAVE_STATUSES = ["leave_approved", "on_leave", "leave"] as const;

/** Non-working days: nobody was expected to attend. */
export const NON_WORKING_STATUSES = ["holiday", "week_off"] as const;

/** Anomalies that need operational follow-up. */
export const EXCEPTION_STATUSES = ["absent", "missing_punch", "unreconciled"] as const;

/**
 * Excluded from the attendance-rate denominator: non-working days plus approved leave.
 * Keeping 'on_leave'/'leave' here is harmless (they are not live ENUM members) and
 * tolerant of the ENUM being widened later.
 */
export const EXPECTED_TO_WORK_EXCLUSIONS = [
  ...NON_WORKING_STATUSES,
  ...LEAVE_STATUSES,
] as const;

/**
 * Live session states, from `wfm_attendance_session.current_status`.
 *
 * A different column with a different vocabulary from `attendance_status` above, and
 * it had drifted the same way. Three call sites matched
 * `IN ('Logged In','Active','Login','Rostered')`, and a fourth used a shorter list
 * with different capitalisation. Counted against production:
 *
 *   Logged Out  25,409
 *   Partial      8,872
 *   Logged In    1,177
 *
 * Only one of the four literals occurs at all. 'Active', 'Login' and 'Rostered' are
 * invented; 'Partial' — the second most common state, someone who punched in and is
 * mid-shift — was never counted as present.
 *
 * The effect was not subtle: the branch snapshot counted 213 present where 355 people
 * had a live session, so `present_pct` collapsed and the dashboard's `pct >= 70` test
 * marked *every* branch "Warning".
 */
export const PRESENT_SESSION_STATUSES = ["Logged In", "Partial"] as const;

/** Every value `current_status` actually holds — asserts code never invents one. */
export const ALL_SESSION_STATUSES = ["Logged In", "Partial", "Logged Out"] as const;

/** Every status the live ENUM accepts — used to assert code never invents a value. */
export const ALL_ATTENDANCE_STATUSES = [
  "present",
  "half_day",
  "absent",
  "leave_approved",
  "holiday",
  "week_off",
  "unreconciled",
  "missing_punch",
  "week_off_worked",
] as const;

/**
 * Scalar subquery yielding the most recent attendance day that is actually worth
 * reporting on.
 *
 * Anchoring on CURDATE() is wrong here: processed attendance trails real time, so
 * "today" is typically a partially-written day (45 rows against ~1,340 employees) and
 * the day after that often holds a single stray row. Reading either produces a
 * confident 0% attendance that looks like a broken panel.
 *
 * The rule picks the latest day within a 14-day window whose row count is at least
 * half the busiest day in that window — i.e. the last substantially-processed day —
 * and **excludes today**.
 *
 * Excluding today matters, and a row-count threshold alone does not achieve it: rows for
 * the current day are created at start-of-day, before any punch is reconciled. On
 * 2026-07-30 at 15:00 the day held 802 rows (comfortably over the threshold) of which
 * 1 was `present` and 431 were `missing_punch`, against 631 present and 4 missing_punch
 * for the completed day before it. So the count test admitted the in-progress day and
 * every attendance tile read ~0% present until the nightly reconciliation caught up.
 *
 * A "looks reconciled" test — say, rejecting days above some missing_punch share — was
 * rejected deliberately: 2026-07-27 genuinely has 665 missing punches out of 1,342, and
 * that is real operational badness the tile must show rather than skip past.
 *
 * Callers should surface the resolved date so the tile can label itself "as of <date>".
 */
export const LATEST_COMPLETE_ATTENDANCE_DATE_SQL = `(
  SELECT d.record_date
    FROM (
      SELECT record_date, COUNT(*) AS n
        FROM attendance_daily_record
       WHERE record_date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
         AND record_date < CURDATE()
       GROUP BY record_date
    ) d
    CROSS JOIN (
      SELECT MAX(n) AS mx FROM (
        SELECT COUNT(*) AS n
          FROM attendance_daily_record
         WHERE record_date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
           AND record_date < CURDATE()
         GROUP BY record_date
      ) x
    ) m
   WHERE d.n >= m.mx * 0.5
   ORDER BY d.record_date DESC
   LIMIT 1
)`;

/** Renders a status list as a SQL IN(...) literal set. Values are code-controlled. */
export function statusList(statuses: readonly string[]): string {
  return statuses.map((s) => `'${s}'`).join(", ");
}

/** `SUM(CASE WHEN ... )` fragment counting full-day attendance. */
export function presentSql(column = "attendance_status"): string {
  return `SUM(CASE WHEN ${column} IN (${statusList(PRESENT_STATUSES)}) THEN 1 ELSE 0 END)`;
}

/** Numerator for an attendance rate: full days plus half credit for half days. */
export function attendedDaysSql(column = "attendance_status"): string {
  return `(${presentSql(column)} + SUM(CASE WHEN ${column} = '${HALF_DAY_STATUS}' THEN 0.5 ELSE 0 END))`;
}

/** Denominator for an attendance rate: rows where attendance was expected. */
export function expectedToWorkSql(column = "attendance_status"): string {
  return `COUNT(CASE WHEN ${column} NOT IN (${statusList(EXPECTED_TO_WORK_EXCLUSIONS)}) THEN 1 END)`;
}
