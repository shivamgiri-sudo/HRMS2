import type { RowDataPacket } from "mysql2";
import { memo } from "../../../operations/ops-command.cache.js";
import { resolveNames } from "../../../operations/ops-command.names.js";
import { num, rows, severityFor, toneFor } from "../helpers.js";
import type { InsightAction, InsightContext, InsightKpi, InsightProvider, InsightSection, InsightSeries, InsightSignal, InsightTable } from "../types.js";
import {
  AGENT_THRESHOLD_PCT, FAIL_BELOW_PCT, MIN_AUDITS_FOR_AGENT, QA_PARAMETERS, QUALITY_TARGET_PCT, coveragePct, defectRates, failRatePct,
  pendingAudits, qualityHealth, scoreTone,
} from "./qualityCalc.js";
import { addDaysIso, deltaPoints, guarded, memoFor, opsViewFor, scopeIsEmptyTeam, shortDay, toAction } from "./mgmtOpsQaShared.js";

/**
 * QUALITY_DASHBOARD insights.
 *
 * Source of truth: db_audit.call_quality_assessment (one AI-scored row per assessed call; `quality_percentage` NULL
 * means assessed but NOT scored) and db_external.CallDetails (every analysed call, incl. the explicit `Fatal` flag).
 * Both are large (480k / 470k rows), so each is read ONCE as an org-wide per-(agent, day) aggregate, cached for five
 * minutes and shared by every viewer; every consumer then filters it through the caller's scoped employee view
 * (agent = employee_code), so a cache hit can never widen scope. Window = the last 30 days ending today; deltas are
 * against the 30 before.
 */

const DASH = "/quality-dashboard";
const WINDOW_DAYS = 30;
const COLL = "COLLATE utf8mb4_unicode_ci";

interface Win { from: string; to: string; label: string }
const windows = (today: string): { cur: Win; prev: Win } => ({
  cur: { from: addDaysIso(today, -(WINDOW_DAYS - 1)), to: today, label: `${shortDay(addDaysIso(today, -(WINDOW_DAYS - 1)))} - ${shortDay(today)}` },
  prev: { from: addDaysIso(today, -(2 * WINDOW_DAYS - 1)), to: addDaysIso(today, -WINDOW_DAYS), label: "previous 30 days" },
});

interface CqaDay { u: string; d: string; assessed: number; scored: number; sumq: number; failed: number }
interface TatDay { u: string; d: string; tatN: number; tatSum: number; within24: number }
interface ParamDay { u: string; d: string; f: number[]; n: number[] }
interface CdDay { u: string; d: string; calls: number; fatal: number; evaluated: number }

