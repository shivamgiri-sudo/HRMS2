/** Process Dashboard -- viewer-facing views (overview, agents, agent drill, day drill). All numbers come from pd.metrics.ts. */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { detectAnomalies } from "./pd.anomalies.js";
import { METRICS, METRIC_BY_KEY, profileFor, type CategoryProfile } from "./pd.fields.js";
import {
  addQa, addRow, availableMetrics, computeMetrics, emptyAcc, kpiStatus, metricAvailable, pctDelta, rankBy, totalAcc,
  type Acc, type Metrics, type NormRow, type QaBucket,
} from "./pd.metrics.js";
import { loadTargets } from "./pd.config.service.js";
import { smallCache } from "./pd.cache.js";
import { PdError, fetchRows } from "./pd.source.js";
import { applyFilters, getFreshness, inRange, isIso, loadDataset, loadQa, previousRange, resolveRange, type Filters, type Loaded } from "./pd.dataset.js";

export interface RangeQuery { from?: unknown; to?: unknown; tl?: unknown; lob?: unknown }
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : undefined);
export const filtersOf = (q: RangeQuery): Filters => ({ tl: str(q.tl), lob: str(q.lob) });
/** The category's rank metric, or -- when its source field is not mapped (an inbound table with only "handled") -- the first available count metric of the profile. */
export function effectiveRankMetric(p: CategoryProfile, mapped: ReadonlySet<string>): string {
  if (metricAvailable(p.rankMetric, mapped)) return p.rankMetric;
  const alt = [...p.columns, ...p.kpis].find((k) => METRIC_BY_KEY.get(k)?.unit === "count" && metricAvailable(k, mapped));
  return alt ?? p.rankMetric;
}
const profileOf = (l: Loaded): CategoryProfile => { const p = profileFor(l.cfg.category); if (!p) throw new PdError(409, "NOT_CONFIGURED", "No category profile"); return { ...p, rankMetric: effectiveRankMetric(p, l.resolved.mapped) }; };

interface Meta { name: string | null; tl: string | null; lob: string | null }
function groupAgents(rows: NormRow[], qa: QaBucket[]): Map<string, { acc: Acc; meta: Meta }> {
  const m = new Map<string, { acc: Acc; meta: Meta }>();
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    let e = m.get(r.agent_code); if (!e) { e = { acc: emptyAcc(), meta: { name: null, tl: null, lob: null } }; m.set(r.agent_code, e); }
    addRow(e.acc, r);
    if (r.agent_name) e.meta.name = r.agent_name; if (r.tl_name) e.meta.tl = r.tl_name; if (r.lob) e.meta.lob = r.lob;
  }
  for (const q of qa) { const e = m.get(q.agentCode); if (e) addQa(e.acc, q); }
  return m;
}
function groupBy(rows: NormRow[], qa: QaBucket[], keyOf: (r: NormRow) => string): Map<string, Acc> {
  const m = new Map<string, Acc>(); const agentKey = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = keyOf(r); let a = m.get(k); if (!a) { a = emptyAcc(); m.set(k, a); }
    addRow(a, r);
    let s = agentKey.get(r.agent_code); if (!s) { s = new Set(); agentKey.set(r.agent_code, s); } s.add(k);
  }
  // A QA bucket belongs to its agent's group (an agent in two groups counts in the first seen one, so audits are never double counted).
  for (const q of qa) { const ks = agentKey.get(q.agentCode); if (!ks) continue; const a = m.get([...ks][0]); if (a) addQa(a, q); }
  return m;
}
export type MRow = Record<string, any>;
export const byDate = (rows: NormRow[], qa: QaBucket[]): MRow[] => {
  const agents = new Set(rows.map((r) => r.agent_code));
  const m = new Map<string, Acc>();
  for (const r of rows) { let a = m.get(r.date); if (!a) { a = emptyAcc(); m.set(r.date, a); } addRow(a, r); }
  for (const q of qa) if (agents.has(q.agentCode)) { const a = m.get(q.date); if (a) addQa(a, q); }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, acc]) => ({ date, ...computeMetrics(acc) }));
};
const qaOfAgents = (qa: QaBucket[], rows: NormRow[], from: string, to: string): QaBucket[] => {
  const s = new Set(rows.map((r) => r.agent_code)); return qa.filter((q) => q.date >= from && q.date <= to && s.has(q.agentCode));
};

