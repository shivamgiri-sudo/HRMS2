/**
 * Process Dashboard alerts -- the PURE evaluator (no DB, no I/O, no clock).
 *
 * Inputs are plain series the caller derived with the dashboard's own code path (pd.metrics / pd.anomalies), so no formula lives here.
 * Hard rules:
 *  - null / missing data never fires: a day without a value breaks a streak, it is never read as 0.
 *  - a rule needs `consecutiveDays` calendar days ending on asOf ALL satisfying the comparator.
 *  - cooldown is wall-clock minutes between two firings of the same rule (backtests pass each data day as its own "now", so the live
 *    worker and the backtest preview share one definition).
 *  - one firing per (rule, data date): dedupeKey is what the event table's UNIQUE key enforces.
 */

export const COMPARATORS = ["gt", "gte", "lt", "lte"] as const;
export type Comparator = (typeof COMPARATORS)[number];
export const COMPARATOR_LABEL: Record<Comparator, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤" };

export const ANOMALY_TYPES = ["login_drop", "aht_spike", "qa_fatal", "zero_calls_while_logged_in"] as const;
export const ANOMALY_PREFIX = "anomaly:";
export const isAnomalyKey = (k: string): boolean => k.startsWith(ANOMALY_PREFIX);
export const anomalyTypeOf = (k: string): string => k.slice(ANOMALY_PREFIX.length);

export interface DayValue { date: string; value: number | null }

export function compare(value: number | null | undefined, cmp: Comparator, threshold: number): boolean {
  if (value === null || value === undefined || !Number.isFinite(value) || !Number.isFinite(threshold)) return false;
  switch (cmp) {
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
    default: return false;
  }
}

export function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

export interface Evaluation {
  fired: boolean;
  /** Value on the as-of day (null when there is no data for it). */
  value: number | null;
  /** How many consecutive days ending on asOf satisfied the comparator (0 when asOf itself did not). */
  streak: number;
  /** The days that made the streak, oldest first. */
  dates: string[];
  reason: "fired" | "no_data" | "not_met" | "streak_too_short";
}

/** Did the last `consecutiveDays` calendar days ending on `asOf` all satisfy `cmp threshold`? */
export function evaluateSeries(series: readonly DayValue[], asOf: string, cmp: Comparator, threshold: number, consecutiveDays = 1): Evaluation {
  const need = Math.max(1, Math.floor(consecutiveDays));
  const byDate = new Map(series.map((s) => [s.date, s.value]));
  const today = byDate.get(asOf) ?? null;
  if (today === null || !Number.isFinite(today)) return { fired: false, value: null, streak: 0, dates: [], reason: "no_data" };
  const dates: string[] = [];
  for (let i = 0; i < need; i++) {
    const d = addDaysIso(asOf, -i);
    if (!compare(byDate.get(d) ?? null, cmp, threshold)) break;
    dates.unshift(d);
  }
  if (dates.length === 0) return { fired: false, value: today, streak: 0, dates, reason: "not_met" };
  if (dates.length < need) return { fired: false, value: today, streak: dates.length, dates, reason: "streak_too_short" };
  return { fired: true, value: today, streak: dates.length, dates, reason: "fired" };
}

/** Anomaly rule: the day's count of anomalies of the rule's type (or any type) reaches the minimum. No anomaly data for the day means no fire. */
export function evaluateAnomalyCount(count: number | null, minCount: number): Evaluation & { count: number | null } {
  if (count === null) return { fired: false, value: null, streak: 0, dates: [], reason: "no_data", count: null };
  const need = Math.max(1, Math.floor(minCount));
  const fired = count >= need;
  return { fired, value: count, streak: fired ? 1 : 0, dates: [], reason: fired ? "fired" : "not_met", count };
}

/** True when a firing at `now` would fall inside the cooldown that started at `lastFiredAt` (a never-fired rule is never in cooldown). */
export function inCooldown(lastFiredAt: Date | null | undefined, now: Date, cooldownMinutes: number): boolean {
  if (!lastFiredAt || !(cooldownMinutes > 0)) return false;
  const last = lastFiredAt.getTime();
  if (Number.isNaN(last)) return false;
  return now.getTime() - last < cooldownMinutes * 60_000;
}

/** The identity of one firing: the same rule on the same data date is the same alert, however many times the worker runs. */
export const dedupeKey = (ruleId: string, dataDate: string): string => `${ruleId}:${dataDate}`;

export interface BacktestDay { date: string; fired: boolean; suppressedByCooldown: boolean; value: number | null }
/**
 * Replays a rule across `dates` (ascending) applying cooldown exactly like the worker: a condition that holds inside the cooldown of the
 * previous firing is counted as suppressed, not fired. `evalAt` returns the evaluation for one day.
 */
export function simulateFirings(dates: readonly string[], evalAt: (date: string) => Evaluation, cooldownMinutes: number): { fired: number; days: BacktestDay[] } {
  let last: Date | null = null; let fired = 0; const days: BacktestDay[] = [];
  for (const date of dates) {
    const ev = evalAt(date);
    const at = new Date(`${date}T12:00:00Z`);
    if (!ev.fired) { days.push({ date, fired: false, suppressedByCooldown: false, value: ev.value }); continue; }
    if (inCooldown(last, at, cooldownMinutes)) { days.push({ date, fired: false, suppressedByCooldown: true, value: ev.value }); continue; }
    last = at; fired++; days.push({ date, fired: true, suppressedByCooldown: false, value: ev.value });
  }
  return { fired, days };
}