/** Cheap per-(agent, day) score facts: served by the CallDate covering index (about 3s for 60 days, then cached). */
function cqaFacts(today: string): Promise<CqaDay[]> {
  const from = addDaysIso(today, -(2 * WINDOW_DAYS - 1));
  return memo(`q-cqa|${from}|${today}`, async () => {
    const r = await rows<RowDataPacket>(
      `SELECT q.User u, DATE_FORMAT(q.CallDate, '%Y-%m-%d') d, COUNT(*) assessed, SUM(q.quality_percentage IS NOT NULL) scored, COALESCE(SUM(q.quality_percentage), 0) sumq,
              SUM(q.quality_percentage < ${FAIL_BELOW_PCT}) failed
         FROM db_audit.call_quality_assessment q WHERE q.CallDate >= ? AND q.CallDate < ? AND q.User IS NOT NULL AND q.User <> '' GROUP BY q.User, d`,
      [from, addDaysIso(today, 1)],
    );
    return r.map((x) => ({ u: String(x.u), d: String(x.d), assessed: num(x.assessed) ?? 0, scored: num(x.scored) ?? 0, sumq: num(x.sumq) ?? 0, failed: num(x.failed) ?? 0 }));
  });
}
const TAT = "TIMESTAMPDIFF(MINUTE, q.CallDate, q.created_at)";
/** Turn-around facts need the wide rows (about 5s for 30 days): read once for the current window, cached. */
function tatFacts(today: string): Promise<TatDay[]> {
  const from = addDaysIso(today, -(WINDOW_DAYS - 1));
  return memo(`q-tat|${from}|${today}`, async () => {
    const r = await rows<RowDataPacket>(
      `SELECT q.User u, DATE_FORMAT(q.CallDate, '%Y-%m-%d') d, SUM(CASE WHEN ${TAT} BETWEEN 0 AND 43200 THEN 1 ELSE 0 END) tat_n,
              COALESCE(SUM(CASE WHEN ${TAT} BETWEEN 0 AND 43200 THEN ${TAT} END), 0) tat_sum, SUM(CASE WHEN ${TAT} BETWEEN 0 AND 1440 THEN 1 ELSE 0 END) within24
         FROM db_audit.call_quality_assessment q WHERE q.CallDate >= ? AND q.CallDate < ? AND q.User IS NOT NULL AND q.User <> '' GROUP BY q.User, d`,
      [from, addDaysIso(today, 1)],
    );
    return r.map((x) => ({ u: String(x.u), d: String(x.d), tatN: num(x.tat_n) ?? 0, tatSum: num(x.tat_sum) ?? 0, within24: num(x.within24) ?? 0 }));
  });
}
/** Per-parameter failed/evaluated counts need every evaluation column (about 15s cold for 30 days): read once, cached. */
function paramFacts(today: string): Promise<ParamDay[]> {
  const from = addDaysIso(today, -(WINDOW_DAYS - 1));
  return memo(`q-param|${from}|${today}`, async () => {
    const cols = QA_PARAMETERS.map((p, i) => `SUM(CASE WHEN q.${p.col} = 0 THEN 1 ELSE 0 END) f${i}, COUNT(q.${p.col}) n${i}`).join(", ");
    const r = await rows<RowDataPacket>(
      `SELECT q.User u, DATE_FORMAT(q.CallDate, '%Y-%m-%d') d, ${cols}
         FROM db_audit.call_quality_assessment q WHERE q.CallDate >= ? AND q.CallDate < ? AND q.User IS NOT NULL AND q.User <> '' GROUP BY q.User, d`,
      [from, addDaysIso(today, 1)],
    );
    return r.map((x) => ({ u: String(x.u), d: String(x.d), f: QA_PARAMETERS.map((_, i) => num(x[`f${i}`]) ?? 0), n: QA_PARAMETERS.map((_, i) => num(x[`n${i}`]) ?? 0) }));
  });
}
/** Current window only: CallDetails rows are wide (~2.5 KB), so a 60-day read would double the cold cost for a delta nobody asked for. */
function cdFacts(today: string): Promise<CdDay[]> {
  const from = addDaysIso(today, -(WINDOW_DAYS - 1));
  return memo(`q-cd|${from}|${today}`, async () => {
    const r = await rows<RowDataPacket>(
      `SELECT cd.AgentName u, DATE_FORMAT(cd.CallDate, '%Y-%m-%d') d, COUNT(*) calls, SUM(cd.Fatal = '1') fatal, SUM(cd.Fatal IS NOT NULL AND cd.Fatal <> '') evaluated
         FROM db_external.CallDetails cd WHERE cd.CallDate >= ? AND cd.CallDate < ? AND cd.AgentName IS NOT NULL GROUP BY cd.AgentName, d`,
      [from, addDaysIso(today, 1)],
    );
    return r.map((x) => ({ u: String(x.u), d: String(x.d), calls: num(x.calls) ?? 0, fatal: num(x.fatal) ?? 0, evaluated: num(x.evaluated) ?? 0 }));
  });
}

/**
 * These reads scan wide rows, so a cold one can take longer than a dashboard section may. Give up waiting after `ms`
 * (the read keeps running and is cached for everyone) and let the caller say "still loading" instead of failing.
 */
async function soft<T>(p: Promise<T>, ms = 7_000): Promise<T | null> {
  p.catch(() => undefined);
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);
}
export const CD_PENDING = "Call-analysis volume is still loading - refresh in a moment.";
export const PARAM_PENDING = "Parameter-level results are still loading from the audit table - refresh in a moment.";

/** Agent identifiers that are employee codes. Anything else (e.g. a typed name) cannot be tied to an employee or a scope. */
const CODE_RE = /^MAS\d+$/;

/**
 * Facts restricted to the caller's scoped employees (matched on employee_code). An org-wide caller (no scope narrowing)
 * keeps every row, including agents recorded by name; a narrower scope can only see rows tied to its employees, and
 * `unattributedPct` says how much of the audited volume that leaves out so the gap is never silent.
 */
