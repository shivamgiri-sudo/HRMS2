import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { addDays, daysBetween, pct, previousPeriod, round, type OpsCtx, type OpsDimension } from "./ops-command.context.js";
import { exitDateOf, isActiveAt, loadView } from "./ops-command.dim.js";
import * as F from "./ops-command.facts.js";
import { memo } from "./ops-command.cache.js";
import { resolveNames } from "./ops-command.names.js";
import { computeRows, computeTrend, type MetricValues } from "./ops-command.service.js";
import { rosterRows } from "./ops-command.facts.js";
import { headcountDomain } from "./ops-command.domains.js";

export type Severity = "critical" | "warning" | "info" | "good";

export interface Insight {
  id: string;
  severity: Severity;
  domain: string;
  title: string;
  detail: string;
  /** Where clicking the insight should land. */
  action?: { tab: string; groupBy?: OpsDimension; filter?: { key: "branch" | "process" | "lob" | "manager"; id: string } };
}

const SEV_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2, good: 3 };
const num = (v: number | null | undefined) => v ?? 0;

interface Row { id: string; name: string; m: MetricValues }

async function rowsWithNames(ctx: OpsCtx, dim: OpsDimension): Promise<{ rows: Row[]; total: MetricValues }> {
  const [{ rows }, tot] = await Promise.all([computeRows(ctx, dim), computeRows(ctx, "all")]);
  const names = await resolveNames(dim, [...rows.keys()]);
  return { rows: [...rows.entries()].map(([id, m]) => ({ id, name: names.get(id)?.name ?? "—", m })), total: tot.rows.get("all") ?? {} };
}

const FILTER_KEY: Partial<Record<OpsDimension, "branch" | "process" | "lob" | "manager">> = { branch: "branch", process: "process", lob: "lob", manager: "manager" };

/**
 * Rule-based "what should I look at" list. Every rule is a comparison of a group against the whole scope on numbers
 * the page already shows, so each insight can be checked against a table.
 */
