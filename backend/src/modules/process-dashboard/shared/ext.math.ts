/** Pure helpers shared by the sales and outbound metric modules. A zero (or missing) denominator is null, never 0 and never NaN. */
export const r2 = (n: number): number => Math.round(n * 100) / 100;
export const ratio = (n: number | null, d: number | null): number | null => (n === null || d === null || !(d > 0) ? null : n / d);
export const pct = (n: number | null, d: number | null): number | null => { const r = ratio(n, d); return r === null ? null : r2(r * 100); };
export const div = (n: number | null, d: number | null): number | null => { const r = ratio(n, d); return r === null ? null : r2(r); };
/** YYYY-MM-DD that is a real calendar day (Date.parse alone accepts 2026-02-31). */
export const isRealDay = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};
export const isoDay = (s: string): number => Date.parse(`${s}T00:00:00Z`);
export const monthStart = (date: string): string => `${date.slice(0, 7)}-01`;
export const daysInMonth = (date: string): number => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
/** 0 = Sunday ... 6 = Saturday */
export const weekday = (date: string): number => new Date(isoDay(date)).getUTCDay();

export interface Pacing { target: number; achieved: number; attainmentPct: number | null; expectedToDate: number; pacingPct: number | null; projected: number | null; projectedAttainmentPct: number | null; elapsedDays: number; daysInMonth: number; month: string }
/**
 * Month-to-date pacing. `target` is the monthly target, `achieved` the month-to-date actual up to and including `asOf`.
 * expectedToDate = target * elapsed / daysInMonth (linear); pacing = achieved / expectedToDate; projected = achieved / elapsed * daysInMonth.
 * No target (<= 0) => null (there is nothing to pace against).
 */
export function pacing(target: number | null, achieved: number, asOf: string): Pacing | null {
  if (target === null || !(target > 0)) return null;
  const dim = daysInMonth(asOf); const elapsed = Math.min(dim, Math.max(1, Number(asOf.slice(8, 10))));
  const expected = (target * elapsed) / dim;
  return {
    target: r2(target), achieved: r2(achieved), attainmentPct: pct(achieved, target), expectedToDate: r2(expected), pacingPct: pct(achieved, expected),
    projected: r2((achieved / elapsed) * dim), projectedAttainmentPct: pct((achieved / elapsed) * dim, target), elapsedDays: elapsed, daysInMonth: dim, month: asOf.slice(0, 7),
  };
}

export interface Ranked<T> { top: T[]; bottom: T[] }
/** Best n and worst n by `value` (nulls excluded). No overlap: with fewer than 2n rows the bottom list is whatever the top list did not take. */
export function topBottom<T>(rows: T[], value: (r: T) => number | null, n = 5): Ranked<T> {
  const ranked = rows.filter((r) => value(r) !== null).sort((a, b) => (value(b) as number) - (value(a) as number));
  const top = ranked.slice(0, n);
  const bottom = ranked.slice(top.length).slice(-n).reverse();
  return { top, bottom };
}

export function addDays(date: string, n: number): string { return new Date(isoDay(date) + n * 86400000).toISOString().slice(0, 10); }
export const daysBetween = (a: string, b: string): number => Math.round((isoDay(b) - isoDay(a)) / 86400000);
export function previousWindow(from: string, to: string): { from: string; to: string } { const len = daysBetween(from, to) + 1; return { from: addDays(from, -len), to: addDays(from, -1) }; }
export const deltaPct = (cur: number | null, prev: number | null): number | null => (cur === null || prev === null || prev === 0 ? null : r2(((cur - prev) / Math.abs(prev)) * 100));
