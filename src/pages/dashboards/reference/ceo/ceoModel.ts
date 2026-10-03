import type { InsightAction, InsightKpi, InsightSignal } from "../../kit";
import { drillHref } from "../../kit";
import type { JsonRecord, ReferenceDashboardData } from "../../reference-dashboard-model";
import {
  arrayAt, asNumber, asRecord, metricAsOf, metricDetail, metricUnavailableReason, metricValue, numberAt, read,
} from "../../reference-dashboard-model";

/**
 * Everything the CEO cockpit shows, derived once from ReferenceDashboardData. Pure (no hooks) so the
 * calculations that a CEO would otherwise have to take on trust are unit-tested.
 */

export const CEO_CODE = "CEO_DASHBOARD";
export const drillTo = (metric: string, filters?: Record<string, string>) => drillHref(CEO_CODE, metric, filters);

export interface PnlPoint { month: string; revenue: number | null; ebitda: number | null; directCost: number | null; indirectCost: number | null }

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/**
 * A month's EBITDA is only trustworthy when its cost has been booked. Agent salary / DSC (direct) comes from the
 * payroll run and BMC (indirect) from posted GRNs / allocations; a month where either is still unbooked inflates
 * margin. Live 2026-10: direct cost held at ~70% of revenue every month while BMC fell 8.2M -> 6.6M -> 3.6M -> 0 for
 * Aug -> Oct, so Sep/Oct margins (15.6% / 11.9%) were overstated against a real ~7%. A month is flagged when
 * either cost ratio (cost / revenue) is under half the median of the months that have revenue.
 */
export function costCoverage(trend: PnlPoint[]): Array<PnlPoint & { costBooked: boolean }> {
  const live = trend.filter((p) => (p.revenue ?? 0) > 0);
  const base = (pick: (p: PnlPoint) => number | null) => median(live.filter((p) => pick(p) !== null).map((p) => (pick(p) as number) / (p.revenue as number)));
  const direct = base((p) => p.directCost);
  const indirect = base((p) => p.indirectCost);
  const ok = (v: number | null, rev: number | null, baseline: number | null) =>
    v !== null && (rev ?? 0) > 0 && baseline !== null && v / (rev as number) >= baseline * 0.5;
  return trend.map((p) => ({ ...p, costBooked: ok(p.directCost, p.revenue, direct) && ok(p.indirectCost, p.revenue, indirect) }));
}

export interface RevenueView {
  /** The P&L period being headlined (the selected, current period when it has revenue). */
  month: string | null;
  inProgress: boolean;
  revenue: number | null;
  priorRevenue: number | null;
  spark: number[];
  /** EBITDA margin of the latest month whose direct AND indirect cost are booked; null when none is. */
  marginPct: number | null;
  marginMonth: string | null;
  marginCaveat: string | null;
}

export function revenueView(pnl: JsonRecord): RevenueView {
  const trend: PnlPoint[] = arrayAt(pnl, "trend").map((r) => ({
    month: String(r.month ?? ""), revenue: asNumber(r.revenue), ebitda: asNumber(r.ebitda), directCost: asNumber(r.directCost), indirectCost: asNumber(r.indirectCost),
  }));
  const cover = costCoverage(trend);
  const withRevenue = cover.filter((p) => (p.revenue ?? 0) > 0);
  const period = String(read(pnl, "period") ?? "");
  // Headline the selected period (what the old tile showed); fall back to the latest month that has revenue.
  const latest = withRevenue.find((p) => p.month === period) ?? withRevenue[withRevenue.length - 1] ?? null;
  const idx = latest ? cover.indexOf(latest) : -1;
  const prior = idx > 0 ? cover[idx - 1] ?? null : null;
  const reliable = [...withRevenue].reverse().find((p) => p.costBooked) ?? null;
  const caveat = latest && reliable && latest.month !== reliable.month
    ? `${latest.month} cost is not fully booked (payroll run or GRN allocations pending) — margin shown for ${reliable.month}`
    : latest && !reliable ? "Cost is not booked for any recent month — margin withheld" : null;
  const nowMonth = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7);
  return {
    month: latest?.month ?? null,
    inProgress: latest?.month === nowMonth,
    revenue: latest?.revenue ?? null,
    priorRevenue: prior?.revenue ?? null,
    spark: withRevenue.map((p) => p.revenue as number),
    marginPct: reliable && reliable.ebitda !== null ? Math.round(((reliable.ebitda as number) / (reliable.revenue as number)) * 1000) / 10 : null,
    marginMonth: reliable?.month ?? null,
    marginCaveat: caveat,
  };
}

/** Row-level revenue by branch from the P&L rows (branchName), for the league table. */
export function revenueByBranch(pnl: JsonRecord): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of arrayAt(pnl, "rows")) {
    const key = String(r.branchName ?? "").trim().toLowerCase();
    const v = asNumber(r.recognizedRevenue);
    if (!key || v === null) continue;
    out.set(key, (out.get(key) ?? 0) + v);
  }
  return out;
}

