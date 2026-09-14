/**
 * Time-of-day parsing for attendance surfaces.
 *
 * DELIBERATELY DEPENDENCY-FREE. These functions are the single source of truth
 * for turning whatever the attendance APIs return into a displayable time, and
 * they are unit-tested directly (backend/tests/timeOfDay.test.ts) — which is
 * only possible because this module imports nothing. Do not add imports here;
 * put anything that needs date-fns/clsx in utils.ts instead.
 *
 * Background: the attendance hub rendered punches with `value.slice(0, 5)`.
 * The API returns clock_in/clock_out as IST-tagged datetimes, so
 * "2026-07-29T09:15:00+05:30" displayed as "2026-" — the year alone — in both
 * the Login and Logout columns. Every attendance surface now routes through
 * extractTimeOfDay so that class of bug cannot reappear.
 */

export interface TimeOfDay {
  /** Hours as written. May exceed 23 for MySQL TIME night-shift values. */
  hours: number;
  minutes: string;
  seconds: string;
}

/**
 * Pull the time-of-day out of ANY shape the attendance APIs return:
 *   - bare MySQL TIME      "09:15:00"                  (APR Login_Time/Logout_Time)
 *   - MySQL DATETIME       "2026-07-29 09:15:00"
 *   - IST-tagged ISO       "2026-07-29T09:15:00+05:30" (toIST() output)
 *
 * Returns null when the value carries no usable time, so callers can pick their
 * own fallback rather than rendering something misleading.
 */
export function extractTimeOfDay(value?: string | null): TimeOfDay | null {
  if (!value) return null;
  const s = String(value).trim();
  // Datetime (space- or T-separated): take the time component after the date.
  const dt = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):([0-5]\d)(?::([0-5]\d))?/.exec(s);
  if (dt) return { hours: Number(dt[1]), minutes: dt[2], seconds: dt[3] ?? "00" };
  // Bare TIME — may exceed 24h on night shifts (e.g. "27:30:00").
  const t = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(s);
  if (t) return { hours: Number(t[1]), minutes: t[2], seconds: t[3] ?? "00" };
  return null;
}

/** 24-hour "HH:MM" from any shape above. Hours past midnight wrap (27:30 -> 03:30). */
export function formatTime24(value?: string | null, fallback = "—"): string {
  const t = extractTimeOfDay(value);
  if (!t) return fallback;
  return `${String(t.hours % 24).padStart(2, "0")}:${t.minutes}`;
}

/**
 * 12-hour "h:mm AM/PM" from any shape above.
 *
 * Never pass a bare MySQL TIME to `new Date()` — it yields Invalid Date, which
 * is what made the APR login/logout columns render blank.
 */
export function formatClockTime(value?: string | null, fallback = "--:--"): string {
  const t = extractTimeOfDay(value);
  if (!t) return fallback;
  const hours24 = t.hours % 24;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  return `${hours24 % 12 || 12}:${t.minutes} ${suffix}`;
}

/** Minutes since midnight, or null when there is no usable time. */
export function minutesOfDay(value?: string | null): number | null {
  const t = extractTimeOfDay(value);
  if (!t) return null;
  return (t.hours % 24) * 60 + Number(t.minutes);
}

/**
 * Convert a MySQL TIME *duration* ("HH:MM:SS", may exceed 24h) to whole minutes.
 * Used for APR `Net_Login`, which is a duration stored as TIME — so hours are
 * NOT wrapped here, unlike the clock-time helpers above.
 */
export function clockTimeToMinutes(value?: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(String(value).trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + Math.round(Number(m[3] ?? 0) / 60);
}

/** Format a minute count as "8h 20m". Shared by attendance/APR/report surfaces. */
export function formatDuration(minutes?: number | null): string {
  if (minutes == null || !Number.isFinite(Number(minutes))) return "--";
  const total = Math.max(0, Math.round(Number(minutes)));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