export function categoryProfileOut(l: Loaded, targets: Record<string, number>) {
  const p = profileOf(l);
  const avail = availableMetrics(l.resolved.mapped);
  const col = (key: string) => { const d = METRIC_BY_KEY.get(key)!; return { key, label: d.label, unit: d.unit, direction: d.direction, available: avail[key] ?? false, target: targets[key] ?? null }; };
  return { category: p.category, label: p.label, rankMetric: p.rankMetric, kpis: p.kpis.map(col), columns: p.columns.map(col), mappedFields: [...l.resolved.mapped], timeUnit: l.cfg.timeUnit, hasHourly: l.resolved.mapped.has("hour") };
}

export async function getOverview(l: Loaded, q: RangeQuery) {
  const profile = profileOf(l); const f = filtersOf(q);
  const fresh = await getFreshness(l);
  const { from, to } = resolveRange(q, fresh);
  const prev = previousRange(from, to);
  const cacheKey = `${l.cfg.processId}|ov|${l.cfg.updatedAt}|${from}|${to}|${f.tl ?? ""}|${f.lob ?? ""}`;
  return smallCache.wrap(cacheKey, async () => {
    const [ds, targets] = await Promise.all([loadDataset(l, prev.from, to), loadTargets(l.cfg.processId)]);
    const curAll = inRange(ds.rows, from, to); const prevAll = inRange(ds.rows, prev.from, prev.to);
    const cur = applyFilters(curAll, f); const pre = applyFilters(prevAll, f);
    const curQa = qaOfAgents(ds.qa, cur, from, to); const preQa = qaOfAgents(ds.qa, pre, prev.from, prev.to);
    const totals = computeMetrics(totalAcc(cur, curQa)); const prevTotals = computeMetrics(totalAcc(pre, preQa));
    const trend = byDate(cur, curQa);
    const avail = availableMetrics(l.resolved.mapped);
    const kpis = profile.kpis.map((key) => {
      const d = METRIC_BY_KEY.get(key)!;
      const value = totals[key] ?? null; const p = prevTotals[key] ?? null; const target = targets[key] ?? null;
      const { status, basis } = kpiStatus(value, target, p, d.direction);
      return { key, label: d.label, unit: d.unit, direction: d.direction, available: avail[key] ?? false, value, prev: p, deltaPct: pctDelta(value, p), target, status, statusBasis: basis,
        spark: trend.map((t) => ({ date: t.date, value: (t[key] as number | null) ?? null })) };
    });
    const grouped = (keyOf: (r: NormRow) => string, label: string) => [...groupBy(cur, curQa, keyOf).entries()].map(([k, acc]) => ({ [label]: k, ...computeMetrics(acc) }))
      .sort((a, b) => ((b[profile.rankMetric] as number | null) ?? -Infinity) - ((a[profile.rankMetric] as number | null) ?? -Infinity));
    const byTl = grouped((r) => r.tl_name ?? "Unassigned", "tl");
    const byLob = l.resolved.mapped.has("lob") ? grouped((r) => r.lob ?? "Unassigned", "lob") : [];
    const agents = groupAgents(cur, curQa);
    const dir = METRIC_BY_KEY.get(profile.rankMetric)!.direction;
    const scored = [...agents.entries()].map(([code, e]) => ({ agentCode: code, name: e.meta.name, value: (computeMetrics(e.acc)[profile.rankMetric] ?? null) as number | null })).filter((x) => x.value !== null);
    scored.sort((a, b) => (dir === "higher" ? (b.value as number) - (a.value as number) : (a.value as number) - (b.value as number)));
    const shape = (x: { agentCode: string; name: string | null; value: number | null }) => ({ agentCode: x.agentCode, name: x.name, metric: profile.rankMetric, value: x.value });
    const asOf = cur.length ? cur.reduce((m, r) => (r.date > m ? r.date : m), "") : null;
    const anomalies = asOf ? detectAnomalies(applyFilters(ds.rows, f), ds.qa, asOf) : [];
    const warnings: string[] = [];
    if (ds.truncated) warnings.push("Source rows exceeded the read limit; figures may be partial. Narrow the date range.");
    for (const [k, n] of Object.entries(ds.badValues)) if (n > 0) warnings.push(`${n} non-numeric value(s) in ${k} were ignored`);
    return {
      processId: l.cfg.processId, range: { from, to }, previousRange: prev, filters: f, label: l.cfg.label, refreshSeconds: l.cfg.refreshSeconds,
      freshness: { lastDataAt: fresh.lastDataAt, latestDate: fresh.latestDate, rows: cur.length },
      kpis, trend, byTl, byLob,
      topBottom: { top: scored.slice(0, 5).map(shape), bottom: scored.slice(Math.max(5, scored.length - 5)).reverse().map(shape) },
      anomalies, quality: { avgScore: totals.qa_score ?? null, audits: totals.audits ?? 0, fatal: totals.fatal ?? 0 },
      totals, categoryProfile: categoryProfileOut(l, targets), warnings,
    };
  });
}

