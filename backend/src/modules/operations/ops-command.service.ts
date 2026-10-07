import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  NONE_ID,
  addDays,
  daysBetween,
  num,
  pct,
  previousPeriod,
  round,
  type OpsCtx,
  type OpsDimension,
} from "./ops-command.context.js";
import { OPS_METRICS } from "./ops-command.definitions.js";
import {
  attendanceDomain,
  attritionDomain,
  headcountDomain,
  hiringDomain,
  rosterDomain,
  type MetricMap,
  type MetricRow,
  breaksDomain,
  conductDomain,
  liveDomain,
  qualityDomain,
  trainingDomain,
} from "./ops-command.domains.js";
import {
  groupKey,
  exitDateOf,
  exitedIn,
  loadView,
  type DimView,
} from "./ops-command.dim.js";
import * as F from "./ops-command.facts.js";
import { riskDomain } from "./ops-command.risk.js";
import { resolveNames } from "./ops-command.names.js";

export type MetricValues = Record<string, number | null>;

export interface OpsRow {
  id: string;
  name: string;
  sub: string | null;
  m: MetricValues;
}

/** Counts that are a genuine 0 (not "no data") when a group has no row in that domain. */
const ZERO_FILL = [
  "exits",
  "not_joined",
  "absconding_exits",
  "voluntary_exits",
  "involuntary_exits",
  "unclassified_exits",
  "exits_0_30",
  "exits_31_90",
  "exits_91_180",
  "exits_180_plus",
  "notice_hc",
  "pending_resignations",
  "lwd_next_30",
  "warnings_active",
  "warnings_final",
  "pip_active",
  "rostered_days",
  "weekoff_days",
  "training_days",
  "published_days",
  "ack_pending",
  "ack_rejected",
  "due_days",
  "adhered_days",
  "rostered_employees",
  "joiners",
  "new_joiner_hc",
  "hc_closing",
  "hc_opening",
  "live_planned",
  "live_logged_in",
  "live_logged_out",
  "live_on_break",
  "training_learners",
  "training_at_risk",
  "training_ready",
  "risk_high",
  "risk_medium",
];

/** Turns raw sums into the catalogue's percentages. The formulas here mirror ops-command.definitions.ts. */
export function derive(raw: MetricRow, days: number): MetricValues {
  const g = (k: string) => raw[k] ?? null;
  const n = (k: string) => raw[k] ?? 0;
  const out: MetricValues = { ...raw };

  const sched = n("scheduled_days");
  if (raw.scheduled_days !== undefined && raw.scheduled_days !== null) {
    const leave = n("leave_days");
    const half = n("half_days");
    const unplannedDays = n("absent_days") + n("missing_punch_days") + half / 2;
    out.attendance_pct = pct(n("present_days") + half / 2, sched - leave);
    out.absent_pct = pct(n("absent_days"), sched);
    out.late_pct = pct(n("late_marks"), n("worked_days"));
    out.shrinkage_pct = pct(leave + unplannedDays, sched);
    out.planned_shrinkage_pct = pct(leave, sched);
    out.unplanned_shrinkage_pct = pct(unplannedDays, sched);
    out.missing_punch_pct = pct(n("missing_punch_days"), sched);
    out.absence_shrinkage_pct = pct(n("absent_days") + half / 2, sched);
    out.avg_login_hours = round(g("avg_login_hours"), 2);
  }

  const close = n("hc_closing");
  out.hc_avg = round((n("hc_opening") + close) / 2, 1);
  if (g("mandate_hc") !== null) {
    out.mandate_gap = n("mandate_hc") - close;
    out.mandate_fill_pct = pct(close, n("mandate_hc"));
  }

  if (raw.rostered_days !== undefined) {
    out.roster_coverage_pct = close
      ? Math.min(pct(n("rostered_employees"), close) ?? 0, 100)
      : null;
    out.roster_published_pct = pct(n("published_days"), n("rostered_days"));
    out.roster_adherence_pct = pct(n("adhered_days"), n("due_days"));
  }

  if (raw.exits !== undefined) {
    const avg = out.hc_avg ?? 0;
    // Rates on a handful of people are noise (1 exit on 0.5 average HC = 200%); show them only from 10 average HC.
    const rate = avg >= 10 ? pct(n("exits"), avg, 2) : null;
    out.attrition_pct = rate;
    out.attrition_annualised_pct =
      rate === null ? null : round((rate * 365) / days, 1);
    out.early_attrition_pct = pct(
      n("exits_0_30") + n("exits_31_90"),
      n("exits"),
    );
  }
  out.backfill_need = Math.max(out.mandate_gap ?? 0, 0) + n("notice_hc");

  if (raw.qa_audits !== undefined) {
    out.qa_score_pct = n("qa_audits")
      ? round(n("qa_sum") / n("qa_audits"), 1)
      : null;
    out.qa_fatal_pct = pct(n("qa_fatal"), n("qa_audits"));
  }
  if (raw.training_learners !== undefined) {
    out.training_ready_pct = pct(n("training_ready"), n("training_learners"));
    out.avg_readiness = round(g("avg_readiness"), 1);
  }
  if (raw.live_planned !== undefined) {
    out.live_not_in = Math.max(
      n("live_planned") - n("live_logged_in") - n("live_logged_out"),
      0,
    );
    out.live_login_pct = pct(
      n("live_logged_in") + n("live_logged_out"),
      n("live_planned"),
    );
  }
  out.avg_break_minutes = round(g("avg_break_minutes"), 1);
  return out;
}