const scoped = (ctx: InsightContext) => memoFor(ctx, "q-scoped", async () => {
  const [{ view }, qa, cd, tat, par] = await Promise.all([opsViewFor(ctx), cqaFacts(ctx.today), soft(cdFacts(ctx.today)), soft(tatFacts(ctx.today)), soft(paramFacts(ctx.today))]);
  const orgWide = ctx.scope.level === "ORG_ALL" && !ctx.branchId && !ctx.processId;
  const keep = (u: string) => (orgWide ? true : view.byCode.has(u));
  const scoredRows = qa.reduce((s, r) => s + r.scored, 0);
  const nameRows = qa.filter((r) => !CODE_RE.test(r.u)).reduce((s, r) => s + r.scored, 0);
  return {
    view, orgWide, qa: qa.filter((r) => keep(r.u)), cd: cd ? cd.filter((r) => keep(r.u)) : null,
    tat: tat ? tat.filter((r) => keep(r.u)) : null, params: par ? par.filter((r) => keep(r.u)) : null,
    unattributedPct: scoredRows ? Math.round((nameRows / scoredRows) * 1000) / 10 : null,
  };
});

const blocked = (ctx: InsightContext): InsightSection | null =>
  scopeIsEmptyTeam(ctx) ? { signals: [{ tone: "watch", title: "No quality scope", detail: "This account has no branch, process or team mapped, so no audits can be attributed to it." }] } : null;

const inWin = (d: string, w: Win) => d >= w.from && d <= w.to;
function windowStats(qa: CqaDay[], cd: CdDay[] | null, tat: TatDay[] | null, w: Win) {
  const q = qa.filter((r) => inWin(r.d, w));
  const c = cd ? cd.filter((r) => inWin(r.d, w)) : [];
  const sum = (f: (r: CqaDay) => number) => q.reduce((s, r) => s + f(r), 0);
  const assessed = sum((r) => r.assessed);
  const scored = sum((r) => r.scored);
  const t = tat ? tat.filter((r) => inWin(r.d, w)) : [];
  const tatN = t.reduce((s, r) => s + r.tatN, 0);
  const total = c.reduce((s, r) => s + r.calls, 0);
  return {
    assessed, scored: assessed ? scored : null,
    avg: scored ? Math.round((sum((r) => r.sumq) / scored) * 100) / 100 : null,
    failed: assessed ? sum((r) => r.failed) : null,
    agents: new Set(q.filter((r) => r.scored > 0).map((r) => r.u)).size,
    tatH: tatN ? Math.round((t.reduce((s, r) => s + r.tatSum, 0) / tatN / 60) * 10) / 10 : null,
    within24: tatN ? Math.round((t.reduce((s, r) => s + r.within24, 0) / tatN) * 1000) / 10 : null,
    total: cd && c.length ? total : null, fatal: cd && c.length ? c.reduce((s, r) => s + r.fatal, 0) : null,
    fatalEvaluatedPct: cd && c.length && total ? Math.round((c.reduce((s, r) => s + r.evaluated, 0) / total) * 1000) / 10 : null,
  };
}
const stats = (ctx: InsightContext) => memoFor(ctx, "q-stats", async () => {
  const { qa, cd, tat } = await scoped(ctx);
  const w = windows(ctx.today);
  return { cur: windowStats(qa, cd, tat, w.cur), prev: windowStats(qa, cd, null, w.prev), w };
});

