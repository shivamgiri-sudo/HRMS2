/** Outbound dashboard read side: loads the verified CDR source, runs the pure metrics, shapes the API payloads. Read-only. */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { datasetCache, smallCache } from "../pd.cache.js";
import { resolveRange } from "../pd.dataset.js";
import { PdError } from "../pd.source.js";
import { deltaPct, previousWindow } from "../shared/ext.math.js";
import { MAX_EXT_ROWS, buildExtSelect, norm, readExtFingerprint, readExtFreshness, readRaw, verifySource, type ExtSource, type Freshness } from "../shared/ext.source.js";
import { OUTBOUND_FIELDS, effectiveMap, getOutboundConfig, type OutboundConfig } from "./outbound.config.js";
import {
  agentOut, byHour, computeOutKpis, dailyOut, dispositionMix, groupOut, hourlyHeat, normalizeCalls, rankOutAgents,
  type OutCaps, type OutKpis, type OutRow,
} from "./outbound.metrics.js";

export interface OutCtx { cfg: OutboundConfig; src: ExtSource; map: Record<string, string>; filterColumn: string | null; columns: Awaited<ReturnType<typeof verifySource>>["columns"]; caps: OutCaps; stamp: string }

export const outCapsOf = (map: Record<string, string>, columns: OutCtx["columns"]): OutCaps => ({
  duration: !!map.duration_sec, talk: !!map.talk_time, lead: !!map.lead_id, uniqueFlag: !!map.unique_lead_flag, campaign: !!map.campaign, tl: !!map.tl_name,
  hour: !!map.call_time || /^(datetime|timestamp)$/i.test(columns.find((c) => c.name === map.date)?.dataType ?? ""),
});

export async function loadOutCtx(processId: string, opts: { requireEnabled?: boolean } = {}): Promise<OutCtx> {
  const cfg = await getOutboundConfig(processId);
  if (!cfg) throw new PdError(404, "NO_OUTBOUND_CONFIG", "No outbound source is configured for this process");
  if (opts.requireEnabled !== false && !cfg.enabled) throw new PdError(409, "DISABLED", "The Outbound dashboard is switched off for this process");
  const src: ExtSource = { schema: cfg.cdrSchema, table: cfg.cdrTable, filter: cfg.filter };
  const v = await verifySource(src, effectiveMap(cfg), OUTBOUND_FIELDS);
  if (v.problems.length) throw new PdError(409, "CONFIG_STALE", `Mapping no longer valid: ${v.problems.map((p) => p.message).join("; ")}`);
  return { cfg, src, map: v.map, filterColumn: v.filterColumn, columns: v.columns, caps: outCapsOf(v.map, v.columns), stamp: cfg.updatedAt ?? "" };
}

export const getOutFreshness = (ctx: OutCtx): Promise<Freshness> => smallCache.wrap(`${ctx.cfg.processId}|out-fresh|${ctx.stamp}`, () => readExtFreshness(ctx.src, ctx.map, ctx.filterColumn));

export interface CallsWindow { rows: OutRow[]; truncated: boolean; badDurations: number }
export async function loadCalls(ctx: OutCtx, from: string, to: string): Promise<CallsWindow> {
  return datasetCache.wrap(`${ctx.cfg.processId}|out|${ctx.stamp}|${from}|${to}`, async () => {
    const { sql, params } = buildExtSelect(ctx.src, ctx.map, ctx.filterColumn, ctx.columns, { from, to, limit: MAX_EXT_ROWS + 1 });
    const raw = await readRaw(sql, params);
    const n = normalizeCalls(raw.slice(0, MAX_EXT_ROWS) as Array<Record<string, unknown>>, ctx.cfg.connectedDispositions, ctx.caps);
    return { ...n, truncated: raw.length > MAX_EXT_ROWS };
  });
}

export interface OutQuery { from?: unknown; to?: unknown; tl?: unknown; campaign?: unknown }
const s1 = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 120) : "");
async function loadAll(processId: string, q: OutQuery) {
  const ctx = await loadOutCtx(processId);
  const fresh = await getOutFreshness(ctx);
  const { from, to } = resolveRange({ from: q.from, to: q.to }, { ...fresh, lastDataAt: null });
  const prev = previousWindow(from, to);
  const win = await loadCalls(ctx, prev.from, to);
  const tl = norm(s1(q.tl)), campaign = norm(s1(q.campaign));
  const all = win.rows.filter((r) => (!tl || norm(r.tl ?? "unassigned") === tl) && (!campaign || norm(r.campaign ?? "unassigned") === campaign));
  return { ctx, from, to, prev, win, all, fresh };
}
const between = (rows: OutRow[], from: string, to: string) => rows.filter((r) => r.date >= from && r.date <= to);

export interface OutTile { key: string; label: string; unit: "count" | "percent" | "seconds" | "ratio"; direction: "higher" | "lower"; value: number | null; prev: number | null; deltaPct: number | null; available: boolean }
const tile = (key: string, label: string, unit: OutTile["unit"], cur: OutKpis, prev: OutKpis, f: keyof OutKpis, direction: OutTile["direction"] = "higher"): OutTile =>
  ({ key, label, unit, direction, value: cur[f], prev: prev[f], deltaPct: deltaPct(cur[f], prev[f]), available: cur[f] !== null });

