/** Sales dashboard read side: loads the verified orders source, runs the pure metrics, shapes the API payloads. Read-only. */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { datasetCache, smallCache } from "../pd.cache.js";
import { loadDataset, loadConfigOrThrow, resolveRange } from "../pd.dataset.js";
import { getConfig, isConfigured } from "../pd.config.service.js";
import { PdError, assertSourceName, listColumns, quoteIdent, withReadOnly } from "../pd.source.js";
import { addDays, deltaPct, isRealDay, monthStart, previousWindow } from "../shared/ext.math.js";
import { MAX_EXT_ROWS, buildExtSelect, norm, readExtFingerprint, readExtFreshness, readRaw, verifyExtMap, verifySource, type ExtSource, type Freshness } from "../shared/ext.source.js";
import { ROSTER_FIELDS, SALES_FIELDS, getSalesConfig, type SalesConfig } from "./sales.config.js";
import {
  achievedOf, agentRows, computeKpis, dailyTrend, funnel, groupBy, kpiDeltas, normalizeOrders, rankAgents, teamPacing,
  type AgentRow, type Caps, type NormResult, type RosterEntry, type SalesKpis, type SalesRow,
} from "./sales.metrics.js";

export interface SalesCtx { cfg: SalesConfig; src: ExtSource; map: Record<string, string>; filterColumn: string | null; columns: Awaited<ReturnType<typeof verifySource>>["columns"]; caps: Caps; stamp: string }

export const capsOf = (map: Record<string, string>): Caps => ({ amount: !!map.amount, status: !!map.status, payment: !!map.payment_mode, product: !!map.product, lob: !!map.lob, tl: !!map.tl_name, orderId: !!map.order_id });

export async function loadSalesCtx(processId: string, opts: { requireEnabled?: boolean } = {}): Promise<SalesCtx> {
  const cfg = await getSalesConfig(processId);
  if (!cfg) throw new PdError(404, "NO_SALES_CONFIG", "No sales source is configured for this process");
  if (opts.requireEnabled !== false && !cfg.enabled) throw new PdError(409, "DISABLED", "The Sales dashboard is switched off for this process");
  const src: ExtSource = { schema: cfg.ordersSchema, table: cfg.ordersTable, filter: cfg.filter };
  const v = await verifySource(src, cfg.columnMap, SALES_FIELDS);
  if (v.problems.length) throw new PdError(409, "CONFIG_STALE", `Mapping no longer valid: ${v.problems.map((p) => p.message).join("; ")}`);
  return { cfg, src, map: v.map, filterColumn: v.filterColumn, columns: v.columns, caps: capsOf(v.map), stamp: cfg.updatedAt ?? "" };
}

export async function getFreshness(ctx: SalesCtx): Promise<Freshness> {
  return smallCache.wrap(`${ctx.cfg.processId}|sales-fresh|${ctx.stamp}`, () => readExtFreshness(ctx.src, ctx.map, ctx.filterColumn));
}

/** Roster (agent, TL, monthly target). Empty when none is configured or it cannot be read; never throws into the dashboard. */
export async function loadRoster(ctx: SalesCtx): Promise<RosterEntry[]> {
  const r = ctx.cfg.roster;
  if (!r) return [];
  return smallCache.wrap(`${ctx.cfg.processId}|sales-roster|${ctx.stamp}`, async () => {
    try {
      const t = assertSourceName(r.schema, r.table);
      const v = verifyExtMap(r.columnMap, await listColumns(t.schema, t.table), ROSTER_FIELDS, null);
      if (v.problems.length || !v.map.agent_code || !v.map.target) return [];
      const sel = [`${quoteIdent(v.map.agent_code)} AS agent`, `${quoteIdent(v.map.target)} AS target`, v.map.tl ? `${quoteIdent(v.map.tl)} AS tl` : `NULL AS tl`];
      const rows = await withReadOnly(async (conn) => (await conn.query<RowDataPacket[]>(`SELECT /*+ MAX_EXECUTION_TIME(20000) */ ${sel.join(", ")} FROM ${quoteIdent(t.schema)}.${quoteIdent(t.table)} LIMIT 20000`))[0]);
      const by = new Map<string, RosterEntry>();
      for (const x of rows) {
        const agent = String(x.agent ?? "").trim().toUpperCase(); if (!agent) continue;
        const t0 = x.target === null || x.target === undefined ? null : Number(String(x.target).replace(/,/g, ""));
        const prev = by.get(agent);
        by.set(agent, { agent, tl: x.tl ? String(x.tl).trim() || null : prev?.tl ?? null, target: t0 !== null && Number.isFinite(t0) ? (prev?.target ?? 0) + t0 : prev?.target ?? null });
      }
      return [...by.values()];
    } catch { return []; }
  });
}