export type QualityTone = "green" | "amber" | "red" | "slate";
/** Same bands the executive quality service uses (>=85 on track, >=75 at risk). `target` shifts both. */
export function qualityTone(score: number | null, target: number | null): QualityTone {
  if (score === null) return "slate";
  const t = target ?? 85;
  return score >= t ? "green" : score >= t - 10 ? "amber" : "red";
}

export interface Attention {
  id: string;
  title: string;
  detail: string;
  href: string;
  score: number;
  tone: "red" | "amber";
  count?: number | null;
}

const SEV_SCORE: Record<InsightAction["severity"], number> = { critical: 100, high: 70, normal: 40, info: 0 };

/** Score an insight queue so that decisions that are old, overdue and the CEO's own rank first. */
export function actionScore(a: InsightAction): number {
  if (!a.count || a.count <= 0) return 0;
  const decision = a.group === "Needs your decision" ? 30 : 0;
  return SEV_SCORE[a.severity] + decision + Math.min(a.oldestDays ?? 0, 30) + (a.overdue ?? 0) * 5;
}

/** Top-N things that need the CEO, de-duplicated by id, highest score first. Pure. */
export function rankAttention(candidates: Attention[], limit = 3): Attention[] {
  const seen = new Set<string>();
  return [...candidates].filter((c) => c.score > 0).sort((a, b) => b.score - a.score).filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).slice(0, limit);
}

export function attentionFrom(
  actions: InsightAction[], signals: InsightSignal[], extra: Attention[],
): Attention[] {
  const fromActions: Attention[] = actions.filter((a) => actionScore(a) > 0).map((a) => ({
    id: a.id, title: a.label, count: a.count, href: a.href, score: actionScore(a), tone: a.severity === "critical" || a.severity === "high" ? "red" : "amber",
    detail: [a.oldestDays != null ? `oldest ${a.oldestDays}d` : null, a.overdue ? `${a.overdue} overdue` : null, a.hint ?? null].filter(Boolean).join(" · "),
  }));
  const fromSignals: Attention[] = signals.filter((s) => s.tone === "bad").map((s, i) => ({
    id: `signal-${i}-${s.title}`, title: s.title, detail: s.detail, href: s.href ?? "#", score: 60, tone: "red" as const,
  })).filter((s) => s.href !== "#");
  return [...fromActions, ...fromSignals, ...extra];
}

export function kpiOf(kpis: InsightKpi[] | undefined, key: string): InsightKpi | undefined {
  return kpis?.find((k) => k.key === key);
}

export interface CeoModel {
  active: number | null;
  attendance: number | null;
  attendanceAsOf: string | null;
  attendanceReason: string | null;
  shrinkage: number | null;
  onboarding: number | null;
  bgv: number | null;
  payrollReadiness: number | null;
  payrollBlocked: number | null;
  resignationInApproval: number | null;
  docCoverage: number | null;
  trainingCompletion: number | null;
  certified: number | null;
  exceptionsOpen: number | null;
  qualityScore: number | null;
  qualityTarget: number | null;
  qualityGap: number | null;
  qualityNote: string | null;
  riskAgents: number | null;
  qualityRows: Array<{ name: string; score: number | null; agents: number | null; calls: number | null; status: string | null }>;
  revenue: RevenueView;
  revenueAtRisk: number | null;
  revenueRiskReason: string | null;
  lossMaking: number | null;
  receivable: number | null;
  unbilled: number | null;
  invoiced: number | null;
  /** % of processes with a revenue model configured; revenue outside it is simply not in the P&L. */
  revenueCoveragePct: number | null;
  processesModelled: number | null;
  processesTotal: number | null;
  pnlAsOf: string | null;
}

