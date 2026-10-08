import type { InsightAction, InsightKpi, InsightSeries, InsightTable, RoleInsights } from "../../kit";

/** Pure helpers behind the Manager layout - kept free of React so they are unit-testable. */

export const kpiOf = (ins: RoleInsights | undefined, key: string): InsightKpi | undefined => ins?.kpis.find((k) => k.key === key);
export const seriesOf = (ins: RoleInsights | undefined, key: string): InsightSeries | undefined => ins?.series.find((s) => s.key === key);
export const tableOf = (ins: RoleInsights | undefined, key: string): InsightTable | undefined => ins?.tables.find((t) => t.key === key);

/** Decisions waiting on the manager: approvals + people queues (the inbox is context, not a decision count). */
export function decisionQueues(actions: InsightAction[] | undefined): { open: number | null; overdue: number | null; queues: number } {
  if (!actions) return { open: null, overdue: null, queues: 0 };
  const decisions = actions.filter((a) => a.id !== "inbox");
  const counted = decisions.filter((a) => a.count !== null);
  if (!counted.length) return { open: null, overdue: null, queues: 0 };
  return {
    open: counted.reduce((s, a) => s + (a.count ?? 0), 0),
    overdue: counted.reduce((s, a) => s + (a.overdue ?? 0), 0),
    queues: counted.filter((a) => (a.count ?? 0) > 0).length,
  };
}

export interface TeamSegment { key: string; label: string; value: number; tone: "green" | "violet" | "amber" | "slate" }

/** Live team split. Segments never exceed the team size; the remainder is "other" so the bar always sums to 100%. */
export function teamSegments(team: number | null, loggedIn: number | null, onLeave: number | null, notPunched: number | null): TeamSegment[] | null {
  if (team === null || team <= 0 || loggedIn === null) return null;
  const leave = Math.min(onLeave ?? 0, Math.max(team - loggedIn, 0));
  const np = Math.min(notPunched ?? 0, Math.max(team - loggedIn - leave, 0));
  const other = Math.max(team - loggedIn - leave - np, 0);
  return [
    { key: "in", label: "Logged in", value: loggedIn, tone: "green" },
    { key: "leave", label: "On leave", value: leave, tone: "violet" },
    { key: "np", label: "Not punched yet", value: np, tone: "amber" },
    ...(other > 0 ? [{ key: "other", label: "Logged out / other", value: other, tone: "slate" as const }] : []),
  ];
}

export function riskTone(score: number | null): "red" | "amber" | "slate" {
  if (score === null) return "slate";
  return score >= 65 ? "red" : score >= 45 ? "amber" : "slate";
}