export interface OrdersWindow extends NormResult { truncated: boolean }
export async function loadOrders(ctx: SalesCtx, from: string, to: string): Promise<OrdersWindow> {
  return datasetCache.wrap(`${ctx.cfg.processId}|sales|${ctx.stamp}|${from}|${to}`, async () => {
    const { sql, params } = buildExtSelect(ctx.src, ctx.map, ctx.filterColumn, ctx.columns, { from, to, limit: MAX_EXT_ROWS + 1 });
    const raw = await readRaw(sql, params);
    const truncated = raw.length > MAX_EXT_ROWS;
    return { ...normalizeOrders(raw.slice(0, MAX_EXT_ROWS) as Array<Record<string, unknown>>, ctx.cfg.statusMap, ctx.cfg.prepaidValues, ctx.caps), truncated };
  });
}

/** Calls per agent from the process's APR (sum of the mapped `calls` column) for conversion. null = the process has no APR calls. */
export async function loadCalls(processId: string, from: string, to: string): Promise<Map<string, number> | null> {
  try {
    const apr = await getConfig(processId);
    if (!apr || !isConfigured(apr) || !apr.columnMap.calls) return null;
    const l = await loadConfigOrThrow(processId, { requireEnabled: false });
    const ds = await loadDataset(l, from, to);
    const m = new Map<string, number>();
    for (const r of ds.rows) if (r.date >= from && r.date <= to && r.calls !== null) m.set(r.agent_code, (m.get(r.agent_code) ?? 0) + r.calls);
    return m.size ? m : null;
  } catch { return null; }
}

export interface SalesQuery { from?: unknown; to?: unknown; tl?: unknown; lob?: unknown; product?: unknown }
export interface Scope { from: string; to: string; prev: { from: string; to: string }; mtdFrom: string; tl: string; lob: string; product: string }
const s1 = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 120) : "");

export async function resolveScope(ctx: SalesCtx, q: SalesQuery): Promise<Scope> {
  const fresh = await getFreshness(ctx);
  const { from, to } = resolveRange({ from: q.from, to: q.to }, { ...fresh, lastDataAt: null });
  return { from, to, prev: previousWindow(from, to), mtdFrom: monthStart(to), tl: s1(q.tl), lob: s1(q.lob), product: s1(q.product) };
}

/** Fill a missing TL from the roster, then apply the tl / lob / product filters. */
export function scopeRows(rows: SalesRow[], roster: RosterEntry[], sc: Pick<Scope, "tl" | "lob" | "product">): SalesRow[] {
  const tlBy = new Map(roster.map((r) => [r.agent, r.tl]));
  const filled = rows.map((r) => (r.tl ? r : { ...r, tl: tlBy.get(r.agent) ?? null }));
  const tl = norm(sc.tl), lob = norm(sc.lob), product = norm(sc.product);
  if (!tl && !lob && !product) return filled;
  return filled.filter((r) => (!tl || norm(r.tl ?? "unassigned") === tl) && (!lob || norm(r.lob ?? "unassigned") === lob) && (!product || norm(r.product ?? "unassigned") === product));
}
const between = (rows: SalesRow[], from: string, to: string) => rows.filter((r) => r.date >= from && r.date <= to);
const sumCalls = (m: Map<string, number> | null, agents: Set<string> | null): number | null => {
  if (!m) return null; let n = 0;
  for (const [a, c] of m) if (!agents || agents.has(a)) n += c;
  return n;
};