export async function getOutboundOverview(processId: string, q: OutQuery) {
  const { ctx, from, to, prev, win, all, fresh } = await loadAll(processId, q);
  const cur = between(all, from, to), before = between(all, prev.from, prev.to);
  const k = computeOutKpis(cur, ctx.caps), pk = computeOutKpis(before, ctx.caps);
  const agents = agentOut(cur, ctx.caps);
  const uniq = (f: (r: OutRow) => string | null) => [...new Set(win.rows.filter((r) => r.date >= from).map(f).filter((x): x is string => !!x))].sort();
  return {
    range: { from, to }, previous: prev, freshness: fresh, truncated: win.truncated, capabilities: ctx.caps, kpis: k,
    tiles: [
      tile("dials", "Dials", "count", k, pk, "dials"), tile("connects", "Connects", "count", k, pk, "connects"), tile("connectRate", "Connect rate", "percent", k, pk, "connectRate"),
      tile("uniqueLeads", "Unique leads", "count", k, pk, "uniqueLeads"), tile("contactPenetrationPct", "Contact penetration", "percent", k, pk, "contactPenetrationPct"),
      tile("attemptsPerLead", "Attempts per lead", "ratio", k, pk, "attemptsPerLead", "lower"), tile("talkSec", "Talk time", "seconds", k, pk, "talkSec"), tile("avgTalkSec", "Avg talk per connect", "seconds", k, pk, "avgTalkSec"),
    ] as OutTile[],
    trend: dailyOut(cur, ctx.caps), dispositions: dispositionMix(cur), hourly: byHour(cur), heat: hourlyHeat(cur),
    byTl: ctx.caps.tl ? groupOut(cur, ctx.caps, (r) => r.tl) : [], byCampaign: ctx.caps.campaign ? groupOut(cur, ctx.caps, (r) => r.campaign) : [],
    topBottom: rankOutAgents(agents, 20, 5),
    quality: { badDurations: win.badDurations },
    filters: { tls: uniq((r) => r.tl), campaigns: uniq((r) => r.campaign) },
  };
}

const SORTS = new Set(["agent", "tl", "dials", "connects", "connectRate", "uniqueLeads", "contactPenetrationPct", "attemptsPerLead", "talkSec", "avgTalkSec"]);
export async function getOutboundAgents(processId: string, q: OutQuery & { q?: unknown; sort?: unknown; dir?: unknown; limit?: unknown; offset?: unknown }) {
  const { ctx, from, to, all } = await loadAll(processId, q);
  let rows = agentOut(between(all, from, to), ctx.caps);
  const needle = norm(q.q);
  if (needle) rows = rows.filter((a) => norm(a.agent).includes(needle) || norm(a.tl).includes(needle));
  const sort = typeof q.sort === "string" && SORTS.has(q.sort) ? (q.sort as keyof (typeof rows)[number]) : null;
  if (sort) {
    const dir = q.dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const x = a[sort], y = b[sort];
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === "string" ? x.localeCompare(String(y)) : (x as number) - (y as number)) * dir;
    });
  }
  const limit = Math.min(200, Math.max(1, Math.floor(Number(q.limit)) || 25)); const offset = Math.max(0, Math.floor(Number(q.offset)) || 0);
  return { range: { from, to }, total: rows.length, rows: rows.slice(offset, offset + limit), capabilities: ctx.caps };
}

export async function getOutboundAgent(processId: string, code: string, q: OutQuery) {
  const { ctx, from, to, prev, all } = await loadAll(processId, { ...q, tl: "", campaign: "" });
  const agent = code.trim().toUpperCase();
  const mine = all.filter((r) => r.agent === agent);
  if (!mine.length) throw new PdError(404, "AGENT_NOT_FOUND", "No calls for that agent in this source");
  const cur = between(mine, from, to), before = between(mine, prev.from, prev.to);
  const k = computeOutKpis(cur, ctx.caps), pk = computeOutKpis(before, ctx.caps);
  const deltas = Object.fromEntries((Object.keys(k) as Array<keyof OutKpis>).map((key) => [key, deltaPct(k[key], pk[key])]));
  return {
    agent, tl: cur.find((r) => r.tl)?.tl ?? null, range: { from, to }, kpis: k, deltas, trend: dailyOut(cur, ctx.caps), dispositions: dispositionMix(cur), hourly: byHour(cur),
    byCampaign: ctx.caps.campaign ? groupOut(cur, ctx.caps, (r) => r.campaign) : [],
  };
}

export async function getOutboundDispositions(processId: string, q: OutQuery & { agent?: unknown }) {
  const { ctx, from, to, all } = await loadAll(processId, q);
  const agent = s1(q.agent).toUpperCase();
  const cur = between(all, from, to).filter((r) => !agent || r.agent === agent);
  const mix = dispositionMix(cur);
  const byCampaign = ctx.caps.campaign ? groupOut(cur, ctx.caps, (r) => r.campaign).map((g) => ({ campaign: g.key, dials: g.dials, connects: g.connects, connectRate: g.connectRate })) : [];
  return { range: { from, to }, agent: agent || null, total: cur.length, dispositions: mix, unmappedConnectedNote: mix.every((m) => !m.connected) && cur.length > 0 ? "No disposition is marked as connected." : null, byCampaign };
}

export async function getOutboundLive(processId: string): Promise<{ etag: string; latestDate: string | null }> {
  const ctx = await loadOutCtx(processId);
  const etag = await smallCache.wrap(`${processId}|out-fp|${ctx.stamp}`, () => readExtFingerprint(ctx.src, ctx.map, ctx.filterColumn));
  return { etag, latestDate: etag.split("|")[1] || null };
}

export async function getOutboundTab(processId: string): Promise<{ name: string; refreshSeconds: number } | null> {
  const cfg = await getOutboundConfig(processId);
  if (!cfg?.enabled) return null;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT process_name FROM process_master WHERE id = ? LIMIT 1`, [processId]);
  return rows.length ? { name: String(rows[0].process_name), refreshSeconds: cfg.refreshSeconds } : null;
}
