/**
 * Pure display-side formulas for the Reginald Abandoned Cart dashboard.
 * They mirror backend/src/modules/process-live-dashboard/reginald-metrics.ts;
 * the backend owns the per-row numbers, these only roll rows up for cards and
 * charts so a card always equals the sum of the table under it.
 */

export const DAILY_ANALYST_TARGET = 13500;

const r2 = (v: number) => Math.round(v * 100) / 100;

export function connectPct(uniqueConnected: number, uniqueDialed: number): number {
  return uniqueDialed > 0 ? r2((uniqueConnected / uniqueDialed) * 100) : 0;
}

/** Actual / Target x 100; null (N/A) when there is no target. */
export function achievementPct(actual: number, target: number): number | null {
  return target > 0 ? r2((actual / target) * 100) : null;
}

export function gap(actual: number, target: number): number {
  return r2(actual - target);
}

/** (Current - Previous) / Previous x 100; null (N/A) when previous is 0 or missing. */
export function momPct(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || !(previous > 0)) return null;
  return r2(((current - previous) / previous) * 100);
}

export function fmtPctNA(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "N/A" : `${v.toFixed(digits)}%`;
}

export function fmtSigned(v: number): string {
  return `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString("en-IN")}`;
}

/** Seconds as H:MM:SS (fixed hours so columns never mix minutes with hours). */
export function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Talk / connected calls etc. — pooled sum over pooled count, never an average of averages. */
export function weightedAvg(sum: number, count: number): number {
  return count > 0 ? Math.round(sum / count) : 0;
}

export type ActualBasis = "totalCdr" | "aprTalkSec" | "revenue";

export const ACTUAL_BASES: { key: ActualBasis; label: string; short: string }[] = [
  { key: "totalCdr", label: "Total CDR (dial attempts)", short: "Dials" },
  { key: "aprTalkSec", label: "Talk time (seconds, APR)", short: "Talk sec" },
  { key: "revenue", label: "Sales revenue (₹)", short: "Revenue" },
];

export interface TargetRowLike {
  date: string; agent: string; agentName: string | null;
  eligibleDays: number; target: number;
  totalCdr: number; aprTalkSec: number; revenue: number;
}

export function actualOf(r: TargetRowLike, basis: ActualBasis): number {
  return Number(r[basis]) || 0;
}

export interface TargetSummary {
  target: number; actual: number; gap: number; achievementPct: number | null;
  eligibleDays: number; agents: number;
}

/** Period target = sum of the daily targets (13,500 x eligible present days). */
export function summarizeTargets(rows: TargetRowLike[], basis: ActualBasis): TargetSummary {
  let target = 0, actual = 0, eligibleDays = 0;
  const agents = new Set<string>();
  for (const r of rows) {
    target += r.target; actual += actualOf(r, basis); eligibleDays += r.eligibleDays;
    agents.add(r.agent);
  }
  return { target, actual, gap: gap(actual, target), achievementPct: achievementPct(actual, target), eligibleDays, agents: agents.size };
}

export interface AgentTargetRow extends TargetSummary { agent: string; agentName: string | null; days: number }

/** One row per analyst, sorted by achievement (N/A last), then by actual. */
export function targetsByAgent(rows: TargetRowLike[], basis: ActualBasis): AgentTargetRow[] {
  const groups = new Map<string, TargetRowLike[]>();
  for (const r of rows) groups.set(r.agent, [...(groups.get(r.agent) ?? []), r]);
  return [...groups.entries()].map(([agent, rs]) => ({
    agent, agentName: rs[0].agentName, days: rs.length, ...summarizeTargets(rs, basis),
  })).sort((a, b) => {
    if (a.achievementPct === null && b.achievementPct !== null) return 1;
    if (b.achievementPct === null && a.achievementPct !== null) return -1;
    return (b.achievementPct ?? 0) - (a.achievementPct ?? 0) || b.actual - a.actual;
  });
}

/** Per-date totals for a target-vs-actual chart. */
export function targetsByDate(rows: TargetRowLike[], basis: ActualBasis): { date: string; target: number; actual: number; achievementPct: number | null }[] {
  const m = new Map<string, { target: number; actual: number }>();
  for (const r of rows) {
    const x = m.get(r.date) ?? { target: 0, actual: 0 };
    x.target += r.target; x.actual += actualOf(r, basis);
    m.set(r.date, x);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, x]) => ({ date, ...x, achievementPct: achievementPct(x.actual, x.target) }));
}
