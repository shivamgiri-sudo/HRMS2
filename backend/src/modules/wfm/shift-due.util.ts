/**
 * Shared "has this shift's start time + grace period actually arrived yet" guard.
 *
 * A roster row with no clock-in has no measurable outcome until its shift is actually
 * due — reading it as an absence the instant the row exists means a branch whose
 * shifts start at, say, 19:00 shows 100% shrinkage all afternoon, before a single
 * person is even due in. This guard was duplicated 3x with subtly different "today"/
 * "now" computations (roster-analytics.service.ts's getWeeklyShrinkageIntelligence,
 * roster-intelligence.service.ts's generateSingleManagerDigest and
 * generateBranchDashboard) before being extracted here as part of the WFM Roster
 * Console merge Phase C (2026-09-12).
 *
 * IMPORTANT date handling: uses LOCAL Date getters (getFullYear/getMonth/getDate/
 * getHours/getMinutes), never toISOString(). The production host's OS clock reads IST
 * directly, but toISOString() always converts to UTC regardless of host timezone —
 * using it to compute "today" or "now" misclassifies roughly the last 5.5 hours of
 * the UTC day (i.e. the first 5.5 hours of the IST day, 00:00-05:30 IST) as still
 * being "yesterday". Two of the three original call sites (both in
 * roster-intelligence.service.ts, via their pre-existing UTC-based todayDate()
 * helper) had exactly this bug; this extraction fixes both as a side effect of
 * sharing the already-correct local-getter logic roster-analytics.service.ts used
 * (fixed 2026-09-11 for the "100% shrinkage before shift starts" bug). A narrow,
 * genuine improvement — not a regression — carried along with the refactor.
 */

export function timeToMinutesLocal(t: string): number {
  const parts = t.split(':').map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

export function todayLocalDateStr(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function currentMinutesOfDayLocal(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Returns true once a shift scheduled on `rosterDate` starting at `shiftStartTime`
 * (HH:MM or HH:MM:SS) has reached its start time + grace period, as of `now`
 * (defaults to the real current time) — i.e. true means "safe to treat a missing
 * clock-in as a real absence now". Always true for any date other than today, since
 * a past roster date's shift has necessarily already started by the time it's
 * queried, and always true when there's no shift start time on record (nothing to
 * compute a "not yet due" window from).
 */
export function isShiftDueYet(
  shiftStartTime: string | null | undefined,
  rosterDate: string,
  graceMinutes = 5,
  now: Date = new Date()
): boolean {
  if (!shiftStartTime) return true;
  if (rosterDate !== todayLocalDateStr(now)) return true;
  const shiftStartMinutes = timeToMinutesLocal(String(shiftStartTime));
  const nowMinutes = currentMinutesOfDayLocal(now);
  return nowMinutes >= shiftStartMinutes + graceMinutes;
}
