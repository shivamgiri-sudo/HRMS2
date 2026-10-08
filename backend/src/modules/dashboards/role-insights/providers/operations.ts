import type { RowDataPacket } from "mysql2";
import { getCachedAllocationSummary } from "../../../process-pnl/canonical-pnl.service.js";
import type { BpoPnlRow } from "../../../process-pnl/bpo-pnl.service.js";
import { OPS_METRIC_BY_ID } from "../../../operations/ops-command.definitions.js";
import { previousPeriod } from "../../../operations/ops-command.context.js";
import { computeInsights } from "../../../operations/ops-command.insights.js";
import { resolveNames } from "../../../operations/ops-command.names.js";
import { computePerformance } from "../../../operations/ops-command.performance.js";
import { computeRows, computeTotals, computeTrend, type TrendPoint } from "../../../operations/ops-command.service.js";
import { one, num, severityFor } from "../helpers.js";
import type { InsightAction, InsightContext, InsightKpi, InsightProvider, InsightSection, InsightSeries, InsightSignal, InsightTable } from "../types.js";
import {
  change, fteGaps, insightUnit, lastCompletedMonth, league, marginPct, opsHealth, opsHref, staleDays, toneForMetric,
  type Metrics, type ProcessRowLite,
} from "./operationsCalc.js";
import { guarded, memoFor, opsCtxFor, scopeIsEmptyTeam, toAction } from "./mgmtOpsQaShared.js";

/**
 * OPERATIONS_DASHBOARD insights - process P&L-lite for the people who run the floor.
 *
 * Every people/attendance number comes from Operations Command (ops-command.*), the same engine the unified
 * /operations-dashboard page uses, so a tile here can never disagree with the page it links into. Attendance
 * metrics stop at the latest COMPLETE processed day (`attThrough`) and say so; today's logins are the live domain.
 */

const TAB_OF: Record<string, string> = {
  headcount: "overview", attendance: "attendance", shrinkage: "shrinkage", roster: "roster", attrition: "attrition",
  hiring: "hiring", quality: "quality", live: "live", conduct: "quality", training: "quality", risk: "overview", breaks: "attendance",
};
const hrefFor = (metricId: string, by?: string) => opsHref({ tab: TAB_OF[OPS_METRIC_BY_ID.get(metricId)?.domain ?? "headcount"] ?? "overview", by });

const sc = (ctx: InsightContext): InsightSection | null =>
  scopeIsEmptyTeam(ctx) ? { signals: [{ tone: "watch", title: "No operations scope", detail: "This account has no branch or process mapped, so there is nothing to measure." }] } : null;

async function totals(ctx: InsightContext) {
  return memoFor(ctx, "ops-totals", async () => computeTotals(await opsCtxFor(ctx)));
}
async function trend(ctx: InsightContext): Promise<TrendPoint[]> {
  return memoFor(ctx, "ops-trend", async () => computeTrend(await opsCtxFor(ctx)));
}
async function processRows(ctx: InsightContext): Promise<ProcessRowLite[]> {
  return memoFor(ctx, "ops-process", async () => {
    const ops = await opsCtxFor(ctx);
    const { rows } = await computeRows(ops, "process");
    const names = await resolveNames("process", [...rows.keys()]);
    return [...rows.entries()].map(([id, m]) => ({ id, name: names.get(id)?.name ?? "—", m: m as Metrics }));
  });
}

const kpiDef = (id: string, value: number | null | undefined, prev: number | null | undefined, spark: number[] | undefined, windowLabel: string, extra: Partial<InsightKpi> = {}): InsightKpi => {
  const d = OPS_METRIC_BY_ID.get(id);
  const higher = d?.direction !== "lower_is_better";
  return {
    key: id, label: d?.label ?? id, value: value ?? null, unit: insightUnit(d?.unit ?? "count"),
    delta: change(value, prev), deltaLabel: windowLabel, higherIsBetter: higher, spark: spark && spark.length >= 2 ? spark : undefined,
    tone: toneForMetric(value, d?.warn, d?.bad, higher), formula: d?.formula, href: hrefFor(id),
    unavailable: value === null || value === undefined ? "No data in this window" : null, ...extra,
  };
};
const sparkOf = (t: TrendPoint[], k: keyof TrendPoint) => t.map((p) => p[k]).filter((v): v is number => typeof v === "number");

