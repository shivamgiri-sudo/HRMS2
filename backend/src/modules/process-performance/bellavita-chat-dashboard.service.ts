import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Bellavita's real Chat performance dashboard -- live aggregates over
 * db_masmis.bb_chat, via GET /api/process-performance/
 * bellavita-chat-dashboard. This table is genuinely huge (189,018 rows,
 * confirmed live 2026-09-17) -- a date-range filter is required here (not
 * just a UX nicety, as with the smaller dashboards elsewhere in this
 * folder) so a query doesn't scan the whole table on every page load.
 * Defaults to the last 30 days.
 *
 * Column caveats found while building this, kept as-is rather than
 * silently "corrected":
 * - is_resolved is NOT a boolean despite its name -- confirmed live it
 *   holds decimal numbers ("32.89", "1148.19", etc., 24,000+ distinct
 *   values) on most rows, which look like a resolution-time figure that
 *   landed in the wrong column during export/upload. "Resolved" is
 *   instead derived from ticket_status IN ('resolved','closed'), which is
 *   clean, reliable text.
 * - agent_name/emp_id/chat_date are NULL on a meaningful share of rows
 *   (visibly true for the most recently uploaded batch) while tl_name
 *   stays populated -- TL-wise is offered as the more complete breakdown;
 *   Agent-wise groups the NULL rows under "Unassigned" rather than
 *   dropping them.
 */

export interface BellavitaChatHeadline {
  totalTickets: number;
  resolvedPct: number;
  repeatPct: number;
  /** frt_1/resolution_time/average_wait_time are all small decimal-minute
   * figures on live data (e.g. average_wait_time ranges 0.2-78.73) -- not
   * seconds or hours, confirmed by inspecting real distinct values rather
   * than assumed from the column name. */
  avgFrtMin: number;
  avgResolutionMin: number;
  avgWaitTimeMin: number;
  activeAgents: number;
  activeTls: number;
}

export interface BellavitaChatTrendRow { date: string; tickets: number; resolvedPct: number }
export interface BellavitaChatDispositionRow { disposition: string; count: number; pct: number }
export interface BellavitaChatTlRow { tlName: string; tickets: number; resolvedPct: number; repeatPct: number }
export interface BellavitaChatAgentRow { agent: string; empId: string; tickets: number; resolvedPct: number; avgWaitTimeMin: number }

export interface BellavitaChatDashboardData {
  headline: BellavitaChatHeadline;
  from: string;
  to: string;
  dateWiseTrend: BellavitaChatTrendRow[];
  dispositionBreakdown: BellavitaChatDispositionRow[];
  byTl: BellavitaChatTlRow[];
  agents: BellavitaChatAgentRow[];
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function pad2(n: number): string { return String(n).padStart(2, "0"); }

/** bb_chat has no index on chat_date/tl_name/agent_name/disposition and
 * this app's DB user has no ALTER privilege to add one (same boundary
 * documented elsewhere in this codebase) -- confirmed live, a 30-day
 * window over this table's 189K rows took ~112s end to end, unacceptable
 * for a page load. Defaulting to 7 days keeps the common case fast; the
 * picker still allows widening it (slower, but the user's own choice). */
function last7DaysRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 6);
  const f = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return { from: f(from), to: f(now) };
}

