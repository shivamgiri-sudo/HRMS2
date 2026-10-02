import type { DrillData, DrillFilters, DrillSplit } from "@/hooks/useAtsDashboards";
import type { OverviewPeriod } from "@/hooks/useAtsOverview";
import { buildDrillFindings, type DrillFinding } from "./drill-insights";

const PERIOD_DAYS: Record<Exclude<OverviewPeriod, "all">, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };

export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The equal-length window immediately before the current period (inclusive dates), or null for "all". `today` is an IST YYYY-MM-DD. */
export function previousWindow(period: OverviewPeriod, today: string): { from: string; to: string } | null {
  if (period === "all") return null;
  const n = PERIOD_DAYS[period];
  const curFrom = addDays(today, -(n - 1));
  return { from: addDays(curFrom, -n), to: addDays(curFrom, -1) };
}

/** Relative change in whole percent; null when there is no baseline to compare with. */
export function pctDelta(cur: number, prev: number | null | undefined): number | null {
  if (prev == null || !(prev > 0)) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export type KpiKey = "total" | "selected" | "rejected" | "joined" | "waiting" | "noShowRate";
export const KPI_KEYS: KpiKey[] = ["total", "selected", "rejected", "joined", "waiting", "noShowRate"];

/** Delta for each headline KPI against the previous window's drill. All null when there is no previous data. */
export function kpiDeltas(cur: DrillData | undefined, prev: DrillData | undefined | null): Record<KpiKey, number | null> {
  const out = Object.fromEntries(KPI_KEYS.map((k) => [k, null])) as Record<KpiKey, number | null>;
  if (!cur || !prev || !prev.kpis.total) return out;
  for (const k of KPI_KEYS) out[k] = pctDelta(cur.kpis[k], prev.kpis[k]);
  return out;
}

/** Findings for the page: break down by process when more than one is in view, otherwise by source. */
export function pulseFindings(d: DrillData | undefined): DrillFinding[] {
  if (!d) return [];
  const split = (d.splits.process?.length ?? 0) > 1 ? "process" : "source";
  return buildDrillFindings(d, null, split).slice(0, 7);
}

export const splitNames = (rows: DrillSplit[] | undefined): string[] =>
  (rows ?? []).map((r) => r.name).filter((n) => n && n !== "Unspecified" && n !== "Unmapped" && n !== "Unknown");

export interface ScoreRow { name: string; total: number; selPct: number; rejPct: number; noShowPct: number; joinPct: number }
const pct = (n: number | undefined, total: number) => (total ? Math.round(((n ?? 0) / total) * 1000) / 10 : 0);

/** Scorecard rows: prefers server-side rates, falls back to counts for an older backend. */
export function scoreRows(rows: DrillSplit[] | undefined): ScoreRow[] {
  return (rows ?? []).filter((r) => r.total > 0).map((r) => ({
    name: r.name, total: r.total,
    selPct: r.selRate ?? pct(r.selected, r.total),
    rejPct: r.rejRate ?? pct(r.rejected, r.total),
    noShowPct: r.noShowRate ?? pct(r.noShow, r.total),
    joinPct: r.joinRate ?? pct(r.joined, r.total),
  }));
}

/** Day (dow 1=Sun..7=Sat) by hour grid for the arrival heat. `hours` is the trimmed inclusive range that has data. */
export function heatGrid(cells: DrillData["hourDow"]): { grid: number[][]; max: number; hours: number[] } {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let max = 0, lo = 24, hi = -1;
  for (const c of cells ?? []) {
    if (c.dow < 1 || c.dow > 7 || c.hour < 0 || c.hour > 23) continue;
    grid[c.dow - 1][c.hour] += c.total;
    if (c.total > 0) { lo = Math.min(lo, c.hour); hi = Math.max(hi, c.hour); }
  }
  for (const r of grid) for (const v of r) max = Math.max(max, v);
  const hours = hi < 0 ? [] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  return { grid, max, hours };
}

/** Funnel step key (from the leakage endpoint) to the drill filter that lists those candidates. */
export function funnelFilter(key: string): DrillFilters {
  if (key === "selected") return { outcome: "selected" };
  if (key === "offerMade" || key === "offerApproved" || key === "bgvClear") return { outcome: "offered" };
  if (key === "joined") return { outcome: "joined" };
  return {};
}

/** Inclusive Monday..Sunday window of a cohort week. */
export const weekWindow = (week: string): { from: string; to: string } => ({ from: week, to: addDays(week, 6) });