export async function computeInsights(ctx: OpsCtx): Promise<Insight[]> {
  const out: Insight[] = [];
  const [proc, branch, trend, prev] = await Promise.all([
    rowsWithNames(ctx, "process"),
    rowsWithNames(ctx, "branch"),
    computeTrend(ctx),
    computeRows({ ...ctx, f: { ...ctx.f, ...previousPeriod(ctx.f) } }, "all").then((r) => r.rows.get("all") ?? {}),
  ]);
  const org = proc.total;
  const push = (i: Insight) => out.push(i);

  // 1. Where shrinkage comes from: excess lost days vs the scope average.
  for (const [dim, set] of [["process", proc], ["branch", branch]] as const) {
    const orgRate = num(org.shrinkage_pct);
    const drivers = set.rows
      .filter((r) => num(r.m.scheduled_days) >= 100 && r.m.shrinkage_pct !== null && r.m.shrinkage_pct !== undefined)
      .map((r) => ({ r, excess: ((num(r.m.shrinkage_pct) - orgRate) / 100) * num(r.m.scheduled_days) }))
      .filter((x) => x.excess > 0 && num(x.r.m.shrinkage_pct) >= orgRate + 4)
      .sort((a, b) => b.excess - a.excess)
      .slice(0, dim === "process" ? 2 : 1);
    const totalLost = (orgRate / 100) * num(org.scheduled_days);
    for (const { r, excess } of drivers) {
      push({
        id: `shr-${dim}-${r.id}`, severity: num(r.m.shrinkage_pct) > 25 ? "critical" : "warning", domain: "shrinkage",
        title: `${r.name}: shrinkage ${r.m.shrinkage_pct}% vs ${orgRate}% overall`,
        detail: `${Math.round(excess).toLocaleString("en-IN")} loss-days above the scope average${totalLost ? ` — ${Math.round((excess / totalLost) * 100)}% of all lost days` : ""}. Absence ${r.m.absence_shrinkage_pct ?? "—"}%, missing punch ${r.m.missing_punch_pct ?? "—"}%.`,
        action: { tab: "shrinkage", groupBy: "manager", filter: { key: FILTER_KEY[dim]!, id: r.id } },
      });
    }
  }

  // 2. Missing punches: a data/feed problem, not attendance behaviour.
  const mp = proc.rows.filter((r) => num(r.m.scheduled_days) >= 100 && num(r.m.missing_punch_pct) >= 15).sort((a, b) => num(b.m.missing_punch_pct) - num(a.m.missing_punch_pct))[0];
  if (num(org.missing_punch_pct) >= 10) {
    push({
      id: "missing-punch", severity: num(org.missing_punch_pct) >= 20 ? "critical" : "warning", domain: "attendance",
      title: `${org.missing_punch_pct}% of scheduled days have no usable punch`,
      detail: `${Math.round(num(org.missing_punch_days)).toLocaleString("en-IN")} days are counted as shrinkage only because no punch was recorded${mp ? `; worst is ${mp.name} at ${mp.m.missing_punch_pct}%` : ""}. Fix punch capture / attendance sync before reading shrinkage as absence.`,
      action: { tab: "attendance", groupBy: "process", ...(mp ? { filter: undefined } : {}) },
    });
  }

  // 3. Attrition hotspots.
  const orgAttr = num(org.attrition_pct);
  for (const r of proc.rows.filter((x) => num(x.m.hc_avg) >= 20 && num(x.m.exits) >= 3 && num(x.m.attrition_pct) > Math.max(orgAttr * 1.5, 5)).sort((a, b) => num(b.m.attrition_pct) - num(a.m.attrition_pct)).slice(0, 2)) {
    push({
      id: `attr-${r.id}`, severity: "critical", domain: "attrition",
      title: `${r.name}: attrition ${r.m.attrition_pct}% (${r.m.exits} exits) vs ${orgAttr}% overall`,
      detail: `${r.m.exits_0_30 !== undefined ? num(r.m.exits_0_30) + num(r.m.exits_31_90) : "—"} of the exits left within 90 days; ${num(r.m.notice_hc)} more are serving notice.`,
      action: { tab: "attrition", groupBy: "manager", filter: { key: "process", id: r.id } },
    });
  }
  if (num(org.early_attrition_pct) >= 40 && num(org.exits) >= 10) {
    push({
      id: "early-attr", severity: "warning", domain: "attrition",
      title: `${org.early_attrition_pct}% of exits leave within 90 days`,
      detail: `${num(org.exits_0_30) + num(org.exits_31_90)} of ${org.exits} exits. Points at hiring quality, training or first-month experience rather than mature-team churn.`,
      action: { tab: "attrition", groupBy: "process" },
    });
  }

  // 4. Notice pipeline.
  if (num(org.notice_hc) > 0) {
    const share = pct(num(org.notice_hc), num(org.hc_closing));
    push({
      id: "notice", severity: (share ?? 0) >= 3 ? "warning" : "info", domain: "attrition",
      title: `${org.notice_hc} people are serving notice${share !== null ? ` (${share}% of headcount)` : ""}`,
      detail: `${num(org.lwd_next_30)} last working days fall in the next 30 days; ${num(org.pending_resignations)} more resignations await review. Backfill need: ${num(org.backfill_need)}.`,
      action: { tab: "attrition", groupBy: "process" },
    });
  }

  // 5. Roster gaps.
  if (num(org.roster_coverage_pct) > 0 && num(org.roster_coverage_pct) < 95) {
    const gap = Math.round(num(org.hc_closing) * (1 - num(org.roster_coverage_pct) / 100));
    push({
      id: "roster-cover", severity: num(org.roster_coverage_pct) < 90 ? "warning" : "info", domain: "roster",
      title: `${gap} active people have no roster in this period`,
      detail: `Roster coverage is ${org.roster_coverage_pct}%. Unrostered people cannot be scheduled, measured for adherence or paid roster-linked benefits.`,
      action: { tab: "roster", groupBy: "process" },
    });
  }
  if (num(org.roster_adherence_pct) > 0 && num(org.roster_adherence_pct) < 80) {
    push({
      id: "adherence", severity: "warning", domain: "roster",
      title: `Roster adherence is ${org.roster_adherence_pct}%`,
      detail: `Only ${org.roster_adherence_pct}% of rostered working days ended with the person working. Compare with absence (${org.absent_pct}%) and missing punches (${org.missing_punch_pct}%).`,
      action: { tab: "roster", groupBy: "process" },
    });
  }

  // 6. Mandate.
  for (const r of proc.rows.filter((x) => x.m.mandate_hc !== undefined && num(x.m.mandate_hc) >= 15 && num(x.m.mandate_gap) >= 10 && num(x.m.mandate_fill_pct) < 90).sort((a, b) => num(b.m.mandate_gap) - num(a.m.mandate_gap)).slice(0, 2)) {
    push({
      id: `mandate-${r.id}`, severity: "warning", domain: "hiring",
      title: `${r.name} is ${r.m.mandate_gap} short of mandate (${r.m.mandate_fill_pct}% filled)`,
      detail: `Mandated ${r.m.mandate_hc}, headcount ${r.m.hc_closing}, ${num(r.m.notice_hc)} on notice, ${num(r.m.open_positions)} open positions.`,
      action: { tab: "hiring", groupBy: "process", filter: { key: "process", id: r.id } },
    });
  }

  // 7. High-risk agents.
  if (num(org.risk_high) > 0) {
    push({
      id: "risk", severity: num(org.risk_high) >= 25 ? "warning" : "info", domain: "risk",
      title: `${org.risk_high} agents are high retention risk`,
      detail: `${num(org.risk_medium)} more are medium. Open the list to see each person's reasons (absence, warnings, notice, new joiner, low quality…).`,
      action: { tab: "attrition", groupBy: "manager" },
    });
  }

  // 8. Trend movement: last 7 days vs the 7 before.
  // The last two attendance days are still settling (late punches / sync), so they are excluded from trend rules.
  const pts = trend.filter((t) => t.attendancePct !== null).slice(0, -2);
  if (pts.length >= 10) {
    const avg = (xs: Array<number | null>) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const last = avg(pts.slice(-7).map((p) => p.attendancePct)), before = avg(pts.slice(-14, -7).map((p) => p.attendancePct));
    if (last !== null && before !== null && Math.abs(last - before) >= 5) {
      const dn = last < before;
      push({
        id: "trend-att", severity: dn ? "warning" : "good", domain: "attendance",
        title: `Attendance ${dn ? "fell" : "rose"} ${Math.abs(Math.round((last - before) * 10) / 10)} points in the last 7 days`,
        detail: `${round(last, 1)}% over the last 7 recorded days vs ${round(before, 1)}% the 7 days before.`,
        action: { tab: "attendance", groupBy: "process" },
      });
    }
    const worst = [...pts].sort((a, b) => num(b.absentPct) - num(a.absentPct))[0];
    const meanAbs = avg(pts.map((p) => p.absentPct)) ?? 0;
    if (worst && num(worst.absentPct) > meanAbs * 1.8 && num(worst.absentPct) >= 8) {
      push({
        id: "trend-spike", severity: "info", domain: "attendance",
        title: `Absence spiked to ${worst.absentPct}% on ${worst.date.split("-").reverse().join("/")}`,
        detail: `Average for the period is ${round(meanAbs, 1)}%. Open the heatmap to see which groups drove that day.`,
        action: { tab: "attendance", groupBy: "process" },
      });
    }
  }

  // 9. Period-over-period headline movement.
  if (prev.attrition_pct !== undefined && prev.attrition_pct !== null && num(org.attrition_pct) - num(prev.attrition_pct) >= 3) {
    push({
      id: "attr-delta", severity: "warning", domain: "attrition",
      title: `Attrition rose from ${prev.attrition_pct}% to ${org.attrition_pct}% vs the previous period`,
      detail: `${num(org.exits)} exits this period vs ${num(prev.exits)} before.`,
      action: { tab: "attrition", groupBy: "process" },
    });
  }

  // 10. Best performer, so the list is not only bad news.
  const best = proc.rows.filter((r) => num(r.m.scheduled_days) >= 150 && r.m.attendance_pct !== null && r.m.attendance_pct !== undefined).sort((a, b) => num(b.m.attendance_pct) - num(a.m.attendance_pct))[0];
  if (best && num(best.m.attendance_pct) > num(org.attendance_pct) + 5) {
    push({ id: `best-${best.id}`, severity: "good", domain: "attendance", title: `${best.name} leads on attendance at ${best.m.attendance_pct}%`, detail: `${round(num(best.m.attendance_pct) - num(org.attendance_pct), 1)} points above the scope average of ${org.attendance_pct}%.`, action: { tab: "attendance", groupBy: "manager", filter: { key: "process", id: best.id } } });
  }

  return out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]).slice(0, 14);
}

