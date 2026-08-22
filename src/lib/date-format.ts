/**
 * Shared DD-MM-YYYY date-display formatting.
 *
 * Display formatting only — this never touches a date VALUE stored in state or sent to the
 * backend, only how a date renders as text. Native `<input type="date">` widgets are
 * browser-controlled and out of scope for this file.
 */

/**
 * Parses a date string/Date, tolerant of MySQL's "YYYY-MM-DD HH:MM:SS" (which Safari refuses to
 * parse without the space→T fix — same fix grn-format.ts's dateLabel/dateTimeLabel already use).
 *
 * Accepts an already-parsed `Date` as-is (return it unchanged rather than round-tripping it
 * through `String(date)` — `Date#toString()` produces a space-separated form like
 * "Thu Aug 20 2026 00:00:00 GMT+0530 (India Standard Time)", and replacing only its first space
 * with "T" turns it into an unparseable string, silently producing an Invalid Date). This matters
 * because `formatDateTimeDDMMYYYY` below calls `formatDateDDMMYYYY` with an already-parsed Date.
 */
function parseFlexibleDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** DD-MM-YYYY. No dayjs/moment in this repo's dependencies used for this — manual padding is
 *  enough and avoids adding a new date library for a 10-line function. Returns the given
 *  `fallback` (default "—") for a missing/unparseable value, matching grn-format.ts's dateLabel()
 *  convention. */
export function formatDateDDMMYYYY(value: unknown, fallback = "—"): string {
  const date = parseFlexibleDate(value);
  if (!date) return fallback;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** DD-MM-YYYY, HH:MM (24-hour, matching the existing dateTimeLabel's "2-digit" hour/minute
 *  style). Returns null (not a placeholder string) for a missing/unparseable value — callers
 *  branch on that null to distinguish "this stage has not happened yet" from "this stage
 *  happened at some time", exactly as grn-format.ts's existing dateTimeLabel() already documents
 *  and depends on. Do not change this null-vs-placeholder contract. */
export function formatDateTimeDDMMYYYY(value: unknown): string | null {
  const date = parseFlexibleDate(value);
  if (!date) return null;
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${formatDateDDMMYYYY(date)}, ${hh}:${min}`;
}
