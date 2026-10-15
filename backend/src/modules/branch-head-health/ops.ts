import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getInboundProjects } from "../call-master/inbound-projects.js";
import { getKPIs, getQualityTrend, getCXParameters, getFatalAgentSummary } from "../call-master/call-master.service.js";
import type { BranchProcess } from "./processes.js";
import type { SectionResult } from "./types.js";

export const OPS_METRIC_KEYS = ["AHT", "INBOUND_SL_PCT", "INBOUND_AL_PCT", "QA_QUALITY_PCT", "SHRINKAGE_PCT", "FUNNEL_SALE_PCT"] as const;
export const METRIC_WINDOW_DAYS = 45;
export const STALE_AFTER_DAYS = 14;
const QUALITY_LIMIT = 10;
export const FATAL_ROW_LIMIT = 5000;

export interface OpsProcessRow {
  processCode: string;
  processName: string;
  tier: BranchProcess["tier"];
  metrics: Record<string, number | null>;
  latestDate: string | null;
  stale: boolean;
}
export interface QualityRow {
  processCode: string;
  processName: string;
  tier: BranchProcess["tier"];
  QA_QUALITY_PCT: number | null;
  latestDate: string | null;
  stale: boolean;
}

const dayMs = 86_400_000;
const dateStr = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const dayNum = (s: string) => Math.floor(Date.parse(`${s}T00:00:00Z`) / dayMs);
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);

export function isStale(latestDate: string | null, date: string): boolean {
  if (!latestDate) return false;
  return dayNum(date) - dayNum(latestDate) > STALE_AFTER_DAYS;
}

export interface LatestMetrics { metrics: Record<string, number | null>; latestDate: string | null; stale: boolean }

/** One grouped query for all processes: latest value per (process, metric) within 45 days of `date`. */
export async function loadLatestMetrics(processIds: string[], date: string): Promise<Map<string, LatestMetrics>> {
  const out = new Map<string, LatestMetrics>();
  if (processIds.length === 0) return out;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT process_id, metric_key, actual_value, score_date
       FROM process_metric_actual
      WHERE process_id IN (?) AND metric_key IN (?) AND actual_value IS NOT NULL
        AND score_date >= ? AND score_date <= ?
      ORDER BY score_date ASC`,
    [processIds, [...OPS_METRIC_KEYS], addDays(date, -METRIC_WINDOW_DAYS), date],
  );
  const seenDate = new Map<string, string>(); // process|metric -> date
  for (const id of processIds) out.set(id, { metrics: Object.fromEntries(OPS_METRIC_KEYS.map((k) => [k, null])), latestDate: null, stale: false });
  for (const r of rows) {
    const pid = String(r.process_id);
    const key = String(r.metric_key);
    const entry = out.get(pid);
    if (!entry || !(OPS_METRIC_KEYS as readonly string[]).includes(key)) continue;
    const d = dateStr(r.score_date);
    const n = Number(r.actual_value);
    if (!Number.isFinite(n)) continue;
    const k = `${pid}|${key}`;
    if (!seenDate.has(k) || d >= seenDate.get(k)!) {
      seenDate.set(k, d);
      entry.metrics[key] = n;
    }
    if (!entry.latestDate || d > entry.latestDate) entry.latestDate = d;
  }
  for (const e of out.values()) e.stale = isStale(e.latestDate, date);
  return out;
}

/** Numeric client ids (clientId and fcrClientId) of the inbound projects mapped to these processes. */
export async function clientIdsForProcesses(processIds: string[]): Promise<number[]> {
  if (processIds.length === 0) return [];
  const set = new Set(processIds.map(String));
  const projects = await getInboundProjects({ includeDbOnly: true });
  const ids = new Set<number>();
  for (const p of projects) {
    if (!p.processId || !set.has(String(p.processId))) continue;
    for (const raw of [p.clientId, p.fcrClientId]) {
      if (raw == null) continue;
      const s = String(raw).trim();
      if (!/^\d+$/.test(s)) continue;
      ids.add(Number(s));
    }
  }
  return [...ids];
}

const ok = <T>(data: T, asOf: string): SectionResult<T> => ({ status: "ok", data, asOf });
const empty = <T>(asOf: string): SectionResult<T> => ({ status: "empty", data: null, asOf });
const fail = <T>(asOf: string, message = "Section could not be loaded"): SectionResult<T> => ({ status: "error", data: null, asOf, message });

async function safe<T>(asOf: string, fn: () => Promise<SectionResult<T>>, label: string): Promise<SectionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[branch-head-health] ${label} failed`, err);
    return fail<T>(asOf);
  }
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

