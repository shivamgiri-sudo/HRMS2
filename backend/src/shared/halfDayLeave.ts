/**
 * Half-day leave rules, shared by the two places that decide what a half day does to a day.
 *
 * They must agree, and they are in different modules:
 *   - leave.service.ts   writes the day when a half-day leave is APPROVED
 *   - attendance-engine  rewrites the day every time it re-grades from punches
 *
 * If only the first knew these rules, a re-grade would quietly restore the day to
 * 'leave_approved' — which payroll pays at 1.0 — and undo the half day. That is exactly what
 * happened before this module existed, so the rules live here rather than in either caller.
 */

/**
 * Leave types a half day may be drawn from. Owner decision 2026-09-04: the half-day bucket is
 * CL+ML only — the same pair leave-policy.service.ts already pools and the same pair
 * checkMonthlyCapExceeded already caps together.
 */
export const HALF_DAY_LEAVE_CODES = new Set(["CL", "ML"]);

/**
 * What an approved HALF day does to that date's attendance, and therefore to pay.
 *
 * payrollCalculate.service.ts scores attendance for paid_base as present 1.0, late 1.0,
 * half_day 0.5, leave_approved 1.0, everything else 0. The target status IS the payroll
 * outcome, so there is no separate payroll change to make.
 *
 *   absent (pays 0)        -> half_day  : now pays 0.5
 *   missing_punch (pays 0) -> half_day  : now pays 0.5   (owner decision b)
 *   unreconciled (pays 0)  -> half_day  : now pays 0.5   (same family: unpaid, unresolved)
 *   no row at all          -> half_day  : now pays 0.5   (nothing recorded = nothing paid)
 *   half_day (pays 0.5)    -> present   : now pays 1.0   (owner decision a — half worked plus
 *                                          half leave is a whole paid day, and 'present' keeps
 *                                          attendance reporting honest instead of booking the
 *                                          WHOLE day as leave the way 'leave_approved' would)
 *
 * A day already worth a full day's pay is REFUSED rather than transitioned (owner decision c):
 * there is no half left to take, and quietly leaving it at 1.0 would spend half a day of CL/ML
 * balance for nothing.
 *
 * holiday and week_off never reach here — classifyLeaveDays excludes them from chargeableDates,
 * so no attendance row is written for them at all.
 */
export const HALF_DAY_ATTENDANCE_TRANSITION: Record<string, string> = {
  absent: "half_day",
  missing_punch: "half_day",
  unreconciled: "half_day",
  half_day: "present",
};

/**
 * Statuses already carrying a full day's pay, so a half day has nothing to add.
 *
 * Exactly the statuses payrollCalculate's paid_base scores at 1.0, and nothing else — if a status
 * is listed here it MUST already pay a full day, or we would be refusing leave on a day the
 * employee is not actually being paid for. 'week_off_worked' deliberately does NOT appear:
 * paid_base scores it 0, and a week-off date cannot reach this code anyway because
 * chargeableDates() returns only dates classified 'chargeable'.
 */
export const HALF_DAY_ALREADY_FULL = new Set(["present", "late", "leave_approved"]);

/**
 * Target attendance status for a half day landing on `existing`, or null when the day must be
 * refused. `existing` is null/empty when no attendance row exists for that date yet.
 *
 * Deliberately a pure function of the CURRENT worked status, never of the stored one, which is
 * what makes it idempotent: the attendance engine can re-grade the same day any number of times
 * and always land on the same answer, instead of bumping the day further on every run.
 */
export function halfDayAttendanceTarget(existing: string | null | undefined): string | null {
  const current = (existing ?? "").trim();
  if (!current) return "half_day";
  if (HALF_DAY_ALREADY_FULL.has(current)) return null;
  return HALF_DAY_ATTENDANCE_TRANSITION[current] ?? "half_day";
}

/** The lwp_value that belongs with a transitioned status, so the two can never disagree. */
export function halfDayLwpValue(status: string): number {
  return status === "half_day" ? 0.5 : 0;
}

/** The refusal message, in one place so submit-time and approval-time agree word for word. */
export function halfDayRefusalMessage(date: string, existing: string): string {
  return (
    `${date} is already a full paid day (${existing.replace(/_/g, " ")}), so a half day cannot be ` +
    `applied to it. Correct that day's attendance first if this is wrong.`
  );
}
