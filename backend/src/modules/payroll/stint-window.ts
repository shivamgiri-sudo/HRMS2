/**
 * Which days of a payroll month an employee was employed, from their employment stints.
 *
 * Pure string/integer math — no Date objects — because this codebase has a history of a local Date read back
 * as UTC shifting a payroll day (see payroll/employment-end-date.ts). 'YYYY-MM-DD' strings only.
 */

export interface Stint {
  startDate: string;
  /** null = the current, open stint. */
  endDate: string | null;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface StintSummary {
  /** Ascending, non-overlapping, inclusive, clamped to the month (and to salary_start_date when given). */
  ranges: DateRange[];
  employedDays: number;
  /** Sundays that fall inside the employed ranges. */
  sundays: number;
}

const ymd = (v: string): string => String(v).slice(0, 10);

/** Days since 1970-01-01 for a 'YYYY-MM-DD' string, via UTC midnight, so there is no timezone drift. */
export function dayNumber(date: string): number {
  const [y, m, d] = ymd(date).split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** 1970-01-01 was a Thursday, so a Sunday is a day number n with (n + 4) % 7 === 0. */
export function isSunday(date: string): boolean {
  return (((dayNumber(date) + 4) % 7) + 7) % 7 === 0;
}

const maxDate = (a: string, b: string) => (a >= b ? a : b);
const minDate = (a: string, b: string) => (a <= b ? a : b);

function addDays(date: string, n: number): string {
  const dn = dayNumber(date) + n;
  const d = new Date(dn * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function stintEmploymentSummary(
  stints: Stint[],
  monthStart: string,
  monthEnd: string,
  salaryStartDate?: string | null,
): StintSummary {
  const floor = salaryStartDate ? maxDate(ymd(monthStart), ymd(salaryStartDate)) : ymd(monthStart);
  const ceil = ymd(monthEnd);

  const clamped: DateRange[] = [];
  for (const s of stints) {
    const from = maxDate(ymd(s.startDate), floor);
    const to = minDate(s.endDate ? ymd(s.endDate) : ceil, ceil);
    if (from <= to) clamped.push({ from, to });
  }
  clamped.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  // Merge overlapping and touching ranges so no day is counted twice.
  const ranges: DateRange[] = [];
  for (const r of clamped) {
    const last = ranges[ranges.length - 1];
    if (last && r.from <= addDays(last.to, 1)) {
      if (r.to > last.to) last.to = r.to;
    } else {
      ranges.push({ ...r });
    }
  }

  let employedDays = 0;
  let sundays = 0;
  for (const r of ranges) {
    const a = dayNumber(r.from);
    const b = dayNumber(r.to);
    employedDays += b - a + 1;
    for (let n = a; n <= b; n++) if ((((n + 4) % 7) + 7) % 7 === 0) sundays++;
  }
  return { ranges, employedDays, sundays };
}

export function isDateEmployed(ranges: DateRange[], date: string): boolean {
  const d = ymd(date);
  return ranges.some((r) => d >= r.from && d <= r.to);
}
