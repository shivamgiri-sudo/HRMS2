import type { InsightAction, InsightKpi, RoleInsights } from "../../kit";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { asNumber, asRecord, metricDetail, metricValue } from "../../reference-dashboard-model";

export const kpiOf = (ins: RoleInsights | undefined, key: string): InsightKpi | undefined => ins?.kpis.find((k) => k.key === key);
export const kpisOf = (ins: RoleInsights | undefined, keys: string[]): InsightKpi[] =>
  keys.map((k) => kpiOf(ins, k)).filter((k): k is InsightKpi => Boolean(k));

/** Open items, overdue items and queues with something waiting, across every action the provider returned. */
export function queueTotals(actions: InsightAction[] | undefined) {
  if (!actions) return { open: null as number | null, overdue: null as number | null, queues: 0, critical: 0 };
  const live = actions.filter((a) => (a.count ?? 0) > 0);
  return {
    open: live.reduce((s, a) => s + (a.count ?? 0), 0),
    overdue: actions.reduce((s, a) => s + (a.overdue ?? 0), 0),
    queues: live.length,
    critical: live.filter((a) => a.severity === "critical").length,
  };
}

/** Per-group open / overdue totals, for the area breakdown strip. */
export function groupTotals(actions: InsightAction[] | undefined) {
  const by = new Map<string, { group: string; open: number; overdue: number }>();
  for (const a of actions ?? []) {
    const g = a.group ?? "Other";
    const row = by.get(g) ?? { group: g, open: 0, overdue: 0 };
    row.open += a.count ?? 0;
    row.overdue += a.overdue ?? 0;
    by.set(g, row);
  }
  return [...by.values()].filter((g) => g.open > 0).sort((a, b) => b.overdue - a.overdue || b.open - a.open);
}

/** Share of live BGV candidates that are cleared; null when nobody is in scope (never a 0 from a missing input). */
export function bgvClearRate(cleared: number | null, pending: number | null, flagged: number | null, breached: number | null = 0): number | null {
  if (cleared === null || pending === null) return null;
  const live = cleared + pending + (flagged ?? 0) + (breached ?? 0);
  return live > 0 ? Math.round((cleared / live) * 100) : null;
}

/** Submitted / (submitted + pending); null when either input is missing or both are zero. */
export function onboardingSubmitRate(submitted: number | null, pending: number | null): number | null {
  if (submitted === null || pending === null || submitted + pending <= 0) return null;
  return Math.round((submitted / (submitted + pending)) * 100);
}

/** Figures the summary endpoint returns, read once. Every one is null when the metric did not arrive. */
export function summaryFigures(data: ReferenceDashboardData) {
  const m = data.metrics;
  const wf = asRecord(data.workforce.summary);
  return {
    headcount: metricDetail(m, "hc", "active") ?? metricValue(m, "hc"),
    shortage: metricDetail(m, "hiringAlert", "shortage") ?? metricValue(m, "hiringAlert"),
    processesShort: metricDetail(m, "hiringAlert", "processesShort"),
    onbPending: metricDetail(m, "onb", "pending") ?? metricValue(m, "onb"),
    onbSubmitted: metricDetail(m, "onb", "submitted"),
    onbStuck: metricDetail(m, "onb", "stuck"),
    bgvPending: metricDetail(m, "bgv", "pending") ?? metricValue(m, "bgv"),
    bgvCleared: metricDetail(m, "bgv", "cleared"),
    bgvFlagged: metricDetail(m, "bgv", "flagged"),
    bgvBreached: metricDetail(m, "bgv", "breached"),
    appointmentEsign: metricDetail(m, "appointmentEsign", "pending") ?? metricValue(m, "appointmentEsign"),
    joiningDocEsign: metricDetail(m, "joiningDocEsign", "pending") ?? metricValue(m, "joiningDocEsign"),
    resignReview: metricDetail(m, "resign", "pendingDiscussion") ?? metricValue(m, "resign"),
    docsMissing: metricValue(m, "docCompliance"),
    training: metricValue(m, "training"),
    attendanceRate: metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att"),
    leavePending: asNumber(data.workforce.pending_leave_requests) ?? metricValue(m, "leaveApprovals"),
    legacyLeave: asNumber(data.workforce.legacy_leave_backlog) ?? metricDetail(m, "leaveApprovals", "legacyBacklog"),
    // Summary-endpoint workforce figures, kept for reconciliation against the corrected provider numbers.
    summaryJoins: asNumber(wf.new_joiners_30d ?? data.workforce.new_joiners_30d),
    summaryExits: asNumber(wf.exits_30d ?? data.workforce.exits_30d),
    summaryAttrition: asNumber(wf.attrition_rate_30d ?? data.workforce.attrition_rate_30d),
    shrinkage: asNumber(wf.shrinkage_pct),
    expectedToWork: asNumber(wf.expected_to_work) ?? metricDetail(m, "att", "expectedToWork"),
  };
}

/** Prefer the drilldown drawer when the metric has one; otherwise fall back to the page that owns the work. */
export function tileTarget(drill: NonNullable<ReferenceDashboardData["drilldownFor"]>, key: string, fallbackHref: string, filters?: Record<string, string>) {
  const onDrilldown = drill(key, filters).onDrilldown;
  return onDrilldown ? { onDrill: onDrilldown } : { href: fallbackHref };
}
