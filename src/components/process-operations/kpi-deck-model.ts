/**
 * Pure model for the KPI Command Deck: status, gap-to-target, deltas, freshness and the
 * day-by-day health series. No React, so it is unit-testable and shared by every view
 * (rows / tiles / matrix) so they can never disagree about what "below target" means.
 *
 * Mirrors the field shapes of GET /api/process-operations/:processId
 * (backend MetricReading / MetricSection), kept structural so the page's own
 * interfaces are assignable without an import cycle.
 */

export interface DeckReading {
  metricKey: string; label: string; unit: string | null; direction: string | null;
  value: number | null; staleDays: number | null; latestDate: string | null;
  provisional: boolean; priorValue: number | null; targetValue: number | null;
  trend: Array<{ date: string; value: number | null; numerator: number | null; denominator: number | null }>;
  numerator: number | null; denominator: number | null;
  source: string | null; computedAt: string | null;
}
export interface DeckSection { key: string; title: string; blurb: string | null; metrics: DeckReading[] }
export type DeckPeriod = "trend" | "today" | "wtd" | "mtd";

export type Status = "pass" | "fail" | "none" | "nodata";

export function statusOf(r: DeckReading): Status {
  if (r.value === null || Number.isNaN(r.value)) return "nodata";
  if (r.targetValue === null || !r.direction) return "none";
  const ok = r.direction === "higher_is_better" ? r.value >= r.targetValue : r.value <= r.targetValue;
  return ok ? "pass" : "fail";
}

export function isPercentUnit(unit: string | null): boolean {
  const u = (unit ?? "").toLowerCase();
  return u === "percentage" || u === "percent" || u === "pct" || u === "ratio";
}

export function formatValue(value: number | null, unit: string | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  const u = (unit ?? "").toLowerCase();
  if (isPercentUnit(unit)) return `${value.toFixed(1)}%`;
  if (u === "seconds") {
    if (value < 90) return `${Math.round(value)}s`;
    return `${Math.floor(value / 60)}m ${String(Math.round(value % 60)).padStart(2, "0")}s`;
  }
  if (u === "currency") return `₹${Math.round(value).toLocaleString("en-IN")}`;
  return Number.isInteger(value) ? value.toLocaleString("en-IN") : value.toFixed(2);
}

export function targetText(r: DeckReading): string | null {
  if (r.targetValue === null || !r.direction) return null;
  return `${r.direction === "higher_is_better" ? "≥" : "≤"} ${formatValue(r.targetValue, r.unit)}`;
}

/**
 * How far off target, as a fraction of the target. Positive = worse than target.
 * Used to sort "worst first" comparably across units (a 5-point miss on a 90% target
 * and a 60-second miss on a 300s target are both ~5% / 20%).
 */
export function gapRatio(r: DeckReading): number | null {
  if (r.value === null || r.targetValue === null || !r.direction || r.targetValue === 0) return null;
  return r.direction === "higher_is_better"
    ? (r.targetValue - r.value) / Math.abs(r.targetValue)
    : (r.value - r.targetValue) / Math.abs(r.targetValue);
}

/** Absolute distance to target in the metric's own unit (positive = worse). */
export function gapText(r: DeckReading): string | null {
  const g = gapRatio(r);
  if (g === null || r.value === null || r.targetValue === null) return null;
  const abs = Math.abs(r.value - r.targetValue);
  const unitful = isPercentUnit(r.unit) ? `${abs.toFixed(1)} pt` : formatValue(abs, r.unit);
  return g > 0 ? `${unitful} short` : `${unitful} ahead`;
}

export const DELTA_BASIS: Record<DeckPeriod, string> = {
  trend: "vs earlier readings",
  today: "vs yesterday",
  wtd: "vs same days last week",
  mtd: "vs same days last month",
};

export interface DeltaInfo { text: string; good: boolean | null; flat: boolean }
export function deltaOf(r: DeckReading): DeltaInfo | null {
  if (r.value === null || r.priorValue === null) return null;
  const d = r.value - r.priorValue;
  if (Math.abs(d) < 0.05) return { text: "no change", good: null, flat: true };
  const good = r.direction ? (r.direction === "higher_is_better" ? d > 0 : d < 0) : null;
  const arrow = d > 0 ? "▲" : "▼";
  const abs = Math.abs(d);
  const u = (r.unit ?? "").toLowerCase();
  const body = isPercentUnit(r.unit) ? `${abs.toFixed(1)} pt`
    : u === "seconds" ? `${Math.round(abs)}s`
    : u === "currency" ? `₹${Math.round(abs).toLocaleString("en-IN")}`
    : Number.isInteger(abs) ? abs.toLocaleString("en-IN") : abs.toFixed(1);
  return { text: `${arrow} ${body}`, good, flat: false };
}

