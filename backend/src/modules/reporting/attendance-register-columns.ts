/**
 * Attendance Register — day-column label helper (backend copy)
 *
 * This file has a logically identical counterpart at
 * `src/lib/attendance-register-columns.ts`. The two files must be kept
 * logically identical (same SHORT_MONTHS table, same
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