// ── Headline KPIs ──────────────────────────────────────────────────────────────────────────────
async function overview(ctx: InsightContext): Promise<InsightSection> {
  const b = blocked(ctx);
  if (b) return b;
  const [{ cur, prev, w }, sc] = await Promise.all([stats(ctx), scoped(ctx)]);
  const win = `${w.cur.label} vs previous 30 days`;
  const cov = coveragePct(cur.scored, cur.total);
  const covPrev = coveragePct(prev.scored, prev.total);
  const fail = failRatePct(cur.failed, cur.scored);
  const failPrev = failRatePct(prev.failed, prev.scored);
  const pending = pendingAudits(cur.total, cur.scored);
  const unscored = cur.scored !== null ? cur.assessed - cur.scored : null;
  const noData = (v: number | null) => (v === null ? "No audited calls in this window for your scope" : null);

  const kpis: InsightKpi[] = [
    { key: "q_score", label: "Avg quality score", value: cur.avg, unit: "percent", delta: deltaPoints(cur.avg, prev.avg), deltaLabel: win, tone: scoreTone(cur.avg), helper: `target ${QUALITY_TARGET_PCT}% (org default - no process targets configured)`, formula: "AVG(quality_percentage) over SCORED calls only (NULL scores excluded).", href: DASH, unavailable: noData(cur.avg) },
    { key: "q_coverage", label: "Audit coverage", value: cov, unit: "percent", delta: deltaPoints(cov, covPrev), deltaLabel: win, tone: "blue", helper: "no coverage target configured", formula: "Calls with a quality score / calls analysed (db_external.CallDetails) in the window.", href: DASH, unavailable: cov === null ? CD_PENDING : null },
    { key: "q_audited", label: "Calls audited", value: cur.scored, unit: "count", delta: cur.scored !== null && prev.scored !== null ? cur.scored - prev.scored : null, deltaLabel: win, tone: "blue", formula: "Assessed calls that carry a quality score.", href: DASH, unavailable: noData(cur.scored) },
    { key: "q_pending", label: "Pending audits", value: pending, unit: "count", higherIsBetter: false, tone: toneFor(pending !== null && cur.total ? (pending / cur.total) * 100 : null, 25, 50, false), helper: `${cur.total ?? "-"} analysed - ${cur.scored ?? "-"} audited`, formula: "Calls analysed - calls scored, floored at 0. Includes calls assessed without a score.", href: DASH, unavailable: pending === null ? CD_PENDING : null },
    { key: "q_fail", label: "Fail rate", value: fail, unit: "percent", delta: deltaPoints(fail, failPrev), deltaLabel: win, higherIsBetter: false, tone: toneFor(fail, 10, 20, false), formula: `Scored calls below ${FAIL_BELOW_PCT}% / scored calls.`, href: DASH, unavailable: noData(fail) },
    { key: "q_fatal", label: "Fatal-error calls", value: cur.fatal, unit: "count", higherIsBetter: false, tone: toneFor(cur.fatal, 0, 25, false), helper: cur.fatalEvaluatedPct === null ? undefined : `fatal flag evaluated on ${cur.fatalEvaluatedPct}% of analysed calls`, formula: "Calls flagged Fatal = 1 in call analysis. Shown as a count, not a rate: the flag is filled on only a minority of calls, so any denominator would mislead.", href: DASH, unavailable: cur.fatal === null ? CD_PENDING : null },
    { key: "q_unscored", label: "Assessed, not scored", value: unscored, unit: "count", higherIsBetter: false, tone: toneFor(unscored !== null && cur.assessed ? (unscored / cur.assessed) * 100 : null, 10, 30, false), formula: "Rows in the assessment table whose quality_percentage is NULL (the old 'pending audits' measured only this).", href: DASH, unavailable: unscored === null ? "Nothing assessed in this window" : null },
    { key: "q_tat", label: "Audit TAT", value: cur.tatH, unit: "hours", higherIsBetter: false, tone: toneFor(cur.tatH, 24, 48, false), helper: cur.within24 === null ? undefined : `${cur.within24}% assessed within 24h`, formula: "Average hours from call time to assessment creation (rows where assessment follows the call).", href: DASH, unavailable: cur.tatH === null ? "Turn-around times are still loading - refresh in a moment." : null },
  ];
  const h = qualityHealth({ avgScore: cur.avg, coverage: cov, failRate: fail });
  const signals: InsightSignal[] = [];
  if (cov !== null && cov < 60) signals.push({ tone: "watch", title: `Only ${cov}% of analysed calls carry a quality score`, detail: `${pending ?? "-"} calls are unscored - audit capacity, not agent quality, limits what this dashboard can see.`, value: `${cov}%`, href: DASH });
  if (cur.avg !== null && cur.avg < QUALITY_TARGET_PCT) signals.push({ tone: cur.avg < QUALITY_TARGET_PCT - 10 ? "bad" : "watch", title: `Quality ${cur.avg}% is below the ${QUALITY_TARGET_PCT}% target`, detail: prev.avg === null ? "No previous-period score to compare." : `${deltaPoints(cur.avg, prev.avg)! >= 0 ? "Up" : "Down"} ${Math.abs(deltaPoints(cur.avg, prev.avg)!)} pp on the previous 30 days.`, value: `${cur.avg}%`, href: DASH });
  else if (cur.avg !== null) signals.push({ tone: "good", title: `Quality ${cur.avg}% meets the ${QUALITY_TARGET_PCT}% target`, detail: "Over scored calls in the last 30 days.", href: DASH });
  if (!sc.orgWide && sc.unattributedPct !== null && sc.unattributedPct >= 5) signals.push({ tone: "watch", title: `${sc.unattributedPct}% of audited calls cannot be tied to an employee`, detail: "Their agent is recorded by name, not employee code, so they appear only in organisation-wide totals - your scoped numbers exclude them.", value: `${sc.unattributedPct}%`, href: DASH });
  return { kpis, signals, healthScore: h?.score ?? null, healthBasis: h?.basis ?? "Not enough audit data to score quality health." };
}