export interface CohortRow {
  month: string;
  joined: number;
  stillActive: number;
  left30: number;
  left60: number;
  left90: number;
  retention30: number | null;
  retention60: number | null;
  retention90: number | null;
}

/** Joining-month cohorts: how many of each month's joiners were gone within 30 / 60 / 90 days. */
export async function computeCohorts(ctx: OpsCtx, months = 12): Promise<CohortRow[]> {
  const view = await loadView(ctx);
  const end = ctx.today;
  const startMonth = new Date(`${end}T00:00:00Z`);
  startMonth.setUTCMonth(startMonth.getUTCMonth() - (months - 1), 1);
  const startKey = startMonth.toISOString().slice(0, 7);
  const map = new Map<string, CohortRow>();
  const seasoned = (doj: string, days: number) => daysBetween(doj, end) - 1 >= days;
  for (const e of view.emps) {
    if (!e.doj || e.status === "not_joined") continue;
    const key = e.doj.slice(0, 7);
    if (key < startKey || e.doj > end) continue;
    const row = map.get(key) ?? { month: key, joined: 0, stillActive: 0, left30: 0, left60: 0, left90: 0, retention30: null, retention60: null, retention90: null };
    row.joined++;
    if (isActiveAt(e, end)) row.stillActive++;
    const x = exitDateOf(e);
    if (x) {
      const t = daysBetween(e.doj, x) - 1;
      if (t <= 30) row.left30++;
      if (t <= 60) row.left60++;
      if (t <= 90) row.left90++;
    }
    map.set(key, row);
  }
  const rows = [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const r of rows) {
    // A cohort is only judged at 30/60/90 once its youngest member could have reached that tenure.
    const lastDay = `${r.month}-28`;
    r.retention30 = seasoned(lastDay, 30) ? pct(r.joined - r.left30, r.joined) : null;
    r.retention60 = seasoned(lastDay, 60) ? pct(r.joined - r.left60, r.joined) : null;
    r.retention90 = seasoned(lastDay, 90) ? pct(r.joined - r.left90, r.joined) : null;
  }
  return rows;
}

