/** Process Dashboard -- loads the normalized rows + QA buckets for a process and date window (cached), and resolves date ranges. */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { datasetCache, smallCache } from "./pd.cache.js";
import { addDays } from "./pd.anomalies.js";
import type { NormRow, QaBucket } from "./pd.metrics.js";
import { PdError, fetchRows, readFreshness, resolveConfig, type Freshness, type PdConfig, type Resolved } from "./pd.source.js";
import { getConfig } from "./pd.config.service.js";

export const MAX_RANGE_DAYS = 400;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIso = (s: unknown): s is string => typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const localIso = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface Loaded { cfg: PdConfig; resolved: Resolved }
/** Config that is enabled-or-not but must be mapped; throws 404/409 with a clear code otherwise. */
export async function loadConfigOrThrow(processId: string, opts: { requireEnabled?: boolean } = { requireEnabled: true }): Promise<Loaded> {
  const cfg = await getConfig(processId);
  if (!cfg) throw new PdError(404, "NO_CONFIG", "No dashboard configuration for this process");
  if (cfg.category === "unconfigured" || !cfg.aprTable) throw new PdError(409, "NOT_CONFIGURED", "This process's dashboard has not been configured yet");
  if (opts.requireEnabled !== false && !cfg.enabled) throw new PdError(409, "DISABLED", "This process's dashboard is not enabled");
  const resolved = await resolveConfig(cfg);
  return { cfg, resolved };
}

export const cfgStamp = (cfg: PdConfig): string => `${cfg.updatedAt ?? ""}`;

export async function getFreshness(l: Loaded): Promise<Freshness> {
  return smallCache.wrap(`${l.cfg.processId}|fresh|${cfgStamp(l.cfg)}`, () => readFreshness(l.resolved));
}

export interface Dataset { rows: NormRow[]; qa: QaBucket[]; truncated: boolean; badValues: Record<string, number> }

export async function loadQa(processId: string, from: string, to: string, agentCode?: string): Promise<QaBucket[]> {
  const params: unknown[] = [processId, from, to];
  if (agentCode) params.push(agentCode);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT UPPER(e.employee_code) AS agent, DATE_FORMAT(a.audit_date, '%Y-%m-%d') AS d, COUNT(a.quality_percentage) AS n,
            COALESCE(SUM(a.quality_percentage), 0) AS s, COALESCE(SUM(a.fatal_triggered), 0) AS f
       FROM qa_audit a JOIN employees e ON e.id = a.employee_id
      WHERE a.process_id = ? AND a.audit_date BETWEEN ? AND ? AND a.status IN ('submitted','calibrated','closed')
        ${agentCode ? "AND e.employee_code = ?" : ""}
      GROUP BY agent, d LIMIT 100000`, params);
  return rows.map((r) => ({ agentCode: String(r.agent), date: String(r.d), n: Number(r.n), sum: Number(r.s), fatal: Number(r.f) }));
}

export async function loadDataset(l: Loaded, from: string, to: string): Promise<Dataset> {
  if (daysBetween(from, to) > MAX_RANGE_DAYS * 2) throw new PdError(400, "RANGE_TOO_LARGE", `Date window too large (max ${MAX_RANGE_DAYS} days)`);
  return datasetCache.wrap(`${l.cfg.processId}|ds|${cfgStamp(l.cfg)}|${from}|${to}`, async () => {
    const [src, qa] = await Promise.all([fetchRows(l.resolved, { from, to }), loadQa(l.cfg.processId, from, to)]);
    return { rows: src.rows, qa, truncated: src.truncated, badValues: src.stats.badValues };
  });
}

/** from/to win; otherwise the month containing the latest data date (so a lagging feed still shows its newest month), to = latest date. */
export function resolveRange(q: { from?: unknown; to?: unknown }, fresh: Freshness): { from: string; to: string } {
  const latest = fresh.latestDate ?? localIso();
  let to = isIso(q.to) ? q.to : isIso(q.from) ? (latest < q.from ? q.from : latest) : latest;
  let from = isIso(q.from) ? q.from : `${to.slice(0, 7)}-01`;
  if ((q.from !== undefined && q.from !== "" && !isIso(q.from)) || (q.to !== undefined && q.to !== "" && !isIso(q.to))) throw new PdError(400, "BAD_DATE", "from/to must be YYYY-MM-DD");
  if (to < from) [from, to] = [to, from];
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) throw new PdError(400, "RANGE_TOO_LARGE", `Range too large (max ${MAX_RANGE_DAYS} days)`);
  return { from, to };
}
export const previousRange = (from: string, to: string): { from: string; to: string } => {
  const len = daysBetween(from, to) + 1; return { from: addDays(from, -len), to: addDays(from, -1) };
};

export interface Filters { tl?: string; lob?: string }
export const applyFilters = (rows: NormRow[], f: Filters): NormRow[] => {
  const tl = f.tl?.trim().toLowerCase(); const lob = f.lob?.trim().toLowerCase();
  if (!tl && !lob) return rows;
  return rows.filter((r) => (!tl || (r.tl_name ?? "unassigned").toLowerCase() === tl) && (!lob || (r.lob ?? "unassigned").toLowerCase() === lob));
};
export const inRange = <T extends { date: string }>(rows: T[], from: string, to: string): T[] => rows.filter((r) => r.date >= from && r.date <= to);
