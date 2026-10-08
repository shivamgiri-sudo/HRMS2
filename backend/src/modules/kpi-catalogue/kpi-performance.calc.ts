/**
 * Pure calculation core for the live performance view: windows, aggregation, attainment, series and breakdowns.
 * No database access here so every rule is unit tested.
 */
import { ratingFor, type RatingBand } from "./kpi-catalogue.resolve.js";

export type Period = "today" | "yesterday" | "wtd" | "mtd" | "last30" | "custom";
export const MAX_WINDOW_DAYS = 93;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; };

/** Calendar window for a period, in the caller's date (IST dates are passed in as `today`). */
export function windowFor(period: Period, today: string, from?: string, to?: string): { from: string; to: string; period: Period; days: number } {
  const t = new Date(`${today}T00:00:00Z`);
  let a: Date, b: Date = t;
  switch (period) {
    case "yesterday": a = b = addDays(t, -1); break;
    case "wtd": { const dow = (t.getUTCDay() + 6) % 7; a = addDays(t, -dow); break; }
    case "mtd": a = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)); break;
    case "last30": a = addDays(t, -29); break;
    case "custom": {
      if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("custom period needs from and to (YYYY-MM-DD)");
      a = new Date(`${from}T00:00:00Z`); b = new Date(`${to}T00:00:00Z`);
      if (b < a) throw new Error("to must be on or after from");
      break;
    }
    default: a = t;
  }
  const days = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  if (days > MAX_WINDOW_DAYS) throw new Error(`Window too large: at most ${MAX_WINDOW_DAYS} days`);
  return { from: iso(a), to: iso(b), period, days };
}

export type AggMethod = "average" | "sum" | "last" | "min" | "max" | "latest_non_null";

/** Aggregates values (already ordered by date ascending for last / latest_non_null). Empty -> null, never 0. */
export function aggregate(values: Array<number | null | undefined>, method: string | null | undefined): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(Number(x))).map(Number);
  if (!v.length) return null;
  switch (String(method ?? "average").toLowerCase()) {
    case "sum": return v.reduce((s, x) => s + x, 0);
    case "min": return Math.min(...v);
    case "max": return Math.max(...v);
    case "last": case "latest_non_null": return v[v.length - 1];
    default: return v.reduce((s, x) => s + x, 0) / v.length;
  }
}

export const round2 = (n: number | null): number | null => (n == null ? null : Math.round(n * 100) / 100);

/** Attainment % against a target. Missing actual / target -> null (no score, never 0). Capped at `cap`. */
export function attainmentPct(actual: number | null, target: number | null, direction: string, cap = 120): number | null {
  if (actual == null || target == null || !Number.isFinite(actual) || !Number.isFinite(target)) return null;
  let pct: number;
  if (direction === "lower_is_better") {
    if (actual <= 0) pct = 100;
    else pct = (target / actual) * 100;
  } else {
    if (target === 0) return null;
    pct = (actual / target) * 100;
  }
  return round2(Math.max(0, Math.min(cap, pct)));
}

export interface DayRow { date: string; employeeId: string; value: number | null }

/** Per-day series: aggregates all employees' values for each date. */
export function buildSeries(rows: DayRow[], method: string | null | undefined, window: { from: string; to: string }): Array<{ date: string; value: number | null }> {
  const byDate = new Map<string, number[]>();
  for (const r of rows) {
    if (r.value == null) continue;
    byDate.set(r.date, [...(byDate.get(r.date) ?? []), Number(r.value)]);
  }
  const out: Array<{ date: string; value: number | null }> = [];
  for (let d = new Date(`${window.from}T00:00:00Z`); iso(d) <= window.to; d = addDays(d, 1)) {
    const key = iso(d);
    // Across employees on a day: sum for volume metrics, mean for rates.
    const vals = byDate.get(key);
    out.push({ date: key, value: vals ? round2(String(method).toLowerCase() === "sum" ? vals.reduce((s, x) => s + x, 0) : vals.reduce((s, x) => s + x, 0) / vals.length) : null });
  }
  return out;
}

export interface BreakdownRow { key: string; label: string; value: number | null; target: number | null; attainmentPct: number | null; rating: string | null; samples: number }

/** Breakdown: values grouped by key (employee / team / branch), each aggregated over the window. */
export function buildBreakdown(
  rows: Array<DayRow & { groupKey: string; groupLabel: string }>,
  method: string | null | undefined,
  target: number | null,
  direction: string,
  bands: RatingBand[],
  limit = 200,
  /** For summed volume KPIs the target is per employee-day: score each group against target x its worked days. */
  scaleTargetBySamples = false,
): BreakdownRow[] {
  const groups = new Map<string, { label: string; vals: Array<{ d: string; v: number }> }>();
  for (const r of rows) {
    if (r.value == null) continue;
    const g = groups.get(r.groupKey) ?? { label: r.groupLabel, vals: [] };
    g.vals.push({ d: r.date, v: Number(r.value) });
    groups.set(r.groupKey, g);
  }
  const out: BreakdownRow[] = [];
  for (const [key, g] of groups) {
    g.vals.sort((a, b) => a.d.localeCompare(b.d));
    const value = round2(aggregate(g.vals.map((x) => x.v), method));
    const groupTarget = scaleTargetBySamples && target != null ? round2(target * g.vals.length) : target;
    const att = attainmentPct(value, groupTarget, direction);
    out.push({ key, label: g.label, value, target: groupTarget, attainmentPct: att, rating: ratingFor(att, bands), samples: g.vals.length });
  }
  // worst first so a manager sees who needs attention
  out.sort((a, b) => (a.attainmentPct ?? Infinity) - (b.attainmentPct ?? Infinity) || a.label.localeCompare(b.label));
  return out.slice(0, limit);
}

export type Availability = "ok" | "no_data" | "not_tracked";

export function availabilityFor(opts: { mapped: boolean; hasData: boolean; rowCount: number }): Availability {
  if (!opts.mapped || !opts.hasData) return "not_tracked";
  return opts.rowCount > 0 ? "ok" : "no_data";
}

/** Whole days between the last data date and today (null when there is none). */
export function stalenessDays(lastDataDate: string | null, today: string): number | null {
  if (!lastDataDate) return null;
  return Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${lastDataDate.slice(0, 10)}T00:00:00Z`).getTime()) / 86400000);
}

/** Target for a summed volume KPI: the per-employee-day target times the employee-days actually worked. */
export function scaledTotalTarget(perDayTarget: number | null, employeeDays: number): number | null {
  if (perDayTarget == null || employeeDays <= 0) return null;
  return round2(perDayTarget * employeeDays);
}