export interface ForecastDay {
  date: string;
  weekday: string;
  rostered: number;
  expectedPresent: number;
  mandate: number | null;
  gap: number | null;
}

/** Next 14 days: people rostered to work vs the mandate, after applying the recent shrinkage rate. */
export async function computeForecast(ctx: OpsCtx): Promise<{ days: ForecastDay[]; shrinkagePct: number | null; mandate: number | null }> {
  const from = ctx.today;
  const to = addDays(ctx.today, 13);
  const view = await loadView(ctx);
  const [rows, hc, cur] = await Promise.all([rosterRows(from, to), headcountDomain(ctx, "all", view), computeRows(ctx, "all", view)]);
  const c = cur.rows.get("all");
  // Missing punches are people who mostly did work; only planned leave + absence reduce expected presence.
  const shrinkage = c && c.planned_shrinkage_pct !== undefined ? round(num(c.planned_shrinkage_pct) + num(c.absence_shrinkage_pct), 1) : null;
  const mandate = hc.get("all")?.mandate_hc ?? null;
  const byDay = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.working || !view.byId.has(r.eid)) continue;
    const s = byDay.get(r.d) ?? new Set<string>();
    s.add(r.eid);
    byDay.set(r.d, s);
  }
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days: ForecastDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const rostered = byDay.get(d)?.size ?? 0;
    const expected = Math.round(rostered * (1 - (shrinkage ?? 0) / 100));
    days.push({ date: d, weekday: WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()], rostered, expectedPresent: expected, mandate, gap: mandate === null ? null : expected - mandate });
  }
  return { days, shrinkagePct: shrinkage, mandate };
}

export interface Freshness {
  feed: string;
  latest: string | null;
  note: string;
  stale: boolean;
}

/** How current each source is, so a stale feed is visible instead of silently reading as "no problems". */
export function computeFreshness(today: string): Promise<Freshness[]> {
  return memo(`fresh|${today}`, async () => {
    const one = async (feed: string, sql: string, note: string, staleAfterDays: number): Promise<Freshness> => {
      try {
        const [r] = await db.execute<RowDataPacket[]>(sql);
        const latest = (r[0]?.d as string | null) ?? null;
        const stale = !latest || daysBetween(latest, today) - 1 > staleAfterDays;
        return { feed, latest, note, stale };
      } catch {
        return { feed, latest: null, note: `${note} (unavailable)`, stale: true };
      }
    };
    return Promise.all([
      one("Attendance", `SELECT DATE_FORMAT(MAX(record_date),'%Y-%m-%d') AS d FROM attendance_daily_record WHERE record_date <= CURDATE()`, "attendance_daily_record", 1),
      one("Roster", `SELECT DATE_FORMAT(MAX(roster_date),'%Y-%m-%d') AS d FROM wfm_roster_assignment`, "wfm_roster_assignment (latest rostered date)", 0),
      one("Agent KPIs", `SELECT DATE_FORMAT(MAX(score_date),'%Y-%m-%d') AS d FROM kpi_daily_actual`, "kpi_daily_actual", 3),
      one("Process feeds", `SELECT DATE_FORMAT(MAX(score_date),'%Y-%m-%d') AS d FROM process_metric_actual`, "process_metric_actual", 3),
      one("Breaks", `SELECT DATE_FORMAT(MAX(shift_date),'%Y-%m-%d') AS d FROM break_daily_summary`, "break_daily_summary", 2),
      one("Calls", `SELECT DATE_FORMAT(MAX(activity_date),'%Y-%m-%d') AS d FROM integration_call_daily`, "integration_call_daily", 3),
      one("Call quality", `SELECT DATE_FORMAT(MAX(CallDate),'%Y-%m-%d') AS d FROM db_audit.call_quality_assessment`, "db_audit.call_quality_assessment", 3),
    ]);
  }, 10 * 60 * 1000);
}
void F;
