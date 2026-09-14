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
 * Use as a literal snippet (not a parameter):
 *   `WHERE DATE(CONVERT_TZ(created_at, '+00:00', '+05:30')) = ${IST_DATE_EXPR}`
 */
export const IST_DATE_EXPR = "DATE(CONVERT_TZ(NOW(), '+00:00', '+05:30'))";

/**
 * MySQL expression for IST CURDATE() replacement — same as IST_DATE_EXPR.
 */
export const IST_CURDATE = IST_DATE_EXPR;