interface Loaded { ctx: SalesCtx; sc: Scope; roster: RosterEntry[]; all: SalesRow[]; win: OrdersWindow; calls: Map<string, number> | null }
async function loadAll(processId: string, q: SalesQuery): Promise<Loaded> {
  const ctx = await loadSalesCtx(processId);
  const sc = await resolveScope(ctx, q);
  const lo = [sc.prev.from, sc.mtdFrom].sort()[0];
  const [win, roster, calls] = await Promise.all([loadOrders(ctx, lo, sc.to), loadRoster(ctx), loadCalls(processId, sc.from, sc.to)]);
  return { ctx, sc, roster, all: scopeRows(win.rows, roster, sc), win, calls };
}
const agentSetOf = (l: Loaded, rows: SalesRow[]): Set<string> | null => (l.sc.tl || l.sc.lob || l.sc.product ? new Set([...rows.map((r) => r.agent), ...l.roster.filter((r) => !l.sc.tl || norm(r.tl ?? "unassigned") === norm(l.sc.tl)).map((r) => r.agent)]) : null);

export interface Tile { key: string; label: string; unit: "count" | "currency" | "percent"; direction: "higher" | "lower"; value: number | null; prev: number | null; deltaPct: number | null; available: boolean }
const tile = (key: string, label: string, unit: Tile["unit"], direction: Tile["direction"], cur: SalesKpis, prev: SalesKpis, f: keyof SalesKpis): Tile =>
  ({ key, label, unit, direction, value: cur[f], prev: prev[f], deltaPct: deltaPct(cur[f], prev[f]), available: cur[f] !== null });

export async function getSalesOverview(processId: string, q: SalesQuery) {
  const l = await loadAll(processId, q);
  const { sc, ctx } = l;
  const cur = between(l.all, sc.from, sc.to), prev = between(l.all, sc.prev.from, sc.prev.to), mtd = between(l.all, sc.mtdFrom, sc.to);
  const curCalls = l.calls ? sumCalls(l.calls, agentSetOf(l, cur)) : null;
  const k = computeKpis(cur, ctx.caps, curCalls);
  const pk = computeKpis(prev, ctx.caps, null); // prior-window conversion needs its own APR window; left null rather than guessed
  const pacing = teamPacing(mtd, l.roster.filter((r) => !sc.tl || norm(r.tl ?? "unassigned") === norm(sc.tl)), ctx.caps, ctx.cfg.targetMetric, sc.to);
  const ag = agentRows(cur, mtd, l.roster, ctx.caps, ctx.cfg.targetMetric, sc.to, l.calls ?? undefined)
    .filter((a) => (!sc.tl || norm(a.tl ?? "unassigned") === norm(sc.tl)) && (!sc.lob && !sc.product ? true : a.orders > 0));
  const uniq = (f: (r: SalesRow) => string | null) => [...new Set(win(l).map(f).filter((x): x is string => !!x))].sort();
  const tiles: Tile[] = [
    tile("orders", "Orders", "count", "higher", k, pk, "orders"),
    tile("grossRevenue", "Gross revenue", "currency", "higher", k, pk, "grossRevenue"),
    tile("netRevenue", "Net revenue", "currency", "higher", k, pk, "netRevenue"),
    tile("aov", "Average order value", "currency", "higher", k, pk, "aov"),
    { ...tile("conversionPct", "Conversion (orders / calls)", "percent", "higher", k, pk, "conversionPct"), prev: null, deltaPct: null },
    tile("prepaidPct", "Prepaid %", "percent", "higher", k, pk, "prepaidPct"),
    tile("rtoPct", "RTO %", "percent", "lower", k, pk, "rtoPct"),
    tile("cancellationPct", "Cancellation %", "percent", "lower", k, pk, "cancellationPct"),
    tile("deliveredPct", "Delivered %", "percent", "higher", k, pk, "deliveredPct"),
  ];
  if (pacing) tiles.push({ key: "attainmentPct", label: "Target attainment (month to date)", unit: "percent", direction: "higher", value: pacing.attainmentPct, prev: null, deltaPct: null, available: pacing.attainmentPct !== null });
  return {
    range: { from: sc.from, to: sc.to }, previous: sc.prev, freshness: await getFreshness(ctx), truncated: l.win.truncated,
    capabilities: { ...ctx.caps, roster: !!ctx.cfg.roster, calls: !!l.calls }, targetMetric: ctx.cfg.targetMetric,
    kpis: k, deltas: kpiDeltas(k, pk), tiles, pacing,
    trend: dailyTrend(cur, ctx.caps), funnel: funnel(cur, ctx.caps),
    byTl: groupBy(cur, ctx.caps, (r) => r.tl), byProduct: ctx.caps.product ? groupBy(cur, ctx.caps, (r) => r.product) : [], byLob: ctx.caps.lob ? groupBy(cur, ctx.caps, (r) => r.lob) : [],
    topBottom: rankAgents(ag, 5),
    quality: { duplicateOrders: l.win.duplicateOrders, badAmounts: l.win.badAmounts, unmappedStatuses: l.win.unmappedStatuses },
    filters: { tls: uniq((r) => r.tl), lobs: uniq((r) => r.lob), products: uniq((r) => r.product) },
  };
}
const win = (l: Loaded): SalesRow[] => scopeRows(between(l.win.rows, l.sc.from, l.sc.to), l.roster, { tl: "", lob: "", product: "" });