function mergeInto(target: Map<string, MetricRow>, src: MetricMap): void {
  for (const [gid, m] of src) target.set(gid, { ...target.get(gid), ...m });
}

function isEmpty(m: MetricRow): boolean {
  return (
    !num(m.hc_closing) &&
    !num(m.hc_opening) &&
    !num(m.exits) &&
    !num(m.scheduled_days) &&
    !num(m.rostered_days) &&
    !num(m.mandate_hc) &&
    !num(m.open_positions) &&
    !num(m.joiners) &&
    !num(m.notice_hc) &&
    !num(m.pending_resignations) &&
    !num(m.qa_audits) &&
    !num(m.live_planned)
  );
}

export interface ComputeResult {
  rows: Map<string, MetricValues>;
  externalQualityAvailable: boolean;
}

/** One pass over every domain, merged on group id. Domains run in parallel over the shared cached facts. */
export async function computeRows(
  ctx: OpsCtx,
  dim: OpsDimension,
  view?: DimView,
): Promise<ComputeResult> {
  const v = view ?? (await loadView(ctx));
  const [
    hc,
    att,
    roster,
    attr,
    hire,
    quality,
    conduct,
    training,
    breaks,
    live,
    risk,
  ] = await Promise.all([
    headcountDomain(ctx, dim, v),
    attendanceDomain(ctx, dim, v),
    rosterDomain(ctx, dim, v),
    attritionDomain(ctx, dim, v),
    hiringDomain(ctx, dim),
    qualityDomain(ctx, dim, v),
    conductDomain(ctx, dim, v),
    trainingDomain(ctx, dim, v),
    breaksDomain(ctx, dim, v),
    liveDomain(ctx, dim, v),
    riskDomain(ctx, dim, v),
  ]);
  const merged = new Map<string, MetricRow>();
  for (const src of [
    hc,
    att,
    roster,
    attr,
    hire,
    quality.map,
    conduct,
    training,
    breaks,
    live,
    risk,
  ])
    mergeInto(merged, src);
  if (dim === "all" && !merged.size) merged.set("all", {});

  const days = daysBetween(ctx.f.from, ctx.f.to);
  const rows = new Map<string, MetricValues>();
  for (const [gid, raw] of merged) {
    if (dim !== "all" && isEmpty(raw)) continue;
    const filled: MetricRow = { ...raw };
    for (const k of ZERO_FILL)
      if (filled[k] === undefined || filled[k] === null) filled[k] = 0;
    rows.set(gid, derive(filled, days));
  }
  return { rows, externalQualityAvailable: quality.externalAvailable };
}

/** Headline metrics for the KPI strip. Previous-period values (for delta chips) are optional and loaded separately. */
export async function computeTotals(
  ctx: OpsCtx,
  withPrevious = true,
): Promise<{
  current: MetricValues;
  previous: MetricValues;
  externalQualityAvailable: boolean;
}> {
  const view = await loadView(ctx);
  const prev = previousPeriod(ctx.f);
  const [cur, pre] = await Promise.all([
    computeRows(ctx, "all", view),
    withPrevious
      ? computeRows({ ...ctx, f: { ...ctx.f, ...prev } }, "all", view)
      : Promise.resolve(null),
  ]);
  return {
    current: cur.rows.get("all") ?? {},
    previous: pre?.rows.get("all") ?? {},
    externalQualityAvailable: cur.externalQualityAvailable,
  };
}

export async function computeGroups(
  ctx: OpsCtx,
  dim: OpsDimension,
  sort: string,
  dir: "asc" | "desc",
  limit: number,
): Promise<{
  rows: OpsRow[];
  total: number;
  externalQualityAvailable: boolean;
}> {
  const { rows, externalQualityAvailable } = await computeRows(ctx, dim);
  const sortKey = OPS_METRICS.some((m) => m.id === sort) ? sort : "hc_closing";
  const list = [...rows.entries()].sort(([, a], [, b]) => {
    const av = a[sortKey],
      bv = b[sortKey];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return dir === "asc" ? av - bv : bv - av;
  });
  const page = list.slice(0, limit);
  const names = await resolveNames(
    dim,
    page.map(([id]) => id),
  );
  return {
    rows: page.map(([id, m]) => ({
      id,
      name: names.get(id)?.name ?? "—",
      sub: names.get(id)?.sub ?? null,
      m,
    })),
    total: list.length,
    externalQualityAvailable,
  };
}

export interface TrendPoint {
  date: string;
  attendancePct: number | null;
  shrinkagePct: number | null;
  absentPct: number | null;
  latePct: number | null;
  exits: number;
  joiners: number;
}

