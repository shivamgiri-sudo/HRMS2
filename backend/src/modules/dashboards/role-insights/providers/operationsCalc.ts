import { toneFor } from "../helpers.js";
import type { InsightTone } from "../types.js";

/** Pure calculations behind the Operations dashboard. */

export type Metrics = Record<string, number | null | undefined>;

/** Deep link into the unified Operations Command page; every filter lives in the URL. */
export function opsHref(opts: { tab?: string; by?: string; branch?: string; process?: string } = {}): string {
  const qs = new URLSearchParams();
  if (opts.tab && opts.tab !== "overview") qs.set("tab", opts.tab);
  if (opts.by) qs.set("by", opts.by);
  if (opts.branch) qs.set("branch", opts.branch);
  if (opts.process) qs.set("process", opts.process);
  const s = qs.toString();
  return `/operations-dashboard${s ? `?${s}` : ""}`;
}

/** Map an Operations Command unit to the insight unit. */
export function insightUnit(unit: string): "count" | "percent" | "days" | "hours" | "minutes" {
  return unit === "pct" ? "percent" : unit === "hours" ? "hours" : unit === "minutes" ? "minutes" : unit === "days" ? "days" : "count";
}

/** Percentage-point (or count) change, 1dp; null when either side is missing. */
export function change(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  return Math.round((cur - prev) * 10) / 10;
}

export interface ProcessRowLite {
  id: string;
  name: string;
  m: Metrics;
}

/**
 * FTE vs required, per process: actual closing HC against mandated HC (mandate + buffer from workforce_mandate).
 * `gap` > 0 means short. Rows without a mandate are excluded rather than shown as "0 required".
 */
export function fteGaps(rows: ProcessRowLite[]): Array<{ id: string; name: string; actual: number; required: number; gap: number; fillPct: number }> {
  return rows
    .filter((r) => (r.m.mandate_hc ?? 0) > 0 && r.m.hc_closing !== null && r.m.hc_closing !== undefined)
    .map((r) => {
      const required = r.m.mandate_hc as number;
      const actual = r.m.hc_closing as number;
      return { id: r.id, name: r.name, actual, required, gap: required - actual, fillPct: Math.round((actual / required) * 1000) / 10 };
    })
    .sort((a, b) => b.gap - a.gap);
}

export interface LeagueEntry { id: string; name: string; value: number }

/** Top and bottom N by a metric, ignoring groups too small to be meaningful (minimum scheduled days). */
export function league(rows: ProcessRowLite[], key: string, higherIsBetter: boolean, n = 5, minScheduledDays = 50): { top: LeagueEntry[]; bottom: LeagueEntry[] } {
  const ok = rows
    .filter((r) => typeof r.m[key] === "number" && (r.m.scheduled_days ?? minScheduledDays) >= minScheduledDays)
    .map((r) => ({ id: r.id, name: r.name, value: r.m[key] as number }))
    .sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));
  return { top: ok.slice(0, n), bottom: ok.slice(-n).reverse() };
}

/**
 * Operations health 0-100 from the components that exist, each against the target the Operations Command catalogue
 * itself warns at: attendance (warn 90), shrinkage budget (warn 15), mandate fill (warn 95), quality (warn 85).
 * null when fewer than two components are available.
 */
export function opsHealth(m: Metrics): { score: number; basis: string } | null {
  const parts: Array<{ w: number; v: number; label: string }> = [];
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  if (m.attendance_pct != null) parts.push({ w: 0.3, v: clamp((m.attendance_pct / 90) * 100), label: "attendance vs 90% 30%" });
  if (m.shrinkage_pct != null) parts.push({ w: 0.25, v: clamp(100 - Math.max(0, m.shrinkage_pct - 15) * 5), label: "shrinkage vs 15% budget 25%" });
  if (m.mandate_fill_pct != null) parts.push({ w: 0.25, v: clamp((m.mandate_fill_pct / 95) * 100), label: "mandate fill vs 95% 25%" });
  if (m.qa_score_pct != null) parts.push({ w: 0.2, v: clamp((m.qa_score_pct / 85) * 100), label: "quality vs 85% 20%" });
  if (parts.length < 2) return null;
  const total = parts.reduce((s, p) => s + p.w, 0);
  return { score: Math.round(parts.reduce((s, p) => s + p.v * p.w, 0) / total), basis: `Weighted blend of ${parts.map((p) => p.label).join(", ")} (re-normalised over available parts).` };
}

/** Margin % of revenue; null when there is no revenue (never 0). */
export function marginPct(revenue: number, profit: number): number | null {
  return revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null;
}

/** Latest completed calendar month before `today` (YYYY-MM): the period a finished P&L exists for. */
export function lastCompletedMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const mo = Number(today.slice(5, 7));
  const d = new Date(Date.UTC(y, mo - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function toneForMetric(value: number | null | undefined, warn?: number, bad?: number, higherIsBetter = true): InsightTone {
  if (value === null || value === undefined || warn === undefined || bad === undefined) return "blue";
  return higherIsBetter ? toneFor(value, warn, bad, true) : toneFor(value, warn, bad, false);
}

/** Days since an ISO date; null when unparseable. */
export function staleDays(latest: string | null, today: string): number | null {
  if (!latest) return null;
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${latest.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) / 86_400_000) : null;
}
