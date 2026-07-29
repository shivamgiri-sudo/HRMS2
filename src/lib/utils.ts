import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { parseISO, isValid } from "date-fns";

/**
 * Normalize a date string before JS Date/parseISO parsing.
 * "YYYY-MM-DD" strings are treated as UTC midnight by default, which shifts
 * the rendered date one day back in UTC+ timezones (e.g. IST).
 * Appending T00:00:00 (no Z) forces local-time interpretation.
 */
export function normalizeDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? `${value.trim()}T00:00:00`
    : value;
}

/** Parse a date-only or full ISO string as local time (no UTC shift). */
export function parseLocalDate(value: string): Date {
  return parseISO(normalizeDate(value));
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format date string to standardized display format
 * Handles ISO strings (2026-05-09T18:30:00.000Z) and date-only strings (2026-05-09)
 * @param dateString - ISO date string or date-only string
 * @param formatString - date-fns format string (default: "MMM d, yyyy")
 * @returns Formatted date string (e.g., "May 9, 2026")
 */
export function formatDate(dateString: string | null | undefined, _formatString: string = "MMM d, yyyy"): string {
  if (!dateString) return "";

  try {
    const normalised = normaliseToIST(dateString);
    const date = typeof normalised === "string" ? parseISO(normalised) : normalised;

    if (!isValid(date)) {
      return dateString;
    }

    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (error) {
    console.error("Date formatting error:", error);
    return dateString;
  }
}

/**
 * Format datetime string to standardized display format with time
 * @param dateString - ISO datetime string
 * @returns Formatted datetime string (e.g., "May 9, 2026 at 6:30 PM")
 */
export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return "";

  try {
    const normalised = normaliseToIST(dateString);
    const date = typeof normalised === "string" ? parseISO(normalised) : normalised;

    if (!isValid(date)) {
      return dateString;
    }

    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch (error) {
    console.error("DateTime formatting error:", error);
    return dateString;
  }
}

/** Normalise a raw MySQL DATETIME string ("YYYY-MM-DD HH:mm:ss") to an
 *  unambiguous ISO 8601 string tagged as IST (+05:30) so parseISO does not
 *  treat it as local-browser or UTC time. Already-tagged strings pass through. */
function normaliseToIST(date: Date | string): Date | string {
  if (typeof date !== "string") return date;
  const s = date.trim();
  // "YYYY-MM-DD HH:mm:ss" — MySQL DATETIME, no timezone info
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return s.replace(" ", "T") + "+05:30";
  }
  // "YYYY-MM-DDTHH:mm:ss" — naive ISO, treat as IST wall-clock
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) {
    return s + "+05:30";
  }
  return s;
}

/** Format date/time for display in IST timezone (never UTC) */
export function formatIST(
  date: Date | string | null | undefined,
  fmt: string = "MMM d, yyyy h:mm a"
): string {
  if (!date) return "";

  try {
    const normalised = normaliseToIST(date);
    const d = typeof normalised === "string" ? parseISO(normalised) : normalised;
    if (!isValid(d)) return String(date);

    // Use Intl API with Asia/Kolkata timezone for consistent IST display
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return String(date);
  }
}

/**
 * Format a bare MySQL TIME value ("HH:MM:SS") as a 12-hour clock time.
 *
 * APR / dialler rows (`apr.Login_Time`, `apr.Logout_Time`) are MySQL TIME
 * columns, returned by mysql2 as plain strings with no date part. Passing one
 * to `new Date()` yields `Invalid Date`, which is why these columns previously
 * rendered blank. Parse the string directly instead — never via Date.
 *
 * MySQL TIME legitimately exceeds 24h on night shifts (e.g. "27:30:00"),
 * so hours are wrapped rather than rejected.
 */
export function formatClockTime(value?: string | null, fallback = "--:--"): string {
  const t = extractTimeOfDay(value);
  if (!t) return fallback;
  const hours24 = t.hours % 24;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  return `${hours24 % 12 || 12}:${t.minutes} ${suffix}`;
}

/**
 * Pull the time-of-day out of ANY shape the attendance APIs return:
 *   - bare MySQL TIME      "09:15:00"                  (APR Login_Time/Logout_Time)
 *   - MySQL DATETIME       "2026-07-29 09:15:00"
 *   - IST-tagged ISO       "2026-07-29T09:15:00+05:30" (toIST() output)
 *
 * This exists because a naive `value.slice(0, 5)` renders an ISO datetime as
 * "2026-" — the year and nothing else — which is what made the login/logout
 * columns look blank. Always go through this helper.
 */
export function extractTimeOfDay(
  value?: string | null
): { hours: number; minutes: string; seconds: string } | null {
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

/** 24-hour "HH:MM" from any of the shapes above. */
export function formatTime24(value?: string | null, fallback = "—"): string {
  const t = extractTimeOfDay(value);
  if (!t) return fallback;
  return `${String(t.hours % 24).padStart(2, "0")}:${t.minutes}`;
}

/**
 * Convert a MySQL TIME duration ("HH:MM:SS", may exceed 24h) to whole minutes.
 * Used for APR `Net_Login`, which is a duration stored as TIME.
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

/** Format time only in IST (HH:MM AM/PM) */
export function formatISTTime(
  date: Date | string | null | undefined,
  showSeconds = false
): string {
  if (!date) return "";

  try {
    const normalised = normaliseToIST(date);
    const d = typeof normalised === "string" ? parseISO(normalised) : normalised;
    if (!isValid(d)) return String(date);

    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: showSeconds ? "2-digit" : undefined,
      hour12: true,
    });
  } catch {
    return String(date);
  }
}

/** Format date only in IST (MMM d, yyyy) */
export function formatISTDate(
  date: Date | string | null | undefined
): string {
  if (!date) return "";

  try {
    const normalised = normaliseToIST(date);
    const d = typeof normalised === "string" ? parseISO(normalised) : normalised;
    if (!isValid(d)) return String(date);

    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(date);
  }
}
