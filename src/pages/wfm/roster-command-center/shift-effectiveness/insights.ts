/** Pure derivations for the Shift Effectiveness panel: KPI roll-ups and the severity-ordered insight strip. */
import { THRESH, type BreakResponse, type Recommendation, type ShiftRow } from "./types";

export type Severity = "critical" | "warning" | "info";
export type InsightTarget =
  | { kind: "shift"; shiftId: string }
  | { kind: "tab"; tab: "shifts" | "breaks" | "recommendations" };

export interface Insight {
  id: string;
  severity: Severity;
  label: string;
  /** Number of entities behind the insight (shifts, employees, recommendations). */
  count: number;
  target: InsightTarget;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Weighted (by counted days) adherence across shifts; null when nothing was scheduled. */
export function weightedAdherence(shifts: ShiftRow[]): number | null {
  const sched = shifts.reduce((a, s) => a + s.scheduledDays, 0);
  if (sched === 0) return null;
  return Math.round((shifts.reduce((a, s) => a + s.presentDays, 0) / sched) * 1000) / 10;
}

/** Quality average weighted by the number of scored agent-days; shifts without quality data are excluded (not zero-filled). */
export function weightedQuality(shifts: ShiftRow[]): number | null {
  let num = 0;
  let den = 0;
  for (const s of shifts) {
    if (s.metrics.qualityAvg == null || s.qualityDays <= 0) continue;
    num += s.metrics.qualityAvg * s.qualityDays;
    den += s.qualityDays;
  }
  return den > 0 ? Math.round((num / den) * 10) / 10 : null;
}

export function buildInsights(shifts: ShiftRow[], breaks: BreakResponse | undefined, recs: Recommendation[]): Insight[] {
  const out: Insight[] = [];
  const red = shifts.filter((s) => s.metrics.adherencePct != null && s.metrics.adherencePct < THRESH.adherence.warn);
  const amber = shifts.filter((s) => s.metrics.adherencePct != null && s.metrics.adherencePct >= THRESH.adherence.warn && s.metrics.adherencePct < THRESH.adherence.good);
  if (red.length) {
    const worst = red.reduce((a, b) => ((b.metrics.adherencePct ?? 100) < (a.metrics.adherencePct ?? 100) ? b : a));
    out.push({ id: "adh-red", severity: "critical", count: red.length, label: `${red.length} shift${red.length > 1 ? "s" : ""} below ${THRESH.adherence.warn}% adherence, lowest ${worst.shiftName} (${worst.metrics.adherencePct}%)`, target: { kind: "shift", shiftId: worst.shiftId } });
  }
  const dropping = shifts.filter((s) => s.trend.adherence != null && s.trend.adherence <= -5);
  if (dropping.length) {
    const w = dropping.reduce((a, b) => ((b.trend.adherence ?? 0) < (a.trend.adherence ?? 0) ? b : a));
    out.push({ id: "adh-drop", severity: "warning", count: dropping.length, label: `${dropping.length} shift${dropping.length > 1 ? "s" : ""} fell 5+ points vs previous 30 days, worst ${w.shiftName} (${w.trend.adherence} pts)`, target: { kind: "shift", shiftId: w.shiftId } });
  }
  if (amber.length) {
    out.push({ id: "adh-amber", severity: "warning", count: amber.length, label: `${amber.length} shift${amber.length > 1 ? "s" : ""} between ${THRESH.adherence.warn}% and ${THRESH.adherence.good}% adherence`, target: { kind: "tab", tab: "shifts" } });
  }
  if (breaks) {
    const b = breaks.overall;
    if (b.sessions === 0) {
      out.push({ id: "brk-none", severity: "info", count: 0, label: "No kiosk break data in the last 30 days for this scope, break metrics are not scored", target: { kind: "tab", tab: "breaks" } });
    } else {
      if (b.compliancePct != null && b.compliancePct < THRESH.breaks.warn) {
        out.push({ id: "brk-red", severity: "critical", count: b.overBreakCount, label: `Break compliance ${b.compliancePct}% (below ${THRESH.breaks.warn}%), ${b.overBreakCount} employee${b.overBreakCount === 1 ? "" : "s"} over allowance`, target: { kind: "tab", tab: "breaks" } });
      } else if (b.overBreakCount > 0) {
        out.push({ id: "brk-over", severity: "warning", count: b.overBreakCount, label: `${b.overBreakCount} employee${b.overBreakCount === 1 ? "" : "s"} exceeded the daily break allowance`, target: { kind: "tab", tab: "breaks" } });
      }
    }
  }
  if (recs.length) {
    out.push({ id: "recs", severity: "info", count: recs.length, label: `${recs.length} shift change recommendation${recs.length > 1 ? "s" : ""} to review`, target: { kind: "tab", tab: "recommendations" } });
  }
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count);
}

export type SortDir = "asc" | "desc";

/** Stable sort with nulls always last regardless of direction. */
export function sortRows<T>(rows: T[], get: (r: T) => number | string | null, dir: SortDir): T[] {
  const m = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: get(r) }))
    .sort((a, b) => {
      if (a.v == null && b.v == null) return a.i - b.i;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      const c = typeof a.v === "string" || typeof b.v === "string" ? String(a.v).localeCompare(String(b.v)) : a.v - b.v;
      return c * m || a.i - b.i;
    })
    .map((x) => x.r);
}