// ── Pulse KPIs ──────────────────────────────────────────────────────────────────────────────
async function pulse(ctx: InsightContext): Promise<InsightSection> {
  const blocked = sc(ctx);
  if (blocked) return blocked;
  const [{ current: c, previous: p }, t, ops] = await Promise.all([totals(ctx), trend(ctx), opsCtxFor(ctx)]);
  const win = `${ops.f.from.slice(5)} to ${ops.attThrough.slice(5)} vs prior ${previousPeriod(ops.f).from.slice(5)}-${previousPeriod(ops.f).to.slice(5)}`;
  const kpis: InsightKpi[] = [
    kpiDef("hc_closing", c.hc_closing, p.hc_closing, undefined, `closing ${ops.f.to}`, { tone: "blue" }),
    kpiDef("attendance_pct", c.attendance_pct, p.attendance_pct, sparkOf(t, "attendancePct"), win),
    kpiDef("shrinkage_pct", c.shrinkage_pct, p.shrinkage_pct, sparkOf(t, "shrinkagePct"), win),
    kpiDef("unplanned_shrinkage_pct", c.unplanned_shrinkage_pct, p.unplanned_shrinkage_pct, undefined, win),
    kpiDef("mandate_fill_pct", c.mandate_fill_pct, p.mandate_fill_pct, undefined, "FTE vs required (mandate)"),
    kpiDef("roster_adherence_pct", c.roster_adherence_pct, p.roster_adherence_pct, undefined, win),
    kpiDef("attrition_pct", c.attrition_pct, p.attrition_pct, undefined, win),
    kpiDef("qa_score_pct", c.qa_score_pct, p.qa_score_pct, undefined, win),
    kpiDef("late_pct", c.late_pct, p.late_pct, sparkOf(t, "latePct"), win),
    kpiDef("live_login_pct", c.live_login_pct, undefined, undefined, `today ${ops.today} · live`, { delta: null }),
  ];
  const series: InsightSeries[] = [];
  if (t.length > 1) {
    series.push({ key: "ops_trend", title: "Attendance vs shrinkage - daily", subtitle: `through ${ops.attThrough} (latest complete processed day)`, kind: "line", unit: "percent",
      keys: [{ key: "att", label: "Attendance %", tone: "green" }, { key: "shr", label: "Shrinkage %", tone: "red" }, { key: "late", label: "Late %", tone: "amber" }],
      points: t.map((x) => ({ label: x.date.slice(5), att: x.attendancePct, shr: x.shrinkagePct, late: x.latePct })), href: opsHref({ tab: "attendance" }) });
  }
  const h = opsHealth(c);
  return { kpis, series, healthScore: h?.score ?? null, healthBasis: h?.basis ?? "Not enough data to score operations health." };
}