export interface AgentListQuery extends RangeQuery { q?: unknown; sort?: unknown; dir?: unknown; limit?: unknown; offset?: unknown }
export async function getAgents(l: Loaded, q: AgentListQuery, maxLimit = 500) {
  const profile = profileOf(l); const f = filtersOf(q);
  const fresh = await getFreshness(l); const { from, to } = resolveRange(q, fresh);
  const ds = await loadDataset(l, from, to);
  const cur = applyFilters(inRange(ds.rows, from, to), f);
  const agents = groupAgents(cur, qaOfAgents(ds.qa, cur, from, to));
  const dir = METRIC_BY_KEY.get(profile.rankMetric)!.direction;
  const base: MRow[] = [...agents.entries()].map(([agentCode, e]) => ({ agentCode, name: e.meta.name, tl: e.meta.tl, lob: e.meta.lob, days: e.acc.days.size, ...computeMetrics(e.acc) }));
  const ranks = rankBy(base.map((b) => ({ key: b.agentCode, value: (b[profile.rankMetric] as number | null) ?? null })), dir);
  let rows: MRow[] = base.map((b) => ({ rank: ranks.get(b.agentCode) ?? null, qaScore: b.qa_score ?? null, ...b }));
  const needle = str(q.q)?.toLowerCase();
  if (needle) rows = rows.filter((r) => r.agentCode.toLowerCase().includes(needle) || (r.name ?? "").toLowerCase().includes(needle));
  const sortKey = str(q.sort) ?? "rank";
  const validSort = sortKey === "rank" || ["agentCode", "name", "tl", "lob", "days"].includes(sortKey) || METRIC_BY_KEY.has(sortKey);
  if (!validSort) throw new PdError(400, "BAD_SORT", `Unknown sort "${sortKey}"`);
  const sign = str(q.dir)?.toLowerCase() === "desc" ? -1 : 1;
  const textKeys = ["agentCode", "name", "tl", "lob"];
  rows.sort((a, b) => {
    const x = (a as Record<string, unknown>)[sortKey]; const y = (b as Record<string, unknown>)[sortKey];
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1; // nulls always last
    if (y === null || y === undefined) return -1;
    const c = textKeys.includes(sortKey) ? String(x).localeCompare(String(y)) : Number(x) - Number(y);
    return c * sign || a.agentCode.localeCompare(b.agentCode);
  });
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(String(q.limit ?? "50"), 10) || 50));
  const offset = Math.max(0, Number.parseInt(String(q.offset ?? "0"), 10) || 0);
  return { range: { from, to }, total: rows.length, limit, offset, sort: sortKey, rankMetric: profile.rankMetric, rows: rows.slice(offset, offset + limit) };
}

