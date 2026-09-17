import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Neemans' combined Sale/Allocation/Chat/Productivity dashboard -- live
 * aggregates over all 4 of Neemans' raw uploaded tables, via GET
 * /api/process-performance/neemans-performance-dashboard. Everything here
 * is computed in SQL (GROUP BY), not pulled row-by-row into JS, because
 * these tables are genuinely large -- confirmed live 2026-09-17:
 * neemans_sale_raw 6,051 rows, neemans_allocation 57,483 rows,
 * neemans_apr 403 rows, neemans_chat 4 rows, nms_Agent_Details 22 rows,
 * neemans_month_targets 2 rows. Whatever is uploaded next shows up here
 * automatically -- no hardcoded row caps or hand-picked ranges.
 *
 * Column mapping, verified live, not guessed:
 * - Sale: neemans_sale_raw.amount/payment_status/final_status(RTO)/tl/lob.
 *   Real RTO data exists here (final_status='RTO', 137/6051 rows) -- unlike
 *   GNC's sibling dashboard, which had no RTO column at all.
 * - Target/Achievement: nms_Agent_Details.monthly_target (a real per-agent
 *   roster figure), NOT neemans_sale_raw's own per-row `target` column --
 *   that column repeats a single value across many rows on the same
 *   TL/day and its exact meaning isn't confirmed, same caution already
 *   applied to GNC's ambiguous per-row target field.
 * - Allocation: neemans_allocation.calling_status/type(Shopify/GOKWICK).
 *   `date` mixes "D-Mon-YY" text, raw Excel serials, and the literal "0"
 *   placeholder across rows -- parsed via the SQL CASE expression in
 *   ALLOC_DATE_EXPR below rather than fetched into JS for per-row parsing.
 * - Chat: neemans_chat.is_resolved/frt/resolution_time/csat_rating -- only
 *   4 live rows right now, genuinely thin, not a bug.
 * - Productivity: neemans_apr.calls/login_time/talk/occu_pct/attendance.
 *
 * No date-range picker for Sale/Allocation/Productivity: neemans_sale_raw
 * and neemans_apr use consistent "D-Mon-YY" text (parseable), but
 * neemans_allocation's mixed-format `date` makes a reliable range filter
 * fragile across all three at once. This dashboard shows all currently
 * uploaded data instead of fabricating date-scoped precision; a Sale-only
 * date-wise trend is still provided since that table's dates are clean.
 */

export interface NeemansOverviewHeadline {
  saleRevenue: number;
  saleCount: number;
  rtoPct: number;
  totalAllocation: number;
  allocationConnectedPct: number;
  totalChatTickets: number;
  chatResolvedPct: number;
  avgOccupancyPct: number;
}

export interface NeemansSaleData {
  headline: {
    revenue: number; saleCount: number; aov: number;
    prepaidPct: number; codPct: number; rtoPct: number;
    activeAgents: number; target: number; achievementPct: number;
  };
  dateWiseTrend: Array<{ date: string; saleCount: number; revenue: number; rtoCount: number }>;
  paymentBreakdown: Array<{ paymentStatus: string; count: number; revenue: number }>;
  byTl: Array<{ tlName: string; saleCount: number; revenue: number; rtoPct: number; target: number; achievementPct: number }>;
  agents: Array<{ empId: string; name: string; tlName: string; saleCount: number; revenue: number; rtoPct: number; prepaidPct: number; target: number; achievementPct: number }>;
}

export interface NeemansAllocationData {
  headline: {
    totalAllocation: number; connected: number; connectedPct: number;
    notConnected: number; pending: number; uniquePhones: number; activeAgents: number;
  };
  typeBreakdown: Array<{ type: string; count: number; connectedPct: number }>;
  statusBreakdown: Array<{ status: string; count: number; pct: number }>;
  agents: Array<{ agent: string; allocation: number; connected: number; connectedPct: number }>;
}

export interface NeemansChatData {
  headline: {
    totalTickets: number; resolvedPct: number; avgFrtHrs: number; avgResolutionHrs: number; avgCsat: number;
  };
  byLob: Array<{ lob: string; tickets: number; resolvedPct: number }>;
  agents: Array<{ agent: string; empId: string; tickets: number; resolvedPct: number; avgCsat: number }>;
}

export interface NeemansProductivityData {
  headline: {
    totalCalls: number; activeAgents: number; avgOccupancyPct: number; attendanceDays: number;
  };
  dateWiseTrend: Array<{ date: string; calls: number; avgOccupancyPct: number; loginAgents: number }>;
  agents: Array<{ empId: string; name: string; calls: number; loginTimeSec: number; talkTimeSec: number; occupancyPct: number; attendanceDays: number }>;
}