// ── Process board, FTE vs required, league ────────────────────────────────────────────────
async function processes(ctx: InsightContext): Promise<InsightSection> {
  const blocked = sc(ctx);
  if (blocked) return blocked;
  const rows = await processRows(ctx);
  const pHref = (id: string) => opsHref({ by: "manager", process: id });
  const gaps = fteGaps(rows);
  const byShrink = [...rows].filter((r) => typeof r.m.shrinkage_pct === "number" && (r.m.scheduled_days ?? 0) >= 50).sort((a, b) => (b.m.shrinkage_pct as number) - (a.m.shrinkage_pct as number));
  const attLeague = league(rows, "attendance_pct", true);
  const board = [...rows].filter((r) => (r.m.hc_closing ?? 0) > 0).sort((a, b) => (b.m.hc_closing ?? 0) - (a.m.hc_closing ?? 0)).slice(0, 14);
  const tables: InsightTable[] = [{
    key: "process_board", title: "Process control board", href: opsHref({ by: "process" }),
    columns: [{ key: "name", label: "Process" }, { key: "hc", label: "HC", align: "right", unit: "count" }, { key: "fill", label: "Mandate fill", align: "right", unit: "percent" }, { key: "att", label: "Attendance", align: "right", unit: "percent" }, { key: "shr", label: "Shrinkage", align: "right", unit: "percent" }, { key: "qa", label: "Quality", align: "right", unit: "percent" }, { key: "attr", label: "Attrition", align: "right", unit: "percent" }],
    rows: board.map((r) => ({ name: r.name, hc: r.m.hc_closing ?? null, fill: r.m.mandate_fill_pct ?? null, att: r.m.attendance_pct ?? null, shr: r.m.shrinkage_pct ?? null, qa: r.m.qa_score_pct ?? null, attr: r.m.attrition_pct ?? null, href: pHref(r.id) })),
    unavailable: board.length ? null : "No process has active headcount in this scope",
  }, {
    key: "fte_gap", title: "FTE vs required - processes short", href: opsHref({ tab: "hiring", by: "process" }),
    columns: [{ key: "name", label: "Process" }, { key: "actual", label: "Actual", align: "right", unit: "count" }, { key: "required", label: "Required", align: "right", unit: "count" }, { key: "gap", label: "Gap", align: "right", unit: "count" }],
    rows: gaps.filter((g) => g.gap > 0).slice(0, 10).map((g) => ({ name: g.name, actual: g.actual, required: g.required, gap: g.gap, href: opsHref({ tab: "hiring", by: "manager", process: g.id }) })),
    unavailable: gaps.length ? null : "No workforce mandate is configured for these processes",
  }];
  const series: InsightSeries[] = [
    { key: "shrink_rank", title: "Shrinkage by process (highest first)", subtitle: "% of scheduled days lost, 30-day window", kind: "ranked", unit: "percent", points: byShrink.slice(0, 8).map((r) => ({ label: r.name, value: r.m.shrinkage_pct as number, href: opsHref({ tab: "shrinkage", by: "manager", process: r.id }) })), href: opsHref({ tab: "shrinkage", by: "process" }) },
    { key: "att_league_top", title: "League - best attendance", kind: "ranked", unit: "percent", points: attLeague.top.map((e) => ({ label: e.name, value: e.value, href: pHref(e.id) })), href: opsHref({ tab: "attendance", by: "process" }) },
    { key: "att_league_bottom", title: "League - weakest attendance", kind: "ranked", unit: "percent", points: attLeague.bottom.map((e) => ({ label: e.name, value: e.value, href: pHref(e.id) })), href: opsHref({ tab: "attendance", by: "process" }) },
  ];
  return { tables, series };
}

// ── SLA / AHT / occupancy from the process KPI matrix ──────────────────────────────────────────
const SERVICE_KEYS = ["INBOUND_SL_PCT", "AHT", "AGENT_OCCUPANCY_PCT"] as const;

async function service(ctx: InsightContext): Promise<InsightSection> {
  const blocked = sc(ctx);
  if (blocked) return blocked;
  const ops = await opsCtxFor(ctx);
  const [perf, fresh] = await Promise.all([
    computePerformance(ops, "process", "process"),
    guarded("ops.serviceFresh", () => one<RowDataPacket>(`SELECT DATE_FORMAT(MAX(score_date), '%Y-%m-%d') d FROM process_metric_actual WHERE metric_key IN ('INBOUND_SL_PCT','AHT','AGENT_OCCUPANCY_PCT')`)),
  ]);
  const latest = (fresh.value?.d as string | undefined) ?? null;
  const age = staleDays(latest, ops.today);
  const meta = new Map(perf.metrics.map((m) => [m.key, m]));
  const cell = (r: (typeof perf.rows)[number], k: string) => r.cells[k];
  const rowsOut = perf.rows.filter((r) => SERVICE_KEYS.some((k) => cell(r, k))).map((r) => ({
    name: r.name, sla: cell(r, "INBOUND_SL_PCT")?.value ?? null, aht: cell(r, "AHT")?.value ?? null, occ: cell(r, "AGENT_OCCUPANCY_PCT")?.value ?? null,
    slaAch: cell(r, "INBOUND_SL_PCT")?.achievementPct ?? null, href: opsHref({ tab: "performance", by: "manager", process: r.id }),
  })).sort((a, b) => (a.slaAch ?? 999) - (b.slaAch ?? 999)).slice(0, 12);
  const signals: InsightSignal[] = [];
  if (age !== null && age > 3) signals.push({ tone: "watch", title: `Service-level feed is ${age} days old`, detail: `SLA / AHT / occupancy last arrived for ${latest}; the figures below describe that period, not today.`, value: `${age}d`, href: opsHref({ tab: "performance", by: "process" }) });
  const off = perf.rows.filter((r) => cell(r, "INBOUND_SL_PCT")?.status === "off_track");
  if (off.length) signals.push({ tone: "bad", title: `${off.length} process${off.length === 1 ? "" : "es"} off SLA target`, detail: off.slice(0, 3).map((r) => r.name).join(", "), value: off.length, href: opsHref({ tab: "performance", by: "process" }) });
  const tables: InsightTable[] = [{
    key: "service_board", title: "SLA / AHT / occupancy by process", href: opsHref({ tab: "performance", by: "process" }),
    columns: [{ key: "name", label: "Process" }, { key: "sla", label: `SLA ${meta.get("INBOUND_SL_PCT")?.unit ?? "%"}`, align: "right", unit: "percent" }, { key: "aht", label: `AHT (${meta.get("AHT")?.unit ?? "s"})`, align: "right", unit: "count" }, { key: "occ", label: "Occupancy", align: "right", unit: "percent" }, { key: "slaAch", label: "SLA vs target", align: "right", unit: "percent" }],
    rows: rowsOut, unavailable: rowsOut.length ? null : "No SLA / AHT / occupancy readings in this window",
  }];
  return { tables, signals };
}