export async function getAgentDrill(l: Loaded, agentCodeRaw: string, q: RangeQuery) {
  const profile = profileOf(l);
  const agentCode = agentCodeRaw.trim().toUpperCase();
  if (!agentCode || agentCode.length > 100) throw new PdError(400, "BAD_AGENT", "Invalid agent code");
  const fresh = await getFreshness(l); const { from, to } = resolveRange(q, fresh);
  const [ds, targets] = await Promise.all([loadDataset(l, from, to), loadTargets(l.cfg.processId)]);
  const all = inRange(ds.rows, from, to);
  const mine = all.filter((r) => r.agent_code === agentCode);
  if (!mine.length) throw new PdError(404, "AGENT_NOT_FOUND", "No rows for that agent in the selected range");
  const agents = groupAgents(all, qaOfAgents(ds.qa, all, from, to));
  const me = agents.get(agentCode)!;
  const dir = METRIC_BY_KEY.get(profile.rankMetric)!.direction;
  const ranks = rankBy([...agents.entries()].map(([k, e]) => ({ key: k, value: (computeMetrics(e.acc)[profile.rankMetric] ?? null) as number | null })), dir);
  const totals = computeMetrics(me.acc);
  const teamRows = all.filter((r) => (r.tl_name ?? null) === me.meta.tl);
  const teamM = computeMetrics(totalAcc(teamRows, qaOfAgents(ds.qa, teamRows, from, to)));
  const procM = computeMetrics(totalAcc(all, qaOfAgents(ds.qa, all, from, to)));
  const delta = (ref: Metrics) => Object.fromEntries(METRICS.map((m) => [m.key, pctDelta(totals[m.key] ?? null, ref[m.key] ?? null)]));
  const qaAgent = ds.qa.filter((x) => x.agentCode === agentCode);
  const [qaRows, raw, emp] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT a.id, DATE_FORMAT(a.audit_date, '%Y-%m-%d') AS d, a.quality_percentage AS score, a.fatal_triggered AS fatal, a.status
         FROM qa_audit a JOIN employees e ON e.id = a.employee_id
        WHERE a.process_id = ? AND e.employee_code = ? AND a.audit_date BETWEEN ? AND ? ORDER BY a.audit_date DESC, a.created_at DESC LIMIT 200`,
      [l.cfg.processId, agentCode, from, to]).then(([r]) => r),
    fetchRows(l.resolved, { from, to, agentCode, limit: 200, order: "desc" }),
    db.execute<RowDataPacket[]>(`SELECT id, full_name, employment_status FROM employees WHERE employee_code = ? LIMIT 1`, [agentCode]).then(([r]) => r),
  ]);
  return {
    range: { from, to },
    profile: { agentCode, name: me.meta.name ?? emp[0]?.full_name ?? null, tl: me.meta.tl, lob: me.meta.lob, days: me.acc.days.size,
      employee: emp[0] ? { id: String(emp[0].id), fullName: emp[0].full_name ?? null, status: emp[0].employment_status ?? null } : null },
    totals, daily: byDate(mine, qaAgent.filter((x) => x.date >= from && x.date <= to)),
    qa: qaRows.map((r) => ({ id: String(r.id), auditDate: String(r.d), score: r.score === null ? null : Number(r.score), fatal: Number(r.fatal) === 1, status: String(r.status) })),
    rawRows: raw.rows, rank: { metric: profile.rankMetric, position: ranks.get(agentCode) ?? null, of: ranks.size },
    vsTeam: { team: { tl: me.meta.tl, agents: new Set(teamRows.map((r) => r.agent_code)).size, metrics: teamM }, process: { metrics: procM }, deltaVsTeamPct: delta(teamM), deltaVsProcessPct: delta(procM) },
    categoryProfile: categoryProfileOut(l, targets),
  };
}

export async function getDay(l: Loaded, date: string, q: RangeQuery = {}) {
  if (!isIso(date)) throw new PdError(400, "BAD_DATE", "date must be YYYY-MM-DD");
  const profile = profileOf(l);
  const [ds, targets] = await Promise.all([loadDataset(l, date, date), loadTargets(l.cfg.processId)]);
  const rows = applyFilters(inRange(ds.rows, date, date), filtersOf(q));
  const inScope = new Set(rows.map((r) => r.agent_code));
  const qa = ds.qa.filter((x) => x.date === date && inScope.has(x.agentCode));
  const agents: MRow[] = [...groupAgents(rows, qa).entries()].map(([agentCode, e]) => ({ agentCode, name: e.meta.name, tl: e.meta.tl, lob: e.meta.lob, ...computeMetrics(e.acc) }));
  const dir = METRIC_BY_KEY.get(profile.rankMetric)!.direction;
  const ranks = rankBy(agents.map((a) => ({ key: a.agentCode, value: (a[profile.rankMetric] as number | null) ?? null })), dir);
  const out: MRow[] = agents.map((a): MRow => ({ rank: ranks.get(a.agentCode) ?? null, ...a })).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.agentCode.localeCompare(b.agentCode));
  let hourly: MRow[] | null = null;
  if (l.resolved.mapped.has("hour")) {
    const h = new Map<number, Acc>();
    for (const r of rows) if (r.hour !== null) { let a = h.get(r.hour); if (!a) { a = emptyAcc(); h.set(r.hour, a); } addRow(a, r); }
    hourly = [...h.entries()].sort(([a], [b]) => a - b).map(([hour, acc]) => ({ hour, ...computeMetrics(acc) }));
  }
  return { date, rows: rows.length, totals: computeMetrics(totalAcc(rows, qa)), agents: out, hourly, categoryProfile: categoryProfileOut(l, targets) };
}