const SORTS = new Set(["agent", "tl", "orders", "grossRevenue", "netRevenue", "aov", "rtoPct", "cancellationPct", "prepaidPct", "conversionPct", "attainmentPct", "pacingPct", "target"]);
export async function getSalesAgents(processId: string, q: SalesQuery & { q?: unknown; sort?: unknown; dir?: unknown; limit?: unknown; offset?: unknown }) {
  const l = await loadAll(processId, q);
  const { sc, ctx } = l;
  const cur = between(l.all, sc.from, sc.to), mtd = between(l.all, sc.mtdFrom, sc.to);
  let rows: AgentRow[] = agentRows(cur, mtd, l.roster, ctx.caps, ctx.cfg.targetMetric, sc.to, l.calls ?? undefined)
    .filter((a) => (!sc.tl || norm(a.tl ?? "unassigned") === norm(sc.tl)) && (!sc.lob && !sc.product ? true : a.orders > 0));
  const needle = norm(q.q);
  if (needle) rows = rows.filter((a) => norm(a.agent).includes(needle) || norm(a.tl).includes(needle));
  const sort = typeof q.sort === "string" && SORTS.has(q.sort) ? (q.sort as keyof AgentRow) : null;
  if (sort) {
    const dir = q.dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const x = a[sort], y = b[sort];
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1; // nulls always last
      if (y === null || y === undefined) return -1;
      return (typeof x === "string" ? x.localeCompare(String(y)) : (x as number) - (y as number)) * dir;
    });
  }
  const limit = Math.min(200, Math.max(1, Math.floor(Number(q.limit)) || 25)); const offset = Math.max(0, Math.floor(Number(q.offset)) || 0);
  return { range: { from: sc.from, to: sc.to }, total: rows.length, rows: rows.slice(offset, offset + limit), capabilities: { ...ctx.caps, roster: !!ctx.cfg.roster, calls: !!l.calls } };
}

