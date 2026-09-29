import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { listProcesses } from "./process-operations.service.js";

/**
 * All-process comparison for the KPI Metrics page: per process, how many metrics meet / miss /
 * lack a target on their LATEST reading, how fresh the feed is, and the single worst miss.
 *
 * One aggregate query (latest reading per process+metric joined to its live target), not one
 * request per process, so the whole portfolio costs about what one process page does.
 * Read-only. Uses the same target rule as getProcessOperations: the active, open-ended
 * kpi_studio_definition with a target_value for that process.
 */

export interface PortfolioWorst { metricKey: string; label: string; unit: string | null; value: number; target: number; direction: string; gapRatio: number }
export interface PortfolioRow {
  processId: string; processName: string; processCode: string | null; branchName: string | null; headcount: number;
  metrics: number; pass: number; fail: number; none: number; score: number | null;
  newestDate: string | null; staleDays: number | null; feedStopped: boolean; worst: PortfolioWorst | null;
}

const STALE_AFTER_DAYS = 3;
const WINDOW_DAYS = 45;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; p: Promise<PortfolioRow[]> }>();

function isoDate(v: unknown): string {
  const d = v instanceof Date ? v : new Date(String(v));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysSince(dateStr: string): number {
  const then = new Date(`${dateStr}T00:00:00`); const n = new Date();
  return Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime() - then.getTime()) / 86_400_000);
}

async function compute(userId: string): Promise<PortfolioRow[]> {
  const processes = await listProcesses(userId, WINDOW_DAYS);
  if (!processes.length) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.process_id, a.metric_key, a.actual_value, a.score_date, m.metric_name, m.unit, m.direction, t.target_value
       FROM process_metric_actual a
       JOIN (SELECT process_id, metric_key, MAX(score_date) d
               FROM process_metric_actual
              WHERE actual_value IS NOT NULL AND score_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
              GROUP BY process_id, metric_key) l
         ON l.process_id = a.process_id AND l.metric_key = a.metric_key AND l.d = a.score_date
       LEFT JOIN kpi_metric_master m ON m.metric_code = a.metric_key
       LEFT JOIN (SELECT d.process_id, m2.metric_code, MAX(d.target_value) target_value
                    FROM kpi_studio_definition d JOIN kpi_metric_master m2 ON m2.id = d.metric_id
                   WHERE d.active_status = 1 AND d.effective_to IS NULL AND d.target_value IS NOT NULL
                   GROUP BY d.process_id, m2.metric_code) t
         ON t.process_id = a.process_id AND t.metric_code = a.metric_key
      WHERE a.actual_value IS NOT NULL`,
    [WINDOW_DAYS],
  );

  type Acc = { pass: number; fail: number; none: number; metrics: number; newest: string | null; worst: PortfolioWorst | null };
  const acc = new Map<string, Acc>();
  for (const r of rows as any[]) {
    const pid = String(r.process_id);
    const a = acc.get(pid) ?? { pass: 0, fail: 0, none: 0, metrics: 0, newest: null, worst: null };
    acc.set(pid, a);
    a.metrics++;
    const date = isoDate(r.score_date);
    if (!a.newest || date > a.newest) a.newest = date;
    const value = Number(r.actual_value);
    const target = r.target_value === null ? null : Number(r.target_value);
    const direction = r.direction ? String(r.direction) : null;
    if (target === null || !direction) { a.none++; continue; }
    const ok = direction === "higher_is_better" ? value >= target : value <= target;
    if (ok) { a.pass++; continue; }
    a.fail++;
    const gap = target === 0 ? 0 : (direction === "higher_is_better" ? target - value : value - target) / Math.abs(target);
    if (!a.worst || gap > a.worst.gapRatio) {
      a.worst = { metricKey: String(r.metric_key), label: r.metric_name ? String(r.metric_name) : String(r.metric_key), unit: r.unit ? String(r.unit) : null, value, target, direction, gapRatio: gap };
    }
  }

  return processes.map((p) => {
    const a = acc.get(p.processId);
    const targeted = a ? a.pass + a.fail : 0;
    const newest = a?.newest ?? p.latestDate;
    const staleDays = newest ? daysSince(newest) : null;
    return {
      processId: p.processId, processName: p.processName, processCode: p.processCode, branchName: p.branchName, headcount: p.headcount,
      metrics: a?.metrics ?? p.metrics, pass: a?.pass ?? 0, fail: a?.fail ?? 0, none: a?.none ?? 0,
      score: targeted > 0 ? Math.round((100 * (a as Acc).pass) / targeted) : null,
      newestDate: newest, staleDays, feedStopped: staleDays !== null && staleDays > STALE_AFTER_DAYS, worst: a?.worst ?? null,
    };
  });
}

/** Short-lived cache + in-flight sharing per viewer: the page polls, and the scope is per user. */
export function getPortfolio(userId: string): Promise<PortfolioRow[]> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const p = compute(userId);
  cache.set(userId, { at: Date.now(), p });
  p.catch(() => { if (cache.get(userId)?.p === p) cache.delete(userId); });
  if (cache.size > 200) { const k = cache.keys().next().value; if (k) cache.delete(k); }
  return p;
}
