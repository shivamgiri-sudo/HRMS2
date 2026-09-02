/**
 * Monthly attendance day-count arithmetic — A / P / OD / HD / L / H / W / SalDays.
 *
 * WHY THIS FILE EXISTS
 * These four pieces used to live inline inside attendanceRegisterMonthly() in
 * reporting/executors/attendance.executor.ts, which was the only screen that showed them. The
 * cost-centre attendance finalization screen (payroll-cc-attendance.service.ts) shows the same
 * eight columns for the same employees in the same month, and Payroll HR signs off on them — so
 * a second copy of this arithmetic would be a second opinion on what a month's attendance is,
 * and the two would drift exactly as the week-off rule already drifted once (see the long note
 * above attendanceRegisterMonthly, where the register's private copy of the slab table paid a
 * week-off payroll did not).
 *
 * Extracted verbatim: same status map, same fill rule, same paid-base and sal-days formulas.
 * The register's own comments explaining WHY each rule is what it is are carried across with it.
 *
 * Week-off eligibility is NOT here. There is one engine for it — calculateWeekoffEligibility()
 * in payroll/weekoff-eligibility.service.ts — and both callers call that directly.
 *
 * Nothing in this file reads or writes the database, and nothing here is part of salary
 * calculation: payrollCalculate.service.ts has its own paid-days path and is untouched.
 */

/**
 * Attendance status → single-letter register code.
 *
 * missing_punch = no biometric record for the date → Absent.
 * week_off_worked = employee worked on their week-off day → Present (the attendance engine sets
 *   half_day when hours < threshold on any day, so week_off_worked always represents a full day
 *   worked on week off).
 * unreconciled = anomalous punch data → Absent (same as legacy).
 */
export const ATTENDANCE_STATUS_CODE: Record<string, string> = {
  present:         "P",
  absent:          "A",
  half_day:        "HD",
  week_off:        "A",
  holiday:         "H",
  leave_approved:  "L",
  on_duty:         "OD",
  missing_punch:   "A",
  week_off_worked: "P",
  unreconciled:    "A",
};

export type DayCounts = {
  absent: number;
  present: number;
  od: number;
  hd: number;
  leave: number;
  holiday: number;
};

/**
 * What a day cell holds when there is no attendance record for it.
 *
 * Blank only for pre-joining dates and future dates. Every other date with no record is Absent.
 * Week-off days are NOT synthesised here — they come from real attendance_daily_record rows with
 * status week_off, which the status map already sends to "A".
 */
export function resolveMissingDayCell(dayDate: Date, dateOfJoining: Date | null, today: Date): string {
  if (dateOfJoining && dayDate < dateOfJoining) return ""; // before joining date → blank
  if (dayDate > today) return "";                          // future date → blank
  return "A";                                              // no record for an active date → absent
}

/** Tally the filled day cells for one employee. `getCell(d)` returns the code for day d (1-based). */
export function countDayCodes(getCell: (day: number) => string, daysInMonth: number): DayCounts {
  const counts: DayCounts = { absent: 0, present: 0, od: 0, hd: 0, leave: 0, holiday: 0 };
  for (let d = 1; d <= daysInMonth; d++) {
    const v = getCell(d);
    if      (v === "A")  counts.absent++;
    else if (v === "P")  counts.present++;
    else if (v === "OD") counts.od++;
    else if (v === "HD") counts.hd++;
    else if (v === "L")  counts.leave++;
    else if (v === "H")  counts.holiday++;
  }
  return counts;
}

/** Paid base, the input calculateWeekoffEligibility() expects: a half-day earns half a day. */
export function computePaidBase(counts: DayCounts): number {
  return counts.present + counts.hd * 0.5 + counts.od;
}

/**
 * Salary days, capped at the length of the month.
 *
 * Week-offs are credited on top of paid days, and an employee who worked every day of the month —
 * including their week-offs — still earns the week-off entitlement (a worked Sunday is paid AND
 * counts toward entitlement). Added together that produced sal_days above the calendar month:
 * 31 present + 5 week-offs = 36 in a 31-day August, on 15 rows of the live August register.
 * Salary days can never exceed the days that exist to be paid for, so the sum is a ceiling.
 */
export function computeSalDays(
  paidBase: number,
  eligibleWeekoffs: number,
  holidayCount: number,
  daysInMonth: number
): number {
  const raw = paidBase + eligibleWeekoffs + holidayCount;
  return Math.round(Math.min(raw, daysInMonth) * 100) / 100;
}

/**
 * Total working days, UNCAPPED — the same raw sum computeSalDays() ceilings at daysInMonth,
 * returned as-is so it can legitimately exceed the calendar month.
 *
 * This exists to answer a different question than sal_days does: sal_days is what payroll pays
 * for (never more than the month has days to pay for), while this is how much the employee
 * actually worked, including days worked on top of the month's normal capacity — e.g. every
 * week-off worked. An employee who worked all 31 days of a 31-day month plus 5 week-offs shows
 * sal_days capped at 31 but total_working_days at 36, which is the only way the register
 * surfaces who put in genuinely extra days.
 */
export function computeTotalWorkingDays(
  paidBase: number,
  eligibleWeekoffs: number,
  holidayCount: number
): number {
  return Math.round((paidBase + eligibleWeekoffs + holidayCount) * 100) / 100;
}