export function buildCeoModel(data: ReferenceDashboardData): CeoModel {
  const m = data.metrics;
  const ready = metricDetail(m, "payroll", "readyCount") ?? metricValue(m, "payroll");
  const blocked = metricDetail(m, "payroll", "blockerCount");
  const total = ready !== null && blocked !== null ? ready + blocked : null;
  const q = data.quality;
  const qs = asNumber(q.org_quality_score ?? q.average_score ?? q.score);
  const qt = asNumber(q.target ?? q.target_score);
  const riskReason = read(asRecord(data.pnl), "kpis", "revenueAtRiskUnavailable");
  const generated = read(data.pnl, "generatedAt");
  return {
    active: metricDetail(m, "hc", "active") ?? metricValue(m, "hc"),
    attendance: metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att"),
    attendanceAsOf: metricAsOf(m, "att"),
    attendanceReason: metricUnavailableReason(m, "att"),
    shrinkage: numberAt(data.workforce, "summary", "shrinkage_pct"),
    onboarding: metricDetail(m, "onb", "pending") ?? metricValue(m, "onb"),
    bgv: metricDetail(m, "bgv", "pending") ?? metricValue(m, "bgv"),
    payrollReadiness: total && ready !== null ? Math.round((ready / total) * 1000) / 10 : metricDetail(m, "payroll", "readinessPct"),
    payrollBlocked: blocked,
    // pendingDiscussion = open approval-stage requests; metricValue(resign) = every non-terminal exit. Never
    // fall back from a real 0 (nullish only) — a 0 here is the metric saying nothing is waiting.
    resignationInApproval: metricDetail(m, "resign", "pendingDiscussion") ?? metricValue(m, "resign"),
    docCoverage: metricDetail(m, "docCompliance", "coveragePct"),
    trainingCompletion: metricValue(m, "training"),
    certified: numberAt(data.workforce, "training", "certified_learners") ?? numberAt(data.workforce, "training", "certifiedLearners"),
    exceptionsOpen: metricDetail(m, "attException", "openTotal") ?? metricValue(m, "attException"),
    qualityScore: qs,
    qualityTarget: qt,
    qualityGap: qs !== null && qt !== null ? Math.round((qt - qs) * 100) / 100 : null,
    // The executive route answers 200 with a zero-filled body when the audit source fails, so a 0 can
    // mean "nobody scored zero" or "the query died"; data_status says which.
    qualityNote: q.data_status === "UNAVAILABLE" && typeof q.note === "string" ? q.note : null,
    riskAgents: asNumber(q.risk_agents ?? q.at_risk_agents),
    qualityRows: (arrayAt(q, "processes").length ? arrayAt(q, "processes") : arrayAt(q, "scorecard")).map((r) => ({
      name: String(r.process_name ?? r.process ?? "Unattributed"),
      score: asNumber(r.avg_score ?? r.score), agents: asNumber(r.agents ?? r.agent_count), calls: asNumber(r.calls ?? r.audit_count),
      status: typeof r.status === "string" ? r.status : null,
    })),
    revenue: revenueView(data.pnl),
    // `revenueAtRisk` sums process_revenue_daily, which holds no rows — the P&L service returns null + a reason
    // instead of a false zero. There is no revenue TARGET source either (bill_revenue_target_snapshot stops at 2020-06),
    // so this is "at risk", never a "gap".
    revenueAtRisk: numberAt(data.pnl, "kpis", "revenueAtRisk"),
    revenueRiskReason: typeof riskReason === "string" && riskReason ? "Revenue-risk feed not generated" : null,
    lossMaking: numberAt(data.pnl, "kpis", "lossMakingProcesses"),
    receivable: numberAt(data.pnl, "kpis", "outstandingReceivable"),
    unbilled: numberAt(data.pnl, "kpis", "unbilledRevenue"),
    invoiced: numberAt(data.pnl, "kpis", "invoicedRevenue"),
    revenueCoveragePct: numberAt(data.pnl, "kpis", "revenueModelCoveragePct"),
    processesModelled: numberAt(data.pnl, "kpis", "configuredProcesses"),
    processesTotal: numberAt(data.pnl, "kpis", "totalProcesses"),
    pnlAsOf: typeof generated === "string" && generated ? new Date(generated).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : null,
  };
}

/** Attention candidates that come from the summary feeds (available before the insights load). */
export function summaryAttention(c: CeoModel): Attention[] {
  const out: Attention[] = [];
  if (c.qualityScore !== null && c.qualityTarget !== null && c.qualityGap !== null && c.qualityGap > 0 && !c.qualityNote) {
    out.push({
      id: "quality-gap", title: "Quality is below target", href: "/quality/executive", tone: c.qualityGap > 10 ? "red" : "amber",
      detail: `${c.qualityScore.toFixed(1)} vs target ${c.qualityTarget} (${c.qualityGap.toFixed(1)} pts short)${c.riskAgents ? ` · ${c.riskAgents} agents at risk` : ""}`,
      score: 50 + Math.min(c.qualityGap, 20) * 2,
    });
  }
  if (c.revenue.marginCaveat) {
    out.push({ id: "margin-caveat", title: "P&L margin cannot be trusted yet", detail: c.revenue.marginCaveat, href: "/finance/process-pnl", tone: "amber", score: 48 });
  }
  if (c.payrollReadiness !== null && c.payrollReadiness < 90 && c.payrollBlocked) {
    out.push({
      id: "payroll-data", title: "Payroll data is incomplete", count: c.payrollBlocked, href: drillTo("PAYROLL_READINESS"), tone: c.payrollReadiness < 75 ? "red" : "amber",
      detail: `${c.payrollReadiness}% of employees have bank + PAN on file`, score: 40 + (90 - c.payrollReadiness),
    });
  }
  if ((c.exceptionsOpen ?? 0) > 0) {
    out.push({ id: "att-exceptions", title: "Attendance exceptions block payroll", count: c.exceptionsOpen, href: drillTo("ATTENDANCE_EXCEPTIONS"), tone: "amber", detail: "Open reconciliation issues", score: 38 });
  }
  if ((c.bgv ?? 0) > 0) {
    out.push({ id: "bgv", title: "Background verifications pending", count: c.bgv, href: drillTo("BGV"), tone: "amber", detail: "Candidates with an outstanding check", score: 30 });
  }
  return out;
}
