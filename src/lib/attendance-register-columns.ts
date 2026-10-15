/**
 * Attendance Register — day-column label helper (frontend copy)
 *
 * This file has a logically identical counterpart at
 * `backend/src/modules/reporting/attendance-register-columns.ts`. The two
 * files must be kept logically identical (same SHORT_MONTHS table, same
 * buildDayColumnLabel/daysInMonth/withDayColumnLabels behavior) since the
 * frontend (`src/`) and backend (`backend/src/`) are separate compiled
 * TypeScript projects with no shared package boundary in this repo. If you
 * change one, change the other to match.
 */

/** Fixed English 3-letter month names — never locale-dependent. */
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Builds the "Mon-DD" label for a given calendar day.
 * `month` is 1-indexed (1 = January), matching the "YYYY-MM" filter format
 * already used by attendanceRegisterMonthly's `month` filter.
 */
export function buildDayColumnLabel(month: number, day: number): string {
  const mm = SHORT_MONTHS[month - 1];
  return `${mm}-${String(day).padStart(2, "0")}`;
}

/** Number of days in a given YYYY-MM month, mirroring the executor's own computation. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Given the base column list and a "YYYY-MM" month string, returns a new column array
 * where every day_N (N from 1..daysInMonth) column's label is overridden to "Mon-DD",
 * and any day_N beyond the actual days in that month is dropped (Requirement 3.4).
 * Non-day columns pass through unchanged. Returns the input unmodified if `monthStr`
 * is missing or malformed.
 */
export function withDayColumnLabels<T extends { key: string; label: string }>(
  columns: T[],
  monthStr: string | undefined
): T[] {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return columns;
  const [year, month] = monthStr.split("-").map(Number);
  const dim = daysInMonth(year, month);
  const dayKeyRe = /^day_(\d+)$/;

  return columns.reduce<T[]>((out, col) => {
    const m = dayKeyRe.exec(col.key);
    if (!m) { out.push(col); return out; }
    const dayNum = Number(m[1]);
    if (dayNum > dim) return out; // drop day columns past the month's actual length
    out.push({ ...col, label: buildDayColumnLabel(month, dayNum) });
    return out;
  }, []);
}

/**
 * Which day columns (1..31) of a month-grid report hold a day that is both inside what the caller
 * asked for and not in the future.
 *
 *  - a single month: days 1..daysInMonth, capped at `today` (nothing after it has happened);
 *  - a From..To range: only the days inside [from, to], in every month the range touches (the
 *    grid's day_N columns are shared between months, so a column is shown when ANY touched month
 *    has that day inside the range), again capped at `today`.
 *
 * Why: the register is a month grid and a range runs every month it touches in full, so a request
 * for "14 October" came back with day columns through 31 October, and stored future-dated rows
 * (pre-generated week-offs, advance leave) showed up to the 18th - WFM email 2026-10-13/15
 * "attendance export for 14th shows records up to 18th". `today` is YYYY-MM-DD in IST.
 */
export function visibleDayNumbers(input: {
  month?: string | null;
  from?: string | null;
  to?: string | null;
  today: string;
}): Set<number> {
  const out = new Set<number>();
  const isDate = (v?: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isMonth = (v?: string | null): v is string => !!v && /^\d{4}-\d{2}$/.test(v);
  let lo: string;
  let hi: string;
  if (isDate(input.from) || isDate(input.to)) {
    lo = isDate(input.from) ? input.from : (input.to as string);
    hi = isDate(input.to) ? input.to : (input.from as string);
    if (hi < lo) hi = lo;
  } else if (isMonth(input.month)) {
    const [y, m] = input.month.split("-").map(Number);
    lo = `${input.month}-01`;
    hi = `${input.month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  } else {
    return out; // nothing to go by: caller keeps every column
  }
  if (hi > input.today) hi = input.today;
  if (lo > hi) return out;
  // Walk the days; at most ~12 months, so this is cheap.
  const cur = new Date(`${lo}T00:00:00Z`);
  const end = new Date(`${hi}T00:00:00Z`);
  while (cur <= end) {
    out.add(cur.getUTCDate());
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