export async function getSalesAgent(processId: string, code: string, q: SalesQuery) {
  const l = await loadAll(processId, { ...q, tl: "", lob: "", product: "" });
  const { sc, ctx } = l; const agent = code.trim().toUpperCase();
  const mine = l.all.filter((r) => r.agent === agent);
  const onRoster = l.roster.some((r) => r.agent === agent);
  if (!mine.length && !onRoster) throw new PdError(404, "AGENT_NOT_FOUND", "No orders or roster entry for that agent");
  const cur = between(mine, sc.from, sc.to), prev = between(mine, sc.prev.from, sc.prev.to), mtd = between(mine, sc.mtdFrom, sc.to);
  const calls = l.calls ? l.calls.get(agent) ?? null : null;
  const k = computeKpis(cur, ctx.caps, calls), pk = computeKpis(prev, ctx.caps, null);
  const row = agentRows(cur, mtd, l.roster.filter((r) => r.agent === agent), ctx.caps, ctx.cfg.targetMetric, sc.to, l.calls ?? undefined)[0] ?? null;
  return {
    agent, tl: row?.tl ?? null, range: { from: sc.from, to: sc.to }, kpis: k, deltas: kpiDeltas(k, pk), target: row?.target ?? null, achieved: row?.achieved ?? null,
    attainmentPct: row?.attainmentPct ?? null, pacingPct: row?.pacingPct ?? null, projectedAttainmentPct: row?.projectedAttainmentPct ?? null, targetMetric: ctx.cfg.targetMetric,
    trend: dailyTrend(cur, ctx.caps), funnel: funnel(cur, ctx.caps), byProduct: ctx.caps.product ? groupBy(cur, ctx.caps, (r) => r.product) : [],
    recentOrders: [...cur].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25).map((r) => ({ orderId: r.orderId, date: r.date, amount: r.amount, status: r.rawStatus, product: r.product, prepaid: r.prepaid })),
  };
}

export async function getSalesDay(processId: string, date: string, q: SalesQuery) {
  if (!isRealDay(date)) throw new PdError(400, "BAD_DATE", "date must be YYYY-MM-DD");
  const ctx = await loadSalesCtx(processId);
  const [win2, roster] = await Promise.all([loadOrders(ctx, addDays(date, -1), date), loadRoster(ctx)]);
  const sc = { tl: s1(q.tl), lob: s1(q.lob), product: s1(q.product) };
  const all = scopeRows(win2.rows, roster, sc);
  const day = all.filter((r) => r.date === date), before = all.filter((r) => r.date === addDays(date, -1));
  const k = computeKpis(day, ctx.caps), pk = computeKpis(before, ctx.caps);
  return {
    date, kpis: k, deltas: kpiDeltas(k, pk), funnel: funnel(day, ctx.caps), byProduct: ctx.caps.product ? groupBy(day, ctx.caps, (r) => r.product) : [],
    byAgent: groupBy(day, ctx.caps, (r) => r.agent).slice(0, 100), byTl: groupBy(day, ctx.caps, (r) => r.tl), achieved: achievedOf(k, ctx.cfg.targetMetric),
  };
}

export async function getSalesLive(processId: string): Promise<{ etag: string; latestDate: string | null }> {
  const ctx = await loadSalesCtx(processId);
  const etag = await smallCache.wrap(`${processId}|sales-fp|${ctx.stamp}`, () => readExtFingerprint(ctx.src, ctx.map, ctx.filterColumn));
  return { etag, latestDate: etag.split("|")[1] || null };
}

/** What the generic page needs: does this process have an enabled Sales tab? Viewer-safe: no table names. */
export async function getSalesTab(processId: string): Promise<{ name: string; refreshSeconds: number } | null> {
  const cfg = await getSalesConfig(processId);
  if (!cfg?.enabled) return null;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT process_name FROM process_master WHERE id = ? LIMIT 1`, [processId]);
  return rows.length ? { name: String(rows[0].process_name), refreshSeconds: cfg.refreshSeconds } : null;
}