/** Daily series over the window; attendance stops at the latest complete load date. */
export async function computeTrend(ctx: OpsCtx): Promise<TrendPoint[]> {
  const { from, to } = ctx.f;
  const attTo = to < ctx.attThrough ? to : ctx.attThrough;
  const view = await loadView(ctx);
  const rows = from > attTo ? [] : await F.adrRows(from, attTo);

  type Day = {
    sched: number;
    present: number;
    half: number;
    leave: number;
    absent: number;
    missing: number;
    late: number;
    worked: number;
  };
  const byDay = new Map<string, Day>();
  for (const r of rows) {
    if (!view.byId.has(r.eid)) continue;
    const d = byDay.get(r.d) ?? {
      sched: 0,
      present: 0,
      half: 0,
      leave: 0,
      absent: 0,
      missing: 0,
      late: 0,
      worked: 0,
    };
    if (!["week_off", "holiday", "week_off_worked"].includes(r.st)) d.sched++;
    if (r.st === "present") d.present++;
    if (r.st === "half_day") d.half++;
    if (r.st === "leave_approved") d.leave++;
    if (r.st === "absent") d.absent++;
    if (r.st === "missing_punch" || r.st === "unreconciled") d.missing++;
    if (r.late) d.late++;
    if (r.st === "present" || r.st === "half_day") d.worked++;
    byDay.set(r.d, d);
  }
  const exitBy = new Map<string, number>();
  const joinBy = new Map<string, number>();
  for (const e of view.emps) {
    if (e.status === "not_joined") continue;
    if (exitedIn(e, from, to))
      exitBy.set(exitDateOf(e)!, (exitBy.get(exitDateOf(e)!) ?? 0) + 1);
    if (e.doj && e.doj >= from && e.doj <= to)
      joinBy.set(e.doj, (joinBy.get(e.doj) ?? 0) + 1);
  }

  const points: TrendPoint[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = byDay.get(d);
    let attendancePct: number | null = null,
      shrinkagePct: number | null = null,
      absentPct: number | null = null,
      latePct: number | null = null;
    if (r) {
      attendancePct = pct(r.present + r.half / 2, r.sched - r.leave);
      shrinkagePct = pct(r.leave + r.absent + r.missing + r.half / 2, r.sched);
      absentPct = pct(r.absent, r.sched);
      latePct = pct(r.late, r.worked);
    }
    points.push({
      date: d,
      attendancePct,
      shrinkagePct,
      absentPct,
      latePct,
      exits: exitBy.get(d) ?? 0,
      joiners: joinBy.get(d) ?? 0,
    });
  }
  return points;
}

export interface FilterOption {
  id: string;
  name: string;
  sub?: string | null;
}

/** Cascading, scope-limited filter options derived from the scoped employee view (no extra employees scans). */
export async function computeFilterOptions(ctx: OpsCtx): Promise<{
  branches: FilterOption[];
  processes: FilterOption[];
  lobs: FilterOption[];
  managers: FilterOption[];
}> {
  const all = (
    await loadView({ ...ctx, f: { from: ctx.f.from, to: ctx.f.to } })
  ).emps.filter((e) => e.active === 1);
  const uniq = (xs: Array<string | null>) => [
    ...new Set(xs.filter((x): x is string => !!x)),
  ];
  const { branchId, processId, lobId } = ctx.f;
  const okB = (e: (typeof all)[number]) =>
    !branchId || branchId === NONE_ID ? true : e.branch === branchId;
  const okP = (e: (typeof all)[number]) =>
    !processId || processId === NONE_ID ? true : e.process === processId;
  const okL = (e: (typeof all)[number]) =>
    !lobId || lobId === NONE_ID ? true : e.lob === lobId;

  const branchIds = uniq(all.map((e) => e.branch));
  const processIds = uniq(all.filter(okB).map((e) => e.process));
  const lobIds = uniq(all.filter((e) => okB(e) && okP(e)).map((e) => e.lob));
  const mgrCounts = new Map<string, number>();
  for (const e of all.filter((x) => okB(x) && okP(x) && okL(x)))
    if (e.mgr) mgrCounts.set(e.mgr, (mgrCounts.get(e.mgr) ?? 0) + 1);

  const [b, p, l, m] = await Promise.all([
    resolveNames("branch", branchIds),
    resolveNames("process", processIds),
    resolveNames("lob", lobIds),
    resolveNames("manager", [...mgrCounts.keys()]),
  ]);
  const opts = (
    ids: string[],
    names: Map<string, { name: string; sub: string | null }>,
  ): FilterOption[] =>
    ids
      .map((id) => ({
        id,
        name: names.get(id)?.name ?? "—",
        sub: names.get(id)?.sub ?? null,
      }))
      .sort((x, y) => x.name.localeCompare(y.name));
  return {
    branches: opts(branchIds, b),
    processes: opts(processIds, p),
    lobs: opts(lobIds, l),
    managers: opts([...mgrCounts.keys()], m).slice(0, 500),
  };
}

export { NONE_ID };