// ── Pending queues for the operations owner ───────────────────────────────────────────────────
async function queues(ctx: InsightContext): Promise<InsightSection> {
  const blocked = sc(ctx);
  if (blocked) return blocked;
  const { current: c } = await totals(ctx);
  const n = (k: string) => (c[k] === null || c[k] === undefined ? null : Number(c[k]));
  const mk = (id: string, label: string, metric: string, href: string, high: number, critical: number, hint: string, overdue?: number | null, floorAtZero = false): InsightAction => {
    const raw = n(metric);
    const count = raw === null ? null : floorAtZero ? Math.max(raw, 0) : raw;
    const a = toAction({ id, label, href, count, overdue: overdue ?? 0, hint, group: "Operations", unavailable: count === null ? "No data in this window" : null });
    return { ...a, severity: severityFor(count, high, critical) };
  };
  const actions: InsightAction[] = [
    mk("mandate_gap", "FTE short of required (mandate)", "mandate_gap", opsHref({ tab: "hiring", by: "process" }), 5, 20, n("mandate_gap") !== null && (n("mandate_gap") as number) < 0 ? `net ${Math.abs(n("mandate_gap") as number)} over mandate overall - check per process` : "mandate + buffer less closing HC", null, true),
    mk("pending_resignations", "Resignations awaiting review", "pending_resignations", opsHref({ tab: "attrition", by: "process" }), 3, 8, "submitted / manager / HR / admin review"),
    mk("notice_hc", "People serving notice", "notice_hc", opsHref({ tab: "attrition", by: "process" }), 5, 15, "backfill before they leave"),
    mk("overdue_positions", "Open positions past target date", "overdue_positions", opsHref({ tab: "hiring", by: "process" }), 1, 5, "approved requisitions already overdue", n("overdue_positions")),
    mk("ack_pending", "Roster shifts awaiting acknowledgement", "ack_pending", opsHref({ tab: "roster", by: "process" }), 20, 100, "employees yet to acknowledge"),
    mk("demand_shortage_slots", "Demand slots short of roster", "demand_shortage_slots", opsHref({ tab: "roster", by: "process" }), 5, 25, "roster below planned requirement"),
    mk("open_mismatches", "Open attendance mismatches", "open_mismatches", opsHref({ tab: "attendance", by: "process" }), 10, 50, "unresolved punch mismatches"),
    mk("risk_high", "High-risk agents (retention)", "risk_high", opsHref({ tab: "overview", by: "process" }), 10, 40, "composite indicator, not a prediction"),
    mk("qa_fatal", "Fatal calls in period", "qa_fatal", opsHref({ tab: "quality", by: "process" }), 3, 15, "assessed calls scoring 0%"),
    mk("training_at_risk", "Learners at training risk", "training_at_risk", opsHref({ tab: "quality", by: "process" }), 5, 20, "best MCQ below 60%"),
  ];
  return { actions };
}