// ── Trend ────────────────────────────────────────────────────────────────────────────────────
async function trend(ctx: InsightContext): Promise<InsightSection> {
  const b = blocked(ctx);
  if (b) return b;
  const { qa, cd } = await scoped(ctx);
  const w = windows(ctx.today).cur;
  const byDay = new Map<string, { scored: number; sumq: number }>();
  for (const r of qa.filter((x) => inWin(x.d, w))) {
    const d = byDay.get(r.d) ?? { scored: 0, sumq: 0 };
    d.scored += r.scored; d.sumq += r.sumq; byDay.set(r.d, d);
  }
  const callsBy = new Map<string, number>();
  for (const r of (cd ?? []).filter((x) => inWin(x.d, w))) callsBy.set(r.d, (callsBy.get(r.d) ?? 0) + r.calls);
  const days = [...new Set([...byDay.keys(), ...callsBy.keys()])].sort();
  const series: InsightSeries[] = [];
  if (days.length > 1) {
    series.push({ key: "q_trend", title: "Score trend vs target", subtitle: "daily average of scored calls", kind: "line", unit: "percent", keys: [{ key: "avg", label: "Avg score", tone: "violet" }, { key: "target", label: `Target ${QUALITY_TARGET_PCT}%`, tone: "green" }], points: days.map((d) => { const x = byDay.get(d); return { label: d.slice(5), avg: x && x.scored ? Math.round((x.sumq / x.scored) * 10) / 10 : null, target: QUALITY_TARGET_PCT }; }), href: DASH });
    series.push({ key: "q_volume", title: "Calls analysed vs audited", subtitle: cd ? "per day" : "per day - analysed-call volume still loading", kind: "bar", unit: "count", keys: [{ key: "calls", label: "Analysed", tone: "slate" }, { key: "scored", label: "Audited", tone: "violet" }], points: days.map((d) => ({ label: d.slice(5), calls: callsBy.get(d) ?? 0, scored: byDay.get(d)?.scored ?? 0 })), href: DASH });
  }
  return { series };
}

// ── Fail rate by parameter ───────────────────────────────────────────────────────────────────
async function defects(ctx: InsightContext): Promise<InsightSection> {
  const b = blocked(ctx);
  if (b) return b;
  const { params } = await scoped(ctx);
  const w = windows(ctx.today).cur;
  if (!params) return { series: [{ key: "q_defects", title: "Fail rate by parameter", kind: "ranked", points: [], unavailable: PARAM_PENDING }] };
  const agg: Record<string, number> = {};
  for (const r of params.filter((x) => inWin(x.d, w))) QA_PARAMETERS.forEach((_, i) => { agg[`f${i}`] = (agg[`f${i}`] ?? 0) + r.f[i]; agg[`n${i}`] = (agg[`n${i}`] ?? 0) + r.n[i]; });
  const rates = defectRates(agg);
  const worst = rates[0];
  return {
    series: [{ key: "q_defects", title: "Fail rate by parameter", subtitle: "failed / evaluated calls (not-evaluated is not a fail)", kind: "ranked", unit: "percent", points: rates.slice(0, 10).map((d) => ({ label: `${d.label} (${d.evaluated.toLocaleString("en-IN")} evaluated)`, value: d.failRate, href: DASH })), href: DASH, unavailable: rates.length ? null : "No parameter has enough evaluated calls in this window" }],
    signals: worst ? [{ tone: worst.failRate >= 40 ? "bad" : "watch", title: `Biggest defect: ${worst.label}`, detail: `${worst.failRate}% of ${worst.evaluated.toLocaleString("en-IN")} evaluated calls failed it.`, value: `${worst.failRate}%`, href: DASH }] : [],
  };
}