function resolveRange(fromInput: string, toInput: string): { from: string; to: string } {
  const fallback = last7DaysRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

const RESOLVED_EXPR = "ticket_status IN ('resolved','closed')";

export async function getBellavitaChatDashboard(fromInput: string, toInput: string): Promise<BellavitaChatDashboardData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const range = [from, to];

  const [[headlineRow]] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN ${RESOLVED_EXPR} THEN 1 ELSE 0 END) AS resolved,
       SUM(CASE WHEN repeat_status = 'Repeat' THEN 1 ELSE 0 END) AS repeat_count,
       AVG(NULLIF(frt_1, '') + 0) AS avg_frt,
       AVG(NULLIF(resolution_time, '') + 0) AS avg_resolution,
       AVG(NULLIF(average_wait_time, '') + 0) AS avg_wait,
       COUNT(DISTINCT NULLIF(emp_id, '')) AS active_agents,
       COUNT(DISTINCT NULLIF(tl_name, '')) AS active_tls
     FROM db_masmis.bb_chat
     WHERE chat_date >= ? AND chat_date < DATE_ADD(?, INTERVAL 1 DAY)`,
    range,
  );

  const [trendRows] = await db.execute<RowDataPacket[]>(
    `SELECT chat_date AS d, COUNT(*) AS tickets, SUM(CASE WHEN ${RESOLVED_EXPR} THEN 1 ELSE 0 END) AS resolved
     FROM db_masmis.bb_chat
     WHERE chat_date >= ? AND chat_date < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY chat_date ORDER BY d ASC`,
    range,
  );

  const [dispositionRows] = await db.execute<RowDataPacket[]>(
    `SELECT disposition, COUNT(*) AS n
     FROM db_masmis.bb_chat
     WHERE chat_date >= ? AND chat_date < DATE_ADD(?, INTERVAL 1 DAY) AND disposition IS NOT NULL AND disposition != ''
     GROUP BY disposition ORDER BY n DESC`,
    range,
  );

  const [tlRows] = await db.execute<RowDataPacket[]>(
    `SELECT tl_name, COUNT(*) AS n,
       SUM(CASE WHEN ${RESOLVED_EXPR} THEN 1 ELSE 0 END) AS resolved,
       SUM(CASE WHEN repeat_status = 'Repeat' THEN 1 ELSE 0 END) AS repeat_count
     FROM db_masmis.bb_chat
     WHERE chat_date >= ? AND chat_date < DATE_ADD(?, INTERVAL 1 DAY) AND tl_name IS NOT NULL AND tl_name != ''
     GROUP BY tl_name ORDER BY n DESC`,
    range,
  );

  const [agentRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(agent_name, ''), 'Unassigned') AS agent, MAX(emp_id) AS emp_id, COUNT(*) AS n,
       SUM(CASE WHEN ${RESOLVED_EXPR} THEN 1 ELSE 0 END) AS resolved,
       AVG(NULLIF(average_wait_time, '') + 0) AS avg_wait
     FROM db_masmis.bb_chat
     WHERE chat_date >= ? AND chat_date < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY agent ORDER BY n DESC LIMIT 200`,
    range,
  );

  const total = num(headlineRow?.total);

  return {
    headline: {
      totalTickets: total,
      resolvedPct: pct(num(headlineRow?.resolved), total),
      repeatPct: pct(num(headlineRow?.repeat_count), total),
      avgFrtMin: Math.round(num(headlineRow?.avg_frt) * 100) / 100,
      avgResolutionMin: Math.round(num(headlineRow?.avg_resolution) * 100) / 100,
      avgWaitTimeMin: Math.round(num(headlineRow?.avg_wait) * 100) / 100,
      activeAgents: num(headlineRow?.active_agents),
      activeTls: num(headlineRow?.active_tls),
    },
    from, to,
    dateWiseTrend: trendRows.map((r) => ({
      date: String(r.d), tickets: num(r.tickets), resolvedPct: pct(num(r.resolved), num(r.tickets)),
    })),
    dispositionBreakdown: dispositionRows.map((r) => ({
      disposition: String(r.disposition), count: num(r.n), pct: pct(num(r.n), total),
    })),
    byTl: tlRows.map((r) => ({
      tlName: String(r.tl_name), tickets: num(r.n), resolvedPct: pct(num(r.resolved), num(r.n)), repeatPct: pct(num(r.repeat_count), num(r.n)),
    })),
    agents: agentRows.map((r) => ({
      agent: String(r.agent), empId: String(r.emp_id || ""), tickets: num(r.n),
      resolvedPct: pct(num(r.resolved), num(r.n)), avgWaitTimeMin: Math.round(num(r.avg_wait) * 100) / 100,
    })),
  };
}