export interface HealthSummary { pass: number; fail: number; none: number; nodata: number; targeted: number; score: number | null }
export function summarize(metrics: DeckReading[]): HealthSummary {
  const h = { pass: 0, fail: 0, none: 0, nodata: 0, targeted: 0, score: null as number | null };
  for (const m of metrics) h[statusOf(m)]++;
  h.targeted = h.pass + h.fail;
  h.score = h.targeted > 0 ? Math.round((100 * h.pass) / h.targeted) : null;
  return h;
}

export interface Freshness {
  /** Newest reading date across all metrics (the process's feed high-water mark). */
  newestDate: string | null;
  /** Days between that date and today; null when nothing has ever reported. */
  newestAgeDays: number | null;
  /** True when even the freshest metric is older than the stale threshold: the feed has stopped. */
  feedStopped: boolean;
  staleMetrics: number;
  withData: number;
}
export function freshnessOf(metrics: DeckReading[], staleAfterDays: number): Freshness {
  const withData = metrics.filter((m) => m.value !== null);
  const ages = withData.map((m) => m.staleDays).filter((x): x is number => x !== null);
  const newestAge = ages.length ? Math.min(...ages) : null;
  const dates = withData.map((m) => m.latestDate).filter((x): x is string => !!x).sort();
  return {
    newestDate: dates.length ? dates[dates.length - 1] : null,
    newestAgeDays: newestAge,
    feedStopped: newestAge !== null && newestAge > staleAfterDays,
    staleMetrics: withData.filter((m) => m.staleDays !== null && m.staleDays > staleAfterDays).length,
    withData: withData.length,
  };
}

export interface DayHealth { date: string; pass: number; fail: number; pct: number | null }
/** Per day: of the targeted metrics that reported, what share met target. The deck's timeline. */
export function dailyHealth(metrics: DeckReading[], days = 14): DayHealth[] {
  const targeted = metrics.filter((m) => m.targetValue !== null && m.direction);
  const dates = new Set<string>();
  targeted.forEach((m) => m.trend.forEach((t) => { if (t.value !== null) dates.add(t.date); }));
  const ordered = [...dates].sort().slice(-days);
  return ordered.map((date) => {
    let pass = 0, fail = 0;
    for (const m of targeted) {
      const t = m.trend.find((x) => x.date === date);
      if (!t || t.value === null) continue;
      const ok = m.direction === "higher_is_better" ? t.value >= (m.targetValue as number) : t.value <= (m.targetValue as number);
      if (ok) pass++; else fail++;
    }
    return { date, pass, fail, pct: pass + fail > 0 ? Math.round((100 * pass) / (pass + fail)) : null };
  });
}

/** Status of one metric on one date (for the matrix); "missing" when it did not report that day. */
export function cellStatus(r: DeckReading, date: string): Status | "missing" {
  const t = r.trend.find((x) => x.date === date);
  if (!t || t.value === null) return "missing";
  if (r.targetValue === null || !r.direction) return "none";
  const ok = r.direction === "higher_is_better" ? t.value >= r.targetValue : t.value <= r.targetValue;
  return ok ? "pass" : "fail";
}

/** Worst first: failing by relative gap, then targetless with data, then no data. */
export function rankWorstFirst(metrics: DeckReading[]): DeckReading[] {
  const bucket = (m: DeckReading) => { const s = statusOf(m); return s === "fail" ? 0 : s === "none" ? 2 : s === "pass" ? 1 : 3; };
  return [...metrics].sort((a, b) => {
    const ba = bucket(a), bb = bucket(b);
    if (ba !== bb) return ba - bb;
    if (ba === 0) return (gapRatio(b) ?? 0) - (gapRatio(a) ?? 0);
    return a.label.localeCompare(b.label);
  });
}

export function matchesQuery(r: DeckReading, q: string): boolean {
  const s = q.trim().toLowerCase();
  return !s || r.label.toLowerCase().includes(s) || r.metricKey.toLowerCase().includes(s);
}