// ── Agents below threshold ───────────────────────────────────────────────────────────────────
async function agents(ctx: InsightContext): Promise<InsightSection> {
  const b = blocked(ctx);
  if (b) return b;
  const { view, qa } = await scoped(ctx);
  const w = windows(ctx.today).cur;
  const per = new Map<string, { n: number; sumq: number; fails: number }>();
  for (const r of qa.filter((x) => inWin(x.d, w))) {
    const a = per.get(r.u) ?? { n: 0, sumq: 0, fails: 0 };
    a.n += r.scored; a.sumq += r.sumq; a.fails += r.failed; per.set(r.u, a);
  }
  const low = [...per.entries()].filter(([u, a]) => a.n >= MIN_AUDITS_FOR_AGENT && a.sumq / a.n < AGENT_THRESHOLD_PCT && !(view.byCode.get(u)?.name ?? "").startsWith("Codex E2E"))
    .map(([u, a]) => ({ u, avg: Math.round((a.sumq / a.n) * 10) / 10, n: a.n, fails: a.fails, e: view.byCode.get(u) ?? { name: u, process: null as string | null } }))
    .sort((x, y) => x.avg - y.avg);
  const names = await resolveNames("process", [...new Set(low.slice(0, 10).map((l) => l.e.process).filter((x): x is string => !!x))]);
  return {
    kpis: [{ key: "q_agents_below", label: "Agents below threshold", value: low.length, unit: "count", higherIsBetter: false, tone: toneFor(low.length, 0, 10, false), helper: `avg < ${AGENT_THRESHOLD_PCT}% over >= ${MIN_AUDITS_FOR_AGENT} audits`, formula: `Agents whose average scored call in the window is below ${AGENT_THRESHOLD_PCT}% with at least ${MIN_AUDITS_FOR_AGENT} audits.`, href: DASH }],
    tables: [{ key: "q_agents", title: "Agents below threshold - coaching list", href: DASH,
      columns: [{ key: "name", label: "Agent" }, { key: "proc", label: "Process" }, { key: "avg", label: "Avg", align: "right", unit: "percent" }, { key: "n", label: "Audits", align: "right", unit: "count" }, { key: "fails", label: "Fails", align: "right", unit: "count" }],
      rows: low.slice(0, 10).map((l) => ({ name: l.e.name, proc: l.e.process ? names.get(l.e.process)?.name ?? "-" : "-", avg: l.avg, n: l.n, fails: l.fails, href: DASH })),
      unavailable: low.length ? null : `No agent averages below ${AGENT_THRESHOLD_PCT}% with enough audits` }],
  };
}

