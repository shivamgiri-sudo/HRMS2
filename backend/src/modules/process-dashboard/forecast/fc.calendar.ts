/**
 * Process Dashboard forecast -- working-day calendar (pure, no I/O).
 *
 * The repo has a company holiday list (leave_holiday_master) but no per-process working calendar, so a process's calendar is INFERRED:
 *  - a past day is a working day iff the source has rows for it (a holiday the team worked counts as worked);
 *  - a future day is a working day iff its weekday was worked in >= 50% of the same weekdays of the lookback window
 *    (so a Mon-Sat process keeps Saturdays, a Mon-Fri process loses them, a half-worked Saturday rounds to the majority) ...
 *  - ... and it is not a company holiday -- but holidays are only honoured when the process did NOT mostly work the holidays that fell in the
 *    lookback window (a 24x7 floor that works national holidays is not forecast as closed on the next one).
 * With no history at all the calendar falls back to Mon-Fri and says so (`basis: "weekday-only"`).
 */
export const LOOKBACK_DAYS = 56; // 8 weeks

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: unknown): s is string => typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const addDaysIso = (date: string, n: number): string => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** 0 = Sunday ... 6 = Saturday. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
export const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export function monthBounds(month: string): { first: string; last: string; days: number } {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate(); // leap Februaries included
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, "0")}`, days };
}
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

export interface CalendarInput {
  /** Last COMPLETE day (inclusive). Days after it are the future. */
  cutoff: string;
  /** Dates in [cutoff-55, cutoff] on which the (filtered) source has at least one row. */
  workedDates: ReadonlySet<string>;
  /** Active company holiday dates (global ones; see the service). May extend past the cutoff. */
  holidays: readonly string[];
}
export interface Calendar {
  cutoff: string;
  basis: "observed" | "weekday-only";
  /** Weekdays (0-6) treated as working for future dates. */
  workingWeekdays: number[];
  /** Fraction of lookback weekdays that were worked, per weekday. */
  weekdayRate: Record<number, number | null>;
  holidaysHonoured: boolean;
  holidaysInWindow: number;
  holidaysWorkedInWindow: number;
  firstDataDate: string | null;
  isWorked(date: string): boolean;
  isWorking(date: string): boolean;
  workingDaysBetween(from: string, to: string): string[];
}

export function buildCalendar(inp: CalendarInput): Calendar {
  const winStart = addDaysIso(inp.cutoff, -(LOOKBACK_DAYS - 1));
  const worked = new Set([...inp.workedDates].filter((d) => d >= winStart && d <= inp.cutoff));
  const first = worked.size ? [...worked].sort()[0] : null;
  const holidaySet = new Set(inp.holidays);
  const winHolidays = [...holidaySet].filter((d) => d >= winStart && d <= inp.cutoff && (first === null || d >= first));
  const holidaysWorked = winHolidays.filter((d) => worked.has(d)).length;
  // Honour holidays unless at least half the ones in the window were worked.
  const honoured = winHolidays.length === 0 || holidaysWorked * 2 < winHolidays.length;

  const total: Record<number, number> = {}; const hit: Record<number, number> = {};
  if (first) {
    for (const d of datesBetween(first > winStart ? first : winStart, inp.cutoff)) {
      if (honoured && holidaySet.has(d) && !worked.has(d)) continue; // a closed holiday says nothing about that weekday
      const w = weekdayOf(d); total[w] = (total[w] ?? 0) + 1; if (worked.has(d)) hit[w] = (hit[w] ?? 0) + 1;
    }
  }
  const rate: Record<number, number | null> = {};
  for (let w = 0; w < 7; w++) rate[w] = (total[w] ?? 0) > 0 ? (hit[w] ?? 0) / total[w] : null;
  const basis: Calendar["basis"] = first ? "observed" : "weekday-only";
  const workingWeekdays = first ? [0, 1, 2, 3, 4, 5, 6].filter((w) => (rate[w] ?? 0) >= 0.5) : [1, 2, 3, 4, 5];

  const isWorked = (d: string) => worked.has(d);
  const isWorking = (d: string): boolean => {
    if (d <= inp.cutoff) return worked.has(d);
    if (honoured && holidaySet.has(d)) return false;
    return workingWeekdays.includes(weekdayOf(d));
  };
  return {
    cutoff: inp.cutoff, basis, workingWeekdays, weekdayRate: rate, holidaysHonoured: honoured, holidaysInWindow: winHolidays.length, holidaysWorkedInWindow: holidaysWorked,
    firstDataDate: first, isWorked, isWorking, workingDaysBetween: (from, to) => datesBetween(from, to).filter(isWorking),
  };
}
