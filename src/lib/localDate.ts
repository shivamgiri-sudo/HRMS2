const IST = "Asia/Kolkata";

/**
 * Returns a date as YYYY-MM-DD in IST (Asia/Kolkata).
 * Use this instead of new Date().toISOString().slice(0, 10), which returns UTC
 * and shifts the date after 18:30 IST — breaking leave/attendance queries.
 */
export function localISODate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Returns the first day of the current month as YYYY-MM-DD in IST.
 */
export function localFirstOfMonth(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-01`;
}