// ── Process league table ──────────────────────────────────────────────────────────────────────
async function league(ctx: InsightContext): Promise<InsightSection> {
  const b = blocked(ctx);
  if (b) return b;
  const { view, qa, cd } = await scoped(ctx);
  const w = windows(ctx.today).cur;
  const by = new Map<string, { scored: number; sumq: number; failed: number; calls: number; fatal: number; agents: Set<string> }>();
  const slot = (pid: string) => { const x = by.get(pid) ?? { scored: 0, sumq: 0, failed: 0, calls: 0, fatal: 0, agents: new Set<string>() }; by.set(pid, x); return x; };
  for (const r of qa.filter((x) => inWin(x.d, w))) { const x = slot(view.byCode.get(r.u)?.process ?? "__none__"); x.scored += r.scored; x.sumq += r.sumq; x.failed += r.failed; if (r.scored) x.agents.add(r.u); }
  for (const r of (cd ?? []).filter((x) => inWin(x.d, w))) { const x = slot(view.byCode.get(r.u)?.process ?? "__none__"); x.calls += r.calls; x.fatal += r.fatal; }
  const names = await resolveNames("process", [...by.keys()]);
  const board = [...by.entries()].filter(([, x]) => x.scored >= 20).map(([pid, x]) => ({
    name: pid === "__none__" ? "Unattributed (agent recorded by name)" : names.get(pid)?.name ?? "No process", avg: Math.round((x.sumq / x.scored) * 10) / 10, scored: x.scored, agents: x.agents.size,
    failRate: failRatePct(x.failed, x.scored), coverage: cd ? coveragePct(x.scored, x.calls) : null, fatalRate: cd ? x.fatal : null,
  })).sort((a, z) => z.avg - a.avg);
  const tables: InsightTable[] = [{ key: "q_league", title: "Process league table", href: DASH,
    columns: [{ key: "rank", label: "#", align: "right", unit: "count" }, { key: "name", label: "Process" }, { key: "avg", label: "Score", align: "right", unit: "percent" }, { key: "fail", label: "Fail", align: "right", unit: "percent" }, { key: "fatal", label: "Fatal calls", align: "right", unit: "count" }, { key: "cov", label: "Coverage", align: "right", unit: "percent" }, { key: "agents", label: "Agents", align: "right", unit: "count" }],
    rows: board.slice(0, 14).map((r, i) => ({ rank: i + 1, name: r.name, avg: r.avg, fail: r.failRate, fatal: r.fatalRate, cov: r.coverage, agents: r.agents, href: DASH })),
    unavailable: board.length ? null : "No process has 20 or more scored calls in this window" }];
  const bottom = [...board].reverse().find((r) => !r.name.startsWith("Unattributed"));
  return { tables, signals: bottom && bottom.avg < QUALITY_TARGET_PCT - 10 ? [{ tone: "bad", title: `${bottom.name} is the weakest process at ${bottom.avg}%`, detail: `${bottom.scored} scored calls, ${bottom.failRate ?? "-"}% fail rate.`, value: `${bottom.avg}%`, href: DASH }] : [] };
}

// ── Fatal-error list ─────────────────────────────────────────────────────────────────────────
async function fatal(ctx: InsightContext): Promise<InsightSection> {
  const b = blocked(ctx);
  if (b) return b;
  const { view, orgWide } = await scoped(ctx);
  const from = addDaysIso(ctx.today, -13);
  // Fatal-flagged calls are rare (hundreds a month) but the table's rows are wide, so read them once, shared, and do not
  // let a cold read fail the section: it keeps running in the background and is cached for the next load.
  const fatalP = memo(`q-fatal|${from}|${ctx.today}`, () => rows<RowDataPacket>(
    `SELECT DATE_FORMAT(cd.CallDate, '%d %b %H:%i') d, cd.AgentName u FROM db_external.CallDetails cd
      WHERE cd.Fatal = '1' AND cd.CallDate >= ? AND cd.CallDate < ? ORDER BY cd.CallDate DESC LIMIT 400`, [from, addDaysIso(ctx.today, 1)]));
  fatalP.catch(() => undefined);
  const list = await Promise.race([fatalP, new Promise<null>((r) => setTimeout(() => r(null), 7_000))]);
  if (list === null) return { tables: [{ key: "q_fatal", title: "Fatal-error calls - last 14 days", href: DASH, columns: [], rows: [], unavailable: CD_PENDING }] };
  const mine = list.filter((r) => orgWide || view.byCode.has(String(r.u))).slice(0, 12);
  const names = await resolveNames("process", [...new Set(mine.map((r) => view.byCode.get(String(r.u))?.process).filter((x): x is string => !!x))]);
  return { tables: [{ key: "q_fatal", title: "Fatal-error calls - last 14 days", href: DASH,
    columns: [{ key: "when", label: "Call time" }, { key: "name", label: "Agent" }, { key: "proc", label: "Process" }],
    rows: mine.map((r) => { const e = view.byCode.get(String(r.u)); return { when: String(r.d), name: e?.name ?? String(r.u), proc: e?.process ? names.get(e.process)?.name ?? "-" : "-", href: DASH }; }),
    unavailable: mine.length ? null : "No fatal-flagged calls in the last 14 days" }] };
}