async function buildCallmaster(processIds: string[], range: { startDate: string; endDate: string }): Promise<SectionResult<unknown>> {
  const asOf = range.endDate;
  const clientIds = await clientIdsForProcesses(processIds);
  // Empty clientIds means ALL clients in the service: never call it without a filter.
  if (clientIds.length === 0) return empty(asOf);
  const filters = { startDate: range.startDate, endDate: range.endDate, clientIds };
  const [kpis, qualityTrend, cx, fatal] = await Promise.all([
    safe(asOf, async () => ok(await getKPIs(filters), asOf), "callmaster kpis"),
    safe(asOf, async () => ok(await getQualityTrend(filters, "daily"), asOf), "callmaster quality trend"),
    safe(asOf, async () => ok(await getCXParameters(filters), asOf), "callmaster cx"),
    safe(asOf, async () => {
      const rows = await getFatalAgentSummary(filters, FATAL_ROW_LIMIT);
      let totalFatalCalls = 0;
      const agents = new Set<string>();
      for (const r of rows as Array<Record<string, unknown>>) {
        const n = Number(r.fatal_calls) || 0;
        if (n <= 0) continue;
        totalFatalCalls += n;
        // Most stable key the row carries: agent code if present, else name + client.
        const code = r.agent_code ?? r.user ?? r.agent_id;
        agents.add(code != null ? `c:${String(code)}` : `n:${String(r.agent)}|${String(r.client)}`);
      }
      // Counts only: names stay in the process drill-down.
      return ok({ totalFatalCalls, agentsWithFatals: agents.size, truncated: rows.length >= FATAL_ROW_LIMIT }, asOf);
    }, "callmaster fatal"),
  ]);
  const parts = { kpis, qualityTrend, cx, fatal };
  if (Object.values(parts).every((p) => p.status === "error")) return fail(asOf);
  return ok(parts, asOf);
}

export async function buildOpsSections(
  processes: BranchProcess[],
  range: { startDate: string; endDate: string },
): Promise<{ operations: SectionResult<unknown>; quality: SectionResult<unknown>; callmaster: SectionResult<unknown> }> {
  const asOf = range.endDate;
  const real = processes.filter((p) => !p.billingMirror);
  const ids = real.map((p) => p.processId);

  const metricsP = safe<OpsProcessRow[]>(asOf, async () => {
    if (real.length === 0) return empty(asOf);
    const latest = await loadLatestMetrics(ids, asOf);
    const rows: OpsProcessRow[] = real.map((p) => {
      const l = latest.get(p.processId);
      return {
        processCode: p.processCode, processName: p.processName, tier: p.tier,
        metrics: l?.metrics ?? Object.fromEntries(OPS_METRIC_KEYS.map((k) => [k, null])),
        latestDate: l?.latestDate ?? null, stale: l?.stale ?? false,
      };
    });
    return ok(rows, asOf);
  }, "ops metrics");

  const callmasterP = safe(asOf, () => buildCallmaster(ids, range), "callmaster");
  const metrics = await metricsP;

  const operations: SectionResult<unknown> = metrics;
  let quality: SectionResult<unknown>;
  if (metrics.status !== "ok" || !metrics.data) {
    quality = metrics.status === "error" ? fail(asOf) : empty(asOf);
  } else {
    const rows: QualityRow[] = metrics.data
      .filter((r) => (r.tier === "full" || r.tier === "inbound_quality") && r.metrics.QA_QUALITY_PCT != null)
      .map((r) => ({
        processCode: r.processCode, processName: r.processName, tier: r.tier,
        QA_QUALITY_PCT: r.metrics.QA_QUALITY_PCT, latestDate: r.latestDate, stale: r.stale,
      }))
      .sort((a, b) => (a.QA_QUALITY_PCT as number) - (b.QA_QUALITY_PCT as number))
      .slice(0, QUALITY_LIMIT);
    quality = rows.length ? ok(rows, asOf) : empty(asOf);
  }
  return { operations, quality, callmaster: await callmasterP };
}