export interface NeemansPerformanceDashboardData {
  overview: NeemansOverviewHeadline;
  sale: NeemansSaleData;
  allocation: NeemansAllocationData;
  chat: NeemansChatData;
  productivity: NeemansProductivityData;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);
function timeToSec(v: unknown): number {
  const m = String(v ?? "").trim().match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** neemans_sale_raw.date / neemans_apr.date are "D-Mon-YY" text (e.g.
 * "31-Aug-26") -- MySQL parses this natively via STR_TO_DATE with %e-%b-%y. */
const SALE_DATE_EXPR = "STR_TO_DATE(date, '%e-%b-%y')";

async function getSaleData(): Promise<NeemansSaleData> {
  const [[headlineRow]] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(amount) AS revenue, COUNT(*) AS sale_count,
       SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS prepaid_count,
       SUM(CASE WHEN payment_status = 'cod' THEN 1 ELSE 0 END) AS cod_count,
       SUM(CASE WHEN final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count,
       COUNT(DISTINCT NULLIF(emp_id, '')) AS active_agents
     FROM db_masmis.neemans_sale_raw`,
  );

  // Roster fetched once (22 rows) and joined in JS below -- replaces what
  // was originally a correlated subquery per TL/agent group row. Each of
  // those subqueries is a cheap query on its own, but this table lives on
  // a remote host (confirmed elsewhere in this session: 300-750ms/query
  // off-LAN), and dozens of round trips compounded into an ~88s page load.
  // One extra query + a JS Map lookup is strictly faster.
  const [rosterRows] = await db.execute<RowDataPacket[]>(
    `SELECT emp_id, tl, monthly_target FROM db_masmis.nms_Agent_Details WHERE status = 'Active'`,
  );
  const targetByEmpId = new Map<string, number>();
  const targetByTl = new Map<string, number>();
  let totalActiveTarget = 0;
  for (const r of rosterRows) {
    const empId = String(r.emp_id ?? "").trim();
    const tl = String(r.tl ?? "").trim();
    const t = num(r.monthly_target);
    if (empId) targetByEmpId.set(empId, t);
    if (tl) targetByTl.set(tl, (targetByTl.get(tl) ?? 0) + t);
    totalActiveTarget += t;
  }

  const [trendRows] = await db.execute<RowDataPacket[]>(
    `SELECT ${SALE_DATE_EXPR} AS d, COUNT(*) AS sale_count, SUM(amount) AS revenue,
       SUM(CASE WHEN final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count
     FROM db_masmis.neemans_sale_raw
     WHERE ${SALE_DATE_EXPR} IS NOT NULL
     GROUP BY ${SALE_DATE_EXPR} ORDER BY d ASC`,
  );

  const [paymentRows] = await db.execute<RowDataPacket[]>(
    `SELECT payment_status, COUNT(*) AS n, SUM(amount) AS revenue
     FROM db_masmis.neemans_sale_raw
     WHERE payment_status IS NOT NULL AND payment_status != ''
     GROUP BY payment_status ORDER BY n DESC`,
  );

  const [tlRows] = await db.execute<RowDataPacket[]>(
    `SELECT tl AS tl_name, COUNT(*) AS sale_count, SUM(amount) AS revenue,
       SUM(CASE WHEN final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count
     FROM db_masmis.neemans_sale_raw
     WHERE tl IS NOT NULL AND tl != ''
     GROUP BY tl ORDER BY revenue DESC`,
  );

  const [agentRows] = await db.execute<RowDataPacket[]>(
    `SELECT emp_id, MAX(name) AS name, MAX(tl) AS tl_name,
       COUNT(*) AS sale_count, SUM(amount) AS revenue,
       SUM(CASE WHEN final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count,
       SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS prepaid_count
     FROM db_masmis.neemans_sale_raw
     WHERE emp_id IS NOT NULL AND emp_id != ''
     GROUP BY emp_id ORDER BY revenue DESC`,
  );

  const revenue = num(headlineRow?.revenue);
  const saleCount = num(headlineRow?.sale_count);
  const target = totalActiveTarget;

  return {
    headline: {
      revenue, saleCount,
      aov: saleCount > 0 ? Math.round((revenue / saleCount) * 100) / 100 : 0,
      prepaidPct: pct(num(headlineRow?.prepaid_count), saleCount),
      codPct: pct(num(headlineRow?.cod_count), saleCount),
      rtoPct: pct(num(headlineRow?.rto_count), saleCount),
      activeAgents: num(headlineRow?.active_agents),
      target,
      achievementPct: pct(revenue, target),
    },
    dateWiseTrend: trendRows.map((r) => ({
      date: String(r.d), saleCount: num(r.sale_count), revenue: num(r.revenue), rtoCount: num(r.rto_count),
    })),
    paymentBreakdown: paymentRows.map((r) => ({
      paymentStatus: String(r.payment_status), count: num(r.n), revenue: num(r.revenue),
    })),
    byTl: tlRows.map((r) => {
      const tlRevenue = num(r.revenue);
      const tlName = String(r.tl_name);
      const tlTarget = targetByTl.get(tlName) ?? 0;
      return {
        tlName, saleCount: num(r.sale_count), revenue: tlRevenue,
        rtoPct: pct(num(r.rto_count), num(r.sale_count)), target: tlTarget, achievementPct: pct(tlRevenue, tlTarget),
      };
    }),
    agents: agentRows.map((r) => {
      const agentRevenue = num(r.revenue);
      const empId = String(r.emp_id);
      const agentTarget = targetByEmpId.get(empId) ?? 0;
      return {
        empId, name: String(r.name || empId), tlName: String(r.tl_name || "Unassigned"),
        saleCount: num(r.sale_count), revenue: agentRevenue,
        rtoPct: pct(num(r.rto_count), num(r.sale_count)), prepaidPct: pct(num(r.prepaid_count), num(r.sale_count)),
        target: agentTarget, achievementPct: pct(agentRevenue, agentTarget),
      };
    }),
  };
}

async function getAllocationData(): Promise<NeemansAllocationData> {
  const [[headlineRow]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN calling_status = 'Connected' THEN 1 ELSE 0 END) AS connected,
       SUM(CASE WHEN calling_status = 'Not Connected' THEN 1 ELSE 0 END) AS not_connected,
       SUM(CASE WHEN calling_status = 'Pending to call' THEN 1 ELSE 0 END) AS pending,
       COUNT(DISTINCT NULLIF(phone, '')) AS unique_phones,
       COUNT(DISTINCT NULLIF(agent, '')) AS active_agents
     FROM db_masmis.neemans_allocation`,
  );
  const [typeRows] = await db.execute<RowDataPacket[]>(
    `SELECT type, COUNT(*) AS n, SUM(CASE WHEN calling_status = 'Connected' THEN 1 ELSE 0 END) AS connected
     FROM db_masmis.neemans_allocation WHERE type IS NOT NULL AND type != ''
     GROUP BY type ORDER BY n DESC`,
  );
  const [statusRows] = await db.execute<RowDataPacket[]>(
    `SELECT calling_status, COUNT(*) AS n
     FROM db_masmis.neemans_allocation WHERE calling_status IS NOT NULL AND calling_status != ''
     GROUP BY calling_status ORDER BY n DESC`,
  );
  const [agentRows] = await db.execute<RowDataPacket[]>(
    `SELECT agent, COUNT(*) AS n, SUM(CASE WHEN calling_status = 'Connected' THEN 1 ELSE 0 END) AS connected
     FROM db_masmis.neemans_allocation WHERE agent IS NOT NULL AND agent != ''
     GROUP BY agent ORDER BY n DESC LIMIT 100`,
  );

  const total = num(headlineRow?.total);
  return {
    headline: {
      totalAllocation: total,
      connected: num(headlineRow?.connected),
      connectedPct: pct(num(headlineRow?.connected), total),
      notConnected: num(headlineRow?.not_connected),
      pending: num(headlineRow?.pending),
      uniquePhones: num(headlineRow?.unique_phones),
      activeAgents: num(headlineRow?.active_agents),
    },
    typeBreakdown: typeRows.map((r) => ({ type: String(r.type), count: num(r.n), connectedPct: pct(num(r.connected), num(r.n)) })),
    statusBreakdown: statusRows.map((r) => ({ status: String(r.calling_status), count: num(r.n), pct: pct(num(r.n), total) })),
    agents: agentRows.map((r) => ({ agent: String(r.agent), allocation: num(r.n), connected: num(r.connected), connectedPct: pct(num(r.connected), num(r.n)) })),
  };
}

export async function getChatData(): Promise<NeemansChatData> {
  const [[headlineRow]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN is_resolved = '1' THEN 1 ELSE 0 END) AS resolved,
       AVG(NULLIF(frt, '') + 0) AS avg_frt,
       AVG(NULLIF(resolution_time, '') + 0) AS avg_resolution,
       AVG(NULLIF(csat_rating, '') + 0) AS avg_csat
     FROM db_masmis.neemans_chat`,
  );
  const [lobRows] = await db.execute<RowDataPacket[]>(
    `SELECT lob, COUNT(*) AS n, SUM(CASE WHEN is_resolved = '1' THEN 1 ELSE 0 END) AS resolved
     FROM db_masmis.neemans_chat WHERE lob IS NOT NULL AND lob != ''
     GROUP BY lob ORDER BY n DESC`,
  );
  const [agentRows] = await db.execute<RowDataPacket[]>(
    `SELECT agent_name, emp_id, COUNT(*) AS n,
       SUM(CASE WHEN is_resolved = '1' THEN 1 ELSE 0 END) AS resolved,
       AVG(NULLIF(csat_rating, '') + 0) AS avg_csat
     FROM db_masmis.neemans_chat WHERE agent_name IS NOT NULL AND agent_name != ''
     GROUP BY agent_name, emp_id ORDER BY n DESC LIMIT 100`,
  );

  const total = num(headlineRow?.total);
  return {
    headline: {
      totalTickets: total,
      resolvedPct: pct(num(headlineRow?.resolved), total),
      avgFrtHrs: Math.round(num(headlineRow?.avg_frt) * 100) / 100,
      avgResolutionHrs: Math.round(num(headlineRow?.avg_resolution) * 100) / 100,
      avgCsat: Math.round(num(headlineRow?.avg_csat) * 100) / 100,
    },
    byLob: lobRows.map((r) => ({ lob: String(r.lob), tickets: num(r.n), resolvedPct: pct(num(r.resolved), num(r.n)) })),
    agents: agentRows.map((r) => ({
      agent: String(r.agent_name), empId: String(r.emp_id || ""), tickets: num(r.n),
      resolvedPct: pct(num(r.resolved), num(r.n)), avgCsat: Math.round(num(r.avg_csat) * 100) / 100,
    })),
  };
}

async function getProductivityData(): Promise<NeemansProductivityData> {
  const [[headlineRow]] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(calls) AS total_calls, COUNT(DISTINCT NULLIF(emp_id, '')) AS active_agents,
       AVG(NULLIF(occu_pct, '') + 0) AS avg_occupancy, SUM(attendance) AS attendance_days
     FROM db_masmis.neemans_apr`,
  );
  const [trendRows] = await db.execute<RowDataPacket[]>(
    `SELECT ${SALE_DATE_EXPR} AS d, SUM(calls) AS calls,
       AVG(NULLIF(occu_pct, '') + 0) AS avg_occupancy, COUNT(DISTINCT NULLIF(emp_id, '')) AS login_agents
     FROM db_masmis.neemans_apr
     WHERE ${SALE_DATE_EXPR} IS NOT NULL
     GROUP BY ${SALE_DATE_EXPR} ORDER BY d ASC`,
  );
  const [rawAgentRows] = await db.execute<RowDataPacket[]>(
    `SELECT emp_id, MAX(emp_name) AS emp_name, SUM(calls) AS calls,
       GROUP_CONCAT(login_time SEPARATOR '|') AS login_times,
       GROUP_CONCAT(talk SEPARATOR '|') AS talk_times,
       AVG(NULLIF(occu_pct, '') + 0) AS avg_occupancy, SUM(attendance) AS attendance_days
     FROM db_masmis.neemans_apr WHERE emp_id IS NOT NULL AND emp_id != ''
     GROUP BY emp_id ORDER BY calls DESC LIMIT 100`,
  );

  return {
    headline: {
      totalCalls: num(headlineRow?.total_calls),
      activeAgents: num(headlineRow?.active_agents),
      avgOccupancyPct: Math.round(num(headlineRow?.avg_occupancy) * 100) / 100,
      attendanceDays: num(headlineRow?.attendance_days),
    },
    dateWiseTrend: trendRows.map((r) => ({
      date: String(r.d), calls: num(r.calls), avgOccupancyPct: Math.round(num(r.avg_occupancy) * 100) / 100, loginAgents: num(r.login_agents),
    })),
    agents: rawAgentRows.map((r) => {
      const loginSecs = String(r.login_times ?? "").split("|").map(timeToSec);
      const talkSecs = String(r.talk_times ?? "").split("|").map(timeToSec);
      return {
        empId: String(r.emp_id), name: String(r.emp_name || r.emp_id), calls: num(r.calls),
        loginTimeSec: loginSecs.reduce((s, v) => s + v, 0),
        talkTimeSec: talkSecs.reduce((s, v) => s + v, 0),
        occupancyPct: Math.round(num(r.avg_occupancy) * 100) / 100,
        attendanceDays: num(r.attendance_days),
      };
    }),
  };
}

export async function getNeemansPerformanceDashboard(): Promise<NeemansPerformanceDashboardData> {
  const [sale, allocation, chat, productivity] = await Promise.all([
    getSaleData(), getAllocationData(), getChatData(), getProductivityData(),
  ]);

  const overview: NeemansOverviewHeadline = {
    saleRevenue: sale.headline.revenue,
    saleCount: sale.headline.saleCount,
    rtoPct: sale.headline.rtoPct,
    totalAllocation: allocation.headline.totalAllocation,
    allocationConnectedPct: allocation.headline.connectedPct,
    totalChatTickets: chat.headline.totalTickets,
    chatResolvedPct: chat.headline.resolvedPct,
    avgOccupancyPct: productivity.headline.avgOccupancyPct,
  };

  return { overview, sale, allocation, chat, productivity };
}