// ── Pending queues ───────────────────────────────────────────────────────────────────────────
async function queues(ctx: InsightContext): Promise<InsightSection> {
  const b = blocked(ctx);
  if (b) return b;
  const t = ctx.today;
  const { view, cd } = await scoped(ctx);
  const ids = [...view.byId.keys()];
  const idList = ids.length > 0 && ids.length <= 2000 ? ids : null;
  const inIds = idList ? ` AND x.employee_id IN (${idList.map(() => "?").join(",")})` : "";
  const [{ cur }, tni, coach] = await Promise.all([
    stats(ctx),
    guarded("quality.tni", () => rows<RowDataPacket>(
      `SELECT x.employee_id e, DATEDIFF(?, DATE(x.raised_at)) age, (x.target_completion_date < ?) late FROM tni_finding x WHERE x.status = 'OPEN'${inIds}`, [t, t, ...(idList ?? [])])),
    guarded("quality.coaching", () => rows<RowDataPacket>(
      `SELECT x.employee_id e, DATEDIFF(?, x.session_date) age FROM coaching_session x WHERE x.session_type = 'quality' AND x.status = 'scheduled' AND x.session_date < ?${inIds}`, [t, t, ...(idList ?? [])])),
  ]);
  const mineT = tni.value?.filter((r) => view.byId.has(String(r.e))) ?? null;
  const mineC = coach.value?.filter((r) => view.byId.has(String(r.e))) ?? null;
  const fatalWeek = (cd ?? []).filter((r) => r.d >= addDaysIso(t, -6)).reduce((s, r) => s + r.fatal, 0);
  const pending = pendingAudits(cur.total, cur.scored);
  const mkSev = (a: InsightAction, high: number, crit: number): InsightAction => ({ ...a, severity: severityFor(a.count, high, crit) });
  const maxAge = (r: RowDataPacket[] | null) => (r && r.length ? Math.max(...r.map((x) => num(x.age) ?? 0)) : null);
  const actions: InsightAction[] = [
    mkSev(toAction({ id: "audit_pending", label: "Calls awaiting a quality score", href: DASH, group: "Audit", count: pending, hint: "analysed calls without a score, last 30 days", unavailable: pending === null ? CD_PENDING : null }), 500, 3000),
    toAction({ id: "tni_open", label: "Training-need findings to action", href: "/wfm/tni-analysis", group: "Coaching", count: mineT ? mineT.length : null, oldestDays: maxAge(mineT), overdue: mineT ? mineT.filter((r) => Number(r.late) === 1).length : null, hint: "QA-derived coaching needs still OPEN", unavailable: tni.error ? `Could not load: ${tni.error}` : null }),
    toAction({ id: "coach_overdue", label: "Quality coaching sessions overdue", href: "/team/coaching", group: "Coaching", count: mineC ? mineC.length : null, oldestDays: maxAge(mineC), overdue: mineC ? mineC.length : null, hint: "scheduled date passed, not completed", unavailable: coach.error ? `Could not load: ${coach.error}` : null }),
    mkSev(toAction({ id: "fatal_week", label: "Fatal-error calls to review (7 days)", href: DASH, group: "Audit", count: cd && cd.length ? fatalWeek : null, hint: "Fatal flag set in call analysis", unavailable: cd === null ? CD_PENDING : cd.length ? null : "No call analysis data for this scope" }), 5, 25),
    toAction({ id: "disputes", label: "Disputes / appeals pending", href: DASH, group: "Governance", count: null, unavailable: "No dispute or appeal workflow is recorded in the system yet." }),
    toAction({ id: "calibration", label: "Calibration sessions pending", href: DASH, group: "Governance", count: null, unavailable: "Only UAT test calibration records exist - no live calibration data." }),
  ];
  return { actions };
}

// ── Auditor productivity (honest gap) ───────────────────────────────────────────────────────────
async function auditors(ctx: InsightContext): Promise<InsightSection> {
  const b = blocked(ctx);
  if (b) return b;
  return { tables: [{ key: "q_auditors", title: "Auditor productivity", columns: [], rows: [], href: DASH, unavailable: "Calls are scored by the AI assessment engine and carry no human auditor, and the native QA audit tables hold no records - audits per auditor cannot be measured yet." }] };
}

const provider: InsightProvider = { sections: { overview, trend, defects, agents, league, fatal, queues, auditors } };
export default provider;