// ── Process P&L-lite ─────────────────────────────────────────────────────────────────────────
type PnlSummary = Awaited<ReturnType<typeof getCachedAllocationSummary>>;
const pnlInFlight = new Map<string, Promise<PnlSummary>>();

/** One shared computation per period (kept 5 minutes) so concurrent first loads cannot each start a 50s allocation run. */
function pnlSummary(period: string): Promise<PnlSummary> {
  let p = pnlInFlight.get(period);
  if (!p) {
    p = getCachedAllocationSummary({ period });
    pnlInFlight.set(period, p);
    p.catch(() => pnlInFlight.delete(period));
    setTimeout(() => pnlInFlight.delete(period), 5 * 60_000).unref?.();
  }
  return p;
}

function allowedRow(ctx: InsightContext, r: BpoPnlRow): boolean {
  const s = ctx.scope;
  if (s.level === "ORG_ALL") return true;
  if (s.level === "BRANCH_ALL" || s.level === "CUSTOM_SCOPE") return !!r.branchId && (s.branchIds.length === 0 || s.branchIds.includes(r.branchId)) && (s.processIds.length === 0 || s.processIds.includes(r.processId));
  if (s.level === "PROCESS_ALL") return s.processIds.includes(r.processId);
  return false;
}

async function pnl(ctx: InsightContext): Promise<InsightSection> {
  if (!ctx.canSeeFinance) {
    return { tables: [{ key: "pnl_lite", title: "Process P&L-lite", columns: [], rows: [], unavailable: "Revenue, cost and margin are visible to finance and operations-head roles only." }] };
  }
  if (ctx.scope.level === "TEAM_ONLY" || ctx.scope.level === "SELF_ONLY") {
    return { tables: [{ key: "pnl_lite", title: "Process P&L-lite", columns: [], rows: [], unavailable: "Revenue and cost are shown for branch / process scopes only." }] };
  }
  const period = lastCompletedMonth(ctx.today);
  // The allocation summary is heavy on a cold process (tens of seconds) but then serves instantly from a stale cache.
  // Race it so this section degrades to a stated reason instead of timing out the dashboard; the computation keeps
  // running and warms the cache for the next load.
  const pending = pnlSummary(period);
  const winner = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 8_000))]);
  if (!winner) {
    pending.catch(() => undefined);
    return { tables: [{ key: "pnl_lite", title: `Process P&L-lite - ${period}`, columns: [], rows: [], unavailable: "Finance is still computing this period - it will appear on the next refresh." }] };
  }
  const rows = (winner.rows as unknown as BpoPnlRow[]).filter((r) => allowedRow(ctx, r) && (r.recognizedRevenue > 0 || r.totalOperatingCost > 0 || r.activeHc > 0));
  const revenue = rows.reduce((s, r) => s + r.recognizedRevenue, 0);
  const cost = rows.reduce((s, r) => s + r.totalOperatingCost, 0);
  const profit = rows.reduce((s, r) => s + r.operatingProfit, 0);
  const loss = rows.filter((r) => r.operatingProfit < 0);
  const kpis: InsightKpi[] = [
    { key: "pnl_revenue", label: `Revenue (${period})`, value: rows.length ? revenue : null, unit: "inr", tone: "green", formula: "Recognised revenue per process from the canonical P&L allocation engine, last completed month.", href: opsHref({ by: "process" }), unavailable: rows.length ? null : "No processes with revenue or cost in scope" },
    { key: "pnl_cost", label: `Operating cost (${period})`, value: rows.length ? cost : null, unit: "inr", higherIsBetter: false, tone: "amber", formula: "Total operating cost (people + direct + indirect + vendor) per the same engine.", href: opsHref({ by: "process" }) },
    { key: "pnl_margin", label: "Operating margin", value: marginPct(revenue, profit), unit: "percent", tone: profit >= 0 ? "green" : "red", formula: "Operating profit / recognised revenue, summed over processes in scope.", href: opsHref({ by: "process" }), unavailable: revenue > 0 ? null : "No revenue recognised" },
  ];
  const table: InsightTable = {
    key: "pnl_lite", title: `Process P&L-lite - ${period}`, href: opsHref({ by: "process" }),
    columns: [{ key: "name", label: "Process" }, { key: "rev", label: "Revenue", align: "right", unit: "inr" }, { key: "cost", label: "Cost", align: "right", unit: "inr" }, { key: "margin", label: "Margin", align: "right", unit: "percent" }, { key: "fte", label: "FTE act/req" }],
    rows: [...rows].sort((a, b) => b.recognizedRevenue - a.recognizedRevenue).slice(0, 12).map((r) => ({
      name: r.processName, rev: r.recognizedRevenue, cost: r.totalOperatingCost, margin: marginPct(r.recognizedRevenue, r.operatingProfit),
      fte: `${r.activeHc}/${r.requiredRosterHc}`, href: opsHref({ by: "manager", process: r.processId }),
    })),
    unavailable: rows.length ? null : "No processes with revenue or cost in scope",
  };
  const signals: InsightSignal[] = loss.length ? [{ tone: "bad", title: `${loss.length} loss-making process${loss.length === 1 ? "" : "es"} in ${period}`, detail: [...loss].sort((a, b) => a.operatingProfit - b.operatingProfit).slice(0, 3).map((r) => r.processName).join(", "), value: loss.length, href: opsHref({ by: "process" }) }] : [];
  return { kpis, tables: [table], signals };
}

