/**
 * IST date helpers — consolidated here so we have one source of truth.
 * Never use new Date().toISOString().slice(0,10) directly in service files
 * because that returns UTC which can be yesterday before 05:30 IST.
 */

/**
 * Returns the current IST date as YYYY-MM-DD.
 * offsetDays < 0 = past, offsetDays > 0 = future.
 */
export function getIstDateString(offsetDays = 0): string {
  // IST = UTC + 5.5 hours. Subtract offsetDays worth of minutes.
  const d = new Date(Date.now() + (5.5 * 60 - offsetDays * 24 * 60) * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns the first day of the current IST month as YYYY-MM-DD.
 */
export function getIstMonthStart(): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/**
 * MySQL expression to get the current IST date inside a SQL query.
 *
 * `mysql.ts`'s pool sets `timezone: '+05:30'` on every connection ("Always IST
 * regardless of server OS timezone" per that file's own comment), so `NOW()`
 * already returns IST wall-clock time on every connection this app opens —
 * confirmed live: NOW() returned 19:56:23 while real IST time was 19:56, and
 * the server's own @@session.time_zone is 'SYSTEM' (this particular host's
 * OS clock happens to already be IST, which is what the pool setting exists
 * to not depend on).
 *
 * `CONVERT_TZ(NOW(), '+00:00', '+05:30')` therefore double-shifts: it treats
 * an already-IST NOW() as UTC and adds another +5:30, landing on tomorrow's
 * date for roughly the back half of every IST day (from ~18:30 IST onward,
 * whenever adding 5.5h crosses midnight). That silently zeroed every
 * "today" query built on this expression — confirmed on the live-present
 * headcount metric, which always returned 0 regardless of real attendance.
 *
 * `NOW()` alone is what's actually wanted: this pool's connections already
 * report IST, so no conversion is needed or correct.
 */
export const IST_DATE_EXPR = "DATE(NOW())";

/**
 * MySQL expression for IST CURDATE() replacement — same as IST_DATE_EXPR.
 */
export const IST_CURDATE = IST_DATE_EXPR;