// ── Insights from the page's own rule engine + interplay ────────────────────────────────────────
async function signals(ctx: InsightContext): Promise<InsightSection> {
  const blocked = sc(ctx);
  if (blocked) return blocked;
  const ops = await opsCtxFor(ctx);
  const [list, interv] = await Promise.all([
    computeInsights(ops),
    guarded("ops.interventions", async () => num((await one<RowDataPacket>(`SELECT COUNT(*) n FROM Shivamgiri.analyst_interventions`))?.n)),
  ]);
  const out: InsightSignal[] = list.slice(0, 8).map((i) => ({
    tone: i.severity === "critical" ? "bad" : i.severity === "warning" ? "watch" : i.severity === "good" ? "good" : "watch",
    title: i.title, detail: i.detail,
    href: opsHref({ tab: i.action?.tab, by: i.action?.groupBy, ...(i.action?.filter ? { [i.action.filter.key]: i.action.filter.id } : {}) }),
  }));
  if (interv.value === 0) out.push({ tone: "watch", title: "No escalations or interventions recorded", detail: "The analyst-intervention feed has no rows, so escalations cannot be counted - this is a gap, not a clean bill of health." });
  return { signals: out };
}

// ── Quality interplay: quality vs attendance/shrinkage per process ─────────────────────────────
async function qualityInterplay(ctx: InsightContext): Promise<InsightSection> {
  const blocked = sc(ctx);
  if (blocked) return blocked;
  const rows = await processRows(ctx);
  const cand = rows.filter((r) => typeof r.m.qa_score_pct === "number" && (r.m.qa_audits ?? 0) >= 20).map((r) => ({ r, q: r.m.qa_score_pct as number, s: r.m.shrinkage_pct ?? null, a: r.m.attendance_pct ?? null }));
  const weak = cand.filter((x) => x.q < 75).sort((a, b) => a.q - b.q).slice(0, 8);
  return {
    tables: [{
      key: "quality_interplay", title: "Quality vs attendance - weakest scoring processes", href: opsHref({ tab: "quality", by: "process" }),
      columns: [{ key: "name", label: "Process" }, { key: "q", label: "Quality", align: "right", unit: "percent" }, { key: "att", label: "Attendance", align: "right", unit: "percent" }, { key: "shr", label: "Shrinkage", align: "right", unit: "percent" }, { key: "fatal", label: "Fatal %", align: "right", unit: "percent" }],
      rows: weak.map((x) => ({ name: x.r.name, q: x.q, att: x.a, shr: x.s, fatal: x.r.m.qa_fatal_pct ?? null, href: opsHref({ tab: "quality", by: "manager", process: x.r.id }) })),
      unavailable: cand.length ? (weak.length ? null : "No process scores below 75% with at least 20 audits") : "No audited calls matched to processes in this window",
    }],
  };
}

const provider: InsightProvider = { sections: { pulse, processes, service, queues, pnl, signals, qualityInterplay } };
export default provider;

