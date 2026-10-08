import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { getProjectOverview } from "../call-master/inbound.service.js";
import { getNeemansCartDashboard, currentMonthRange, type NeemansCartDashboardData } from "./neemans-cart-dashboard.service.js";

/**
 * Neemans' combined Sale/Allocation/Chat/Productivity dashboard -- live
 * aggregates over all 4 of Neemans' raw uploaded tables, via GET
 * /api/process-performance/neemans-performance-dashboard?from=&to=.
 * Everything here is computed in SQL (GROUP BY), not pulled row-by-row into
 * JS, because these tables are genuinely large -- confirmed live
 * 2026-09-17: neemans_sale_raw 6,051 rows, neemans_allocation 57,483 rows,
 * neemans_apr 403 rows, neemans_chat 4 rows, nms_Agent_Details 22 rows,
 * neemans_month_targets 2 rows. Whatever is uploaded next shows up here
 * automatically -- no hardcoded row caps or hand-picked ranges.
 *
 * Column mapping, verified live, not guessed:
 * - Sale: neemans_sale_raw.amount/payment_status/final_status(RTO)/tl/lob.
 *   Real RTO data exists here (final_status='RTO', 137/6051 rows) -- unlike
 *   GNC's sibling dashboard, which had no RTO column at all. `lob` is NOT
 *   surfaced as its own breakdown -- confirmed live, all 6,051 rows carry
 *   the single value "Cart", so a LOB-wise table would just be one row.
 * - Sale count everywhere below is COUNT(DISTINCT order_id), not COUNT(*):
 *   confirmed live, neemans_sale_raw has 6,051 rows but only 6,006 distinct
 *   order_id values -- 45 orders have >1 row (multiple line items on the
 *   same order), and counting rows would overstate order volume. Revenue
 *   still SUMs amount across all rows, since that's the real total across
 *   an order's line items.
 * - Target/Achievement: nms_Agent_Details.monthly_target (a real per-agent
 *   roster figure), NOT neemans_sale_raw's own per-row `target` column --
 *   that column repeats a single value across many rows on the same
 *   TL/day and its exact meaning isn't confirmed, same caution already
 *   applied to GNC's ambiguous per-row target field.
 * - Allocation: neemans_allocation.calling_status/type(Shopify/GOKWICK)/
 *   sub_scenario1 (a real, granular call-outcome reason -- "No Answer",
 *   "Call Back", "Sale Done", "PTP 24 HOURS", etc., confirmed live with 19
 *   distinct values). `date` is now parsed by ALLOC_DATE_EXPR below:
 *   confirmed live, 56,377/57,483 rows are a bare numeric Excel serial
 *   (same 1899-12-30 epoch as Sale/APR), 1,106 are "D-Mon-YY" text, and 1
 *   row is a literal "0" placeholder (left NULL/excluded).
 * - Chat: neemans_chat.is_resolved/frt/resolution_time/csat_rating/
 *   ticket_status/frt_tat/resolution_tat -- only 4 live rows right now,
 *   genuinely thin, not a bug. `report_date` is a clean, single-format
 *   "D-Mon-YY" string (confirmed live, all 4 rows) -- parsed by
 *   CHAT_DATE_EXPR below, unlike Sale/APR's `date` column.
 * - Productivity: neemans_apr.calls/login_time/talk/occu_pct/attendance/
 *   net_login/total_break (both real "H:MM:SS" text, parsed via
 *   TIME_TO_SEC() in SQL -- confirmed live, values like "8:15:44").
 *
 * Date-range filtering (from=/to=, both YYYY-MM-DD): applied to all four
 * tables via each one's own *_DATE_EXPR. When `from`/`to` are absent or
 * malformed, no filter is applied at all -- every function shows its full
 * uploaded history rather than silently defaulting to an empty "this
 * month" window, since this is historical bulk-uploaded data (Sale/APR
 * span 2026-06-01..2026-08-31 live, not the current month) rather than a
 * live daily feed. getChatData() is also called with no range at all by
 * the standalone /neemans-chat-dashboard route (Chat as its own page) --
 * that caller is unaffected, since omitting from/to there means "no
 * filter", exactly its current behavior.
 *
 * Overview extras -- `cart` and `inbound` exist only so the Overview tab can
 * show every Neemans source in one place. Both need a concrete range (the
 * cart export and the dialer CDR are queried by date, never "all time"), so
 * when from/to are absent they fall back to the current month. `cart` is the
 * same aggregate the standalone Abandoned Cart dashboard uses, minus its raw
 * records. `inbound` is the same dialer_db aggregate as the Inbound dashboard
 * (call-master/inbound.service.ts, project "neemans") -- that database is a
 * separate remote host, so a failure there is caught and returned as
 * `inbound: null` + `inboundError` instead of failing the whole dashboard.
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
  /** sale.headline.saleCount / allocation.headline.totalAllocation -- how many of the
   * numbers dialled through Allocation actually turned into an order. Matches the
   * reference management workbook (Neeman's Billing Sep 26.xlsb, sheet "Dashboard",
   * column "Conversion %") -- confirmed live there as Total Orders / Workable Data. Not
   * previously surfaced anywhere in this dashboard; both inputs were already computed,
   * this just divides them. */
  conversionPct: number;
}

export interface NeemansSaleData {
  headline: {
    revenue: number; saleCount: number; aov: number;
    prepaidPct: number; codPct: number; rtoPct: number;
    activeAgents: number; target: number; achievementPct: number;
  };
  dateWiseTrend: Array<{ date: string; saleCount: number; revenue: number; rtoCount: number }>;
  paymentBreakdown: Array<{ paymentStatus: string; count: number; revenue: number }>;
  /** neemans_sale_raw.current_status -- the order-fulfilment status (Delivered/RTO/
   * Dispatched/Cancelled/Unfulfilled/...), NOT `final_status` (which only ever carries
   * "-" or "RTO" in the live data, already used for the RTO KPIs above). Matches the
   * reference workbook's "OD Status Contribution" / Summary-sheet pivot (Neeman's
   * Abandon Cart Dashboard Aug'2026.xlsb, sheets "Dashboard" and "Summary") -- confirmed
   * live 2026-09-20 that `current_status` (not `final_status`) is what carries those
   * values: Unfulfilled 3768, Unfulfill 1143 (a real spelling split in the upstream
   * export, shown as-is rather than merged), Delivered 880, RTO 137, Dispatched 48,
   * Cancelled 28, Processing 1, OTHER 1. Not previously surfaced anywhere in this
   * dashboard. */
  orderStatusBreakdown: Array<{ status: string; count: number; revenue: number; pct: number }>;
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
  /** neemans_allocation.sub_scenario1 -- the granular reason behind each
   * calling_status (why a call wasn't connected, or what happened when it
   * was), not previously surfaced anywhere in this dashboard. */
  subScenarioBreakdown: Array<{ subScenario: string; count: number; pct: number }>;
  /** Newly possible now that ALLOC_DATE_EXPR reliably parses `date` --
   * this view had no date-wise trend at all before. */
  dateWiseTrend: Array<{ date: string; allocationCount: number; connectedPct: number }>;
  agents: Array<{ agent: string; allocation: number; connected: number; connectedPct: number }>;
}

export interface NeemansChatData {
  headline: {
    totalTickets: number; resolvedPct: number; avgFrtHrs: number; avgResolutionHrs: number; avgCsat: number;
    /** Share of tickets tagged "IN TAT" on frt_tat/resolution_tat -- real
     * columns already written by the uploader, not computed from a
     * threshold this app invented. */
    frtTatCompliancePct: number;
    resolutionTatCompliancePct: number;
  };
  byLob: Array<{ lob: string; tickets: number; resolvedPct: number }>;
  /** neemans_chat.inbox_name -- the actual channel (Neeman's WA, neemansofficial Insta,
   * a Facebook inbox, an Email inbox, ...), a finer grain than `lob` (Chat/SM/Email).
   * Matches the reference workbook's "Channel Wise" section (Neeman's Inbound & Chat
   * Dashboard Sep'26.xlsb, sheet "Chat Snap": neemansofficial Insta - Comment/DM,
   * Neemans FB - Comment/DM, Email, Neeman's WA). Not previously surfaced anywhere in
   * this dashboard. Only 4 live rows across 2 channels right now (db_masmis.neemans_chat
   * is genuinely thin, same caveat as the rest of this Chat tab) -- real, not fabricated,
   * and will fill out as more chat exports are uploaded. */
  channelBreakdown: Array<{ channel: string; tickets: number; resolvedPct: number }>;
  /** neemans_chat.ticket_status (open/waiting/closed/...), not previously
   * surfaced -- only the coarser is_resolved flag was. */
  statusBreakdown: Array<{ status: string; count: number; pct: number }>;
  /** Newly possible now that CHAT_DATE_EXPR parses report_date. */
  dateWiseTrend: Array<{ date: string; tickets: number; resolvedPct: number }>;
  agents: Array<{ agent: string; empId: string; tickets: number; resolvedPct: number; avgCsat: number }>;
}

export interface NeemansProductivityData {
  headline: {
    totalCalls: number; activeAgents: number; avgOccupancyPct: number; attendanceDays: number;
    /** neemans_apr.net_login/total_break averaged in seconds via SQL
     * TIME_TO_SEC(), not previously surfaced. */
    avgNetLoginSec: number;
    avgTotalBreakSec: number;
  };
  dateWiseTrend: Array<{ date: string; calls: number; avgOccupancyPct: number; loginAgents: number }>;
  /** neemans_apr.lob -- confirmed live 2026-09-20: every one of the 403 rows currently
   * in db_masmis.neemans_apr carries lob='Cart'. The reference workbook (Neeman's
   * Billing Sep 26.xlsb, sheet "APR Raw") shows this table is meant to carry Chat/
   * Inbound/Email/Social Media rows too (128/118/28/1 rows there, for September) --
   * those LOBs' APR exports have never been bulk-uploaded into this table for ANY
   * month, so this Productivity tab is really "Cart-process productivity" today, not
   * all-LOB productivity as its combined placement here implies. This breakdown is
   * real and will pick up the other LOBs automatically the moment their APR files are
   * uploaded -- nothing here is invented to fill that gap. */
  lobBreakdown: Array<{ lob: string; calls: number; agents: number; avgOccupancyPct: number }>;
  agents: Array<{ empId: string; name: string; calls: number; loginTimeSec: number; talkTimeSec: number; occupancyPct: number; attendanceDays: number }>;
}

export type NeemansCartOverview = Pick<
  NeemansCartDashboardData,
  "headline" | "dateWiseTrend" | "dispositionBreakdown" | "statusBreakdown"
>;

export interface NeemansInboundOverview {
  headline: {
    offered: number; answered: number; abandoned: number;
    answerPct: number; abandonPct: number; slPct: number;
    ahtSec: number; loginCount: number; uniquePhones: number;
    fcrPct: number | null;
  };
  dateWiseTrend: Array<{ date: string; offered: number; answered: number; slPct: number }>;
}

export interface NeemansPerformanceDashboardData {
  from: string | null;
  to: string | null;
  overview: NeemansOverviewHeadline;
  sale: NeemansSaleData;
  allocation: NeemansAllocationData;
  chat: NeemansChatData;
  productivity: NeemansProductivityData;
  cart: NeemansCartOverview;
  inbound: NeemansInboundOverview | null;
  inboundError: string | null;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);
function timeToSec(v: unknown): number {
  const m = String(v ?? "").trim().match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Builds an " AND <expr> >= ? AND <expr> < DATE_ADD(?, INTERVAL 1 DAY)"
 * fragment plus its bound params, or an empty fragment when from/to are
 * absent/malformed -- so every query below stays a plain "show everything
 * uploaded" query unless a real range was actually requested. */
function dateFilter(expr: string, from?: string, to?: string): { sql: string; params: string[] } {
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) return { sql: "", params: [] };
  return { sql: ` AND ${expr} >= ? AND ${expr} < DATE_ADD(?, INTERVAL 1 DAY)`, params: [from, to] };
}

/** `date` on both neemans_sale_raw and neemans_apr is NOT one consistent
 * text format -- confirmed live 2026-09-18 after a raw DB screenshot showed
 * values like "46174" instead of a readable date. Three formats coexist:
 *   - neemans_sale_raw: 3,800/6,051 rows are a bare numeric Excel date
 *     serial (e.g. "46174" -> 2026-06-01, verified via DATE_ADD('1899-12-30',
 *     INTERVAL n DAY)); the other 2,251 rows are "D-Mon-YY" text
 *     (e.g. "1-Aug-26"). Same `week` values mix both formats, so this is
 *     an export-time inconsistency, not two different batches.
 *   - neemans_apr: 271 rows are "D-Mon-YY" (2-digit year), 132 rows are
 *     "DD-Mon-YYYY" (4-digit year, e.g. "01-Jul-2026").
 * A plain STR_TO_DATE(date, '%e-%b-%y') silently returns NULL on whichever
 * of these it doesn't match, and every query below filters on
 * "IS NOT NULL" -- so the previous single-format version was quietly
 * dropping up to 63% of neemans_sale_raw from the date-wise view. This CASE
 * expression tries all three shapes instead of assuming one. */
const SALE_DATE_EXPR = `CASE
  WHEN date REGEXP '^[0-9]+$' THEN DATE_ADD('1899-12-30', INTERVAL CAST(date AS UNSIGNED) DAY)
  WHEN date REGEXP '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}$' THEN STR_TO_DATE(date, '%e-%b-%Y')
  WHEN date REGEXP '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{2}$' THEN STR_TO_DATE(date, '%e-%b-%y')
  ELSE NULL
END`;

/** neemans_allocation.`date` -- confirmed live 2026-09-19: 56,377/57,483
 * rows are a bare numeric Excel serial (same 1899-12-30 epoch as Sale/APR),
 * 1,106 rows are "D-Mon-YY" text, and 1 row is a literal "0" placeholder
 * (falls through to NULL/excluded, same as any other unparseable value). */
const ALLOC_DATE_EXPR = `CASE
  WHEN date REGEXP '^[1-9][0-9]*$' THEN DATE_ADD('1899-12-30', INTERVAL CAST(date AS UNSIGNED) DAY)
  WHEN date REGEXP '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{2}$' THEN STR_TO_DATE(date, '%e-%b-%y')
  ELSE NULL
END`;

/** neemans_chat.report_date -- confirmed live 2026-09-19: a clean, single
 * "D-Mon-YY" text format across all rows (e.g. "2-Aug-26"), unlike Sale/
 * APR/Allocation's mixed `date` columns. */
const CHAT_DATE_EXPR = `STR_TO_DATE(report_date, '%e-%b-%y')`;

/** neemans_sale_raw repeats an order on several rows (one per line item / a re-uploaded
 * file), each carrying the WHOLE order's amount -- Aug 2026: 11 orders on 24 rows, so
 * SUM(amount) overstated revenue by 36,358 and prepaid/COD/RTO row counts exceeded the
 * distinct-order denominator (Prepaid% + COD% = 100.58%). Keep one row per order. */
const ONE_ROW_PER_ORDER = ` AND (order_id IS NULL OR order_id = '' OR id IN (
  SELECT MIN(id) FROM db_masmis.neemans_sale_raw WHERE order_id IS NOT NULL AND order_id != '' GROUP BY order_id))`;

async function getSaleData(from?: string, to?: string): Promise<NeemansSaleData> {
  const f0 = dateFilter(SALE_DATE_EXPR, from, to);
  const f = { sql: f0.sql + ONE_ROW_PER_ORDER, params: f0.params };

  // The six queries below are independent, and this DB is a remote host at
  // ~300-750ms per round trip, so they are started together and awaited once
  // (Promise.all) instead of one after another -- same results, roughly a
  // sixth of the wall-clock time.
  const headlineP = db.execute<RowDataPacket[]>(
    `SELECT
       SUM(amount) AS revenue, COUNT(DISTINCT NULLIF(order_id, '')) AS sale_count,
       SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS prepaid_count,
       SUM(CASE WHEN payment_status = 'cod' THEN 1 ELSE 0 END) AS cod_count,
       SUM(CASE WHEN final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count,
       COUNT(DISTINCT NULLIF(emp_id, '')) AS active_agents
     FROM db_masmis.neemans_sale_raw WHERE 1=1${f.sql}`,
    f.params,
  );

  // Roster fetched once (22 rows) and joined in JS below -- replaces what
  // was originally a correlated subquery per TL/agent group row. Each of
  // those subqueries is a cheap query on its own, but this table lives on
  // a remote host (confirmed elsewhere in this session: 300-750ms/query
  // off-LAN), and dozens of round trips compounded into an ~88s page load.
  // One extra query + a JS Map lookup is strictly faster.
  const rosterP = db.execute<RowDataPacket[]>(
    `SELECT emp_id, tl, monthly_target FROM db_masmis.nms_Agent_Details WHERE status = 'Active'`,
  );

  const trendP = db.execute<RowDataPacket[]>(
    `SELECT ${SALE_DATE_EXPR} AS d, COUNT(DISTINCT NULLIF(order_id, '')) AS sale_count, SUM(amount) AS revenue,
       SUM(CASE WHEN final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count
     FROM db_masmis.neemans_sale_raw
     WHERE ${SALE_DATE_EXPR} IS NOT NULL${f.sql}
     GROUP BY ${SALE_DATE_EXPR} ORDER BY d ASC`,
    f.params,
  );

  const paymentP = db.execute<RowDataPacket[]>(
    `SELECT payment_status, COUNT(DISTINCT NULLIF(order_id, '')) AS n, SUM(amount) AS revenue
     FROM db_masmis.neemans_sale_raw
     WHERE payment_status IS NOT NULL AND payment_status != ''${f.sql}
     GROUP BY payment_status ORDER BY n DESC`,
    f.params,
  );

  const tlP = db.execute<RowDataPacket[]>(
    `SELECT tl AS tl_name, COUNT(DISTINCT NULLIF(order_id, '')) AS sale_count, SUM(amount) AS revenue,
       SUM(CASE WHEN final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count
     FROM db_masmis.neemans_sale_raw
     WHERE tl IS NOT NULL AND tl != ''${f.sql}
     GROUP BY tl ORDER BY revenue DESC`,
    f.params,
  );

  const orderStatusP = db.execute<RowDataPacket[]>(
    `SELECT current_status, COUNT(DISTINCT NULLIF(order_id, '')) AS n, SUM(amount) AS revenue
     FROM db_masmis.neemans_sale_raw
     WHERE current_status IS NOT NULL AND current_status != ''${f.sql}
     GROUP BY current_status ORDER BY n DESC`,
    f.params,
  );

  const agentP = db.execute<RowDataPacket[]>(
    `SELECT emp_id, MAX(name) AS name, MAX(tl) AS tl_name,
       COUNT(DISTINCT NULLIF(order_id, '')) AS sale_count, SUM(amount) AS revenue,
       SUM(CASE WHEN final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count,
       SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS prepaid_count
     FROM db_masmis.neemans_sale_raw
     WHERE emp_id IS NOT NULL AND emp_id != ''${f.sql}
     GROUP BY emp_id ORDER BY revenue DESC`,
    f.params,
  );

  const [[[headlineRow]], [rosterRows], [trendRows], [paymentRows], [tlRows], [agentRows], [orderStatusRows]] = await Promise.all([
    headlineP, rosterP, trendP, paymentP, tlP, agentP, orderStatusP,
  ]);

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
    orderStatusBreakdown: orderStatusRows.map((r) => ({
      status: String(r.current_status), count: num(r.n), revenue: num(r.revenue), pct: pct(num(r.n), saleCount),
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

async function getAllocationData(from?: string, to?: string): Promise<NeemansAllocationData> {
  const f = dateFilter(ALLOC_DATE_EXPR, from, to);

  const headlineP = db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN calling_status = 'Connected' THEN 1 ELSE 0 END) AS connected,
       SUM(CASE WHEN calling_status = 'Not Connected' THEN 1 ELSE 0 END) AS not_connected,
       SUM(CASE WHEN calling_status = 'Pending to call' THEN 1 ELSE 0 END) AS pending,
       COUNT(DISTINCT NULLIF(phone, '')) AS unique_phones,
       COUNT(DISTINCT CASE WHEN agent NOT IN ('', 'VDAD') THEN agent END) AS active_agents -- VDAD = auto-dialer, not an agent
     FROM db_masmis.neemans_allocation WHERE 1=1${f.sql}`,
    f.params,
  );
  const typeP = db.execute<RowDataPacket[]>(
    `SELECT type, COUNT(*) AS n, SUM(CASE WHEN calling_status = 'Connected' THEN 1 ELSE 0 END) AS connected
     FROM db_masmis.neemans_allocation WHERE type IS NOT NULL AND type != ''${f.sql}
     GROUP BY type ORDER BY n DESC`,
    f.params,
  );
  const statusP = db.execute<RowDataPacket[]>(
    `SELECT calling_status, COUNT(*) AS n
     FROM db_masmis.neemans_allocation WHERE calling_status IS NOT NULL AND calling_status != ''${f.sql}
     GROUP BY calling_status ORDER BY n DESC`,
    f.params,
  );
  const subScenarioP = db.execute<RowDataPacket[]>(
    `SELECT sub_scenario1, COUNT(*) AS n
     FROM db_masmis.neemans_allocation WHERE sub_scenario1 IS NOT NULL AND sub_scenario1 != '' AND sub_scenario1 != '-'${f.sql}
     GROUP BY sub_scenario1 ORDER BY n DESC LIMIT 20`,
    f.params,
  );
  const trendP = db.execute<RowDataPacket[]>(
    `SELECT ${ALLOC_DATE_EXPR} AS d, COUNT(*) AS n,
       SUM(CASE WHEN calling_status = 'Connected' THEN 1 ELSE 0 END) AS connected
     FROM db_masmis.neemans_allocation
     WHERE ${ALLOC_DATE_EXPR} IS NOT NULL${f.sql}
     GROUP BY ${ALLOC_DATE_EXPR} ORDER BY d ASC`,
    f.params,
  );
  const agentP = db.execute<RowDataPacket[]>(
    `SELECT agent, COUNT(*) AS n, SUM(CASE WHEN calling_status = 'Connected' THEN 1 ELSE 0 END) AS connected
     FROM db_masmis.neemans_allocation WHERE agent IS NOT NULL AND agent != ''${f.sql}
     GROUP BY agent ORDER BY n DESC LIMIT 100`,
    f.params,
  );

  const [[[headlineRow]], [typeRows], [statusRows], [subScenarioRows], [trendRows], [agentRows]] = await Promise.all([
    headlineP, typeP, statusP, subScenarioP, trendP, agentP,
  ]);

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
    subScenarioBreakdown: subScenarioRows.map((r) => ({ subScenario: String(r.sub_scenario1), count: num(r.n), pct: pct(num(r.n), total) })),
    dateWiseTrend: trendRows.map((r) => ({
      date: String(r.d), allocationCount: num(r.n), connectedPct: pct(num(r.connected), num(r.n)),
    })),
    agents: agentRows.map((r) => ({ agent: String(r.agent), allocation: num(r.n), connected: num(r.connected), connectedPct: pct(num(r.connected), num(r.n)) })),
  };
}

export async function getChatData(from?: string, to?: string): Promise<NeemansChatData> {
  const f = dateFilter(CHAT_DATE_EXPR, from, to);

  const headlineP = db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN is_resolved = '1' THEN 1 ELSE 0 END) AS resolved,
       AVG(NULLIF(frt, '') + 0) AS avg_frt,
       AVG(NULLIF(resolution_time, '') + 0) AS avg_resolution,
       AVG(NULLIF(NULLIF(csat_rating, ''), '0') + 0) AS avg_csat, -- '0' = not rated, not a rating of zero
       SUM(CASE WHEN frt_tat = 'IN TAT' THEN 1 ELSE 0 END) AS frt_in_tat,
       SUM(CASE WHEN frt_tat IS NOT NULL AND frt_tat != '' THEN 1 ELSE 0 END) AS frt_tat_known,
       SUM(CASE WHEN resolution_tat = 'IN TAT' THEN 1 ELSE 0 END) AS resolution_in_tat,
       SUM(CASE WHEN resolution_tat IS NOT NULL AND resolution_tat != '' THEN 1 ELSE 0 END) AS resolution_tat_known
     FROM db_masmis.neemans_chat WHERE 1=1${f.sql}`,
    f.params,
  );
  const lobP = db.execute<RowDataPacket[]>(
    `SELECT lob, COUNT(*) AS n, SUM(CASE WHEN is_resolved = '1' THEN 1 ELSE 0 END) AS resolved
     FROM db_masmis.neemans_chat WHERE lob IS NOT NULL AND lob != ''${f.sql}
     GROUP BY lob ORDER BY n DESC`,
    f.params,
  );
  const statusP = db.execute<RowDataPacket[]>(
    `SELECT ticket_status, COUNT(*) AS n
     FROM db_masmis.neemans_chat WHERE ticket_status IS NOT NULL AND ticket_status != ''${f.sql}
     GROUP BY ticket_status ORDER BY n DESC`,
    f.params,
  );
  const channelP = db.execute<RowDataPacket[]>(
    `SELECT inbox_name, COUNT(*) AS n, SUM(CASE WHEN is_resolved = '1' THEN 1 ELSE 0 END) AS resolved
     FROM db_masmis.neemans_chat WHERE inbox_name IS NOT NULL AND inbox_name != ''${f.sql}
     GROUP BY inbox_name ORDER BY n DESC`,
    f.params,
  );
  const trendP = db.execute<RowDataPacket[]>(
    `SELECT ${CHAT_DATE_EXPR} AS d, COUNT(*) AS n,
       SUM(CASE WHEN is_resolved = '1' THEN 1 ELSE 0 END) AS resolved
     FROM db_masmis.neemans_chat
     WHERE ${CHAT_DATE_EXPR} IS NOT NULL${f.sql}
     GROUP BY ${CHAT_DATE_EXPR} ORDER BY d ASC`,
    f.params,
  );
  const agentP = db.execute<RowDataPacket[]>(
    `SELECT agent_name, emp_id, COUNT(*) AS n,
       SUM(CASE WHEN is_resolved = '1' THEN 1 ELSE 0 END) AS resolved,
       AVG(NULLIF(NULLIF(csat_rating, ''), '0') + 0) AS avg_csat
     FROM db_masmis.neemans_chat WHERE agent_name IS NOT NULL AND agent_name != ''${f.sql}
     GROUP BY agent_name, emp_id ORDER BY n DESC LIMIT 100`,
    f.params,
  );

  const [[[headlineRow]], [lobRows], [statusRows], [channelRows], [trendRows], [agentRows]] = await Promise.all([
    headlineP, lobP, statusP, channelP, trendP, agentP,
  ]);

  const total = num(headlineRow?.total);
  return {
    headline: {
      totalTickets: total,
      resolvedPct: pct(num(headlineRow?.resolved), total),
      avgFrtHrs: Math.round(num(headlineRow?.avg_frt) * 100) / 100,
      avgResolutionHrs: Math.round(num(headlineRow?.avg_resolution) * 100) / 100,
      avgCsat: Math.round(num(headlineRow?.avg_csat) * 100) / 100,
      frtTatCompliancePct: pct(num(headlineRow?.frt_in_tat), num(headlineRow?.frt_tat_known)),
      resolutionTatCompliancePct: pct(num(headlineRow?.resolution_in_tat), num(headlineRow?.resolution_tat_known)),
    },
    byLob: lobRows.map((r) => ({ lob: String(r.lob), tickets: num(r.n), resolvedPct: pct(num(r.resolved), num(r.n)) })),
    channelBreakdown: channelRows.map((r) => ({ channel: String(r.inbox_name), tickets: num(r.n), resolvedPct: pct(num(r.resolved), num(r.n)) })),
    statusBreakdown: statusRows.map((r) => ({ status: String(r.ticket_status), count: num(r.n), pct: pct(num(r.n), total) })),
    dateWiseTrend: trendRows.map((r) => ({ date: String(r.d), tickets: num(r.n), resolvedPct: pct(num(r.resolved), num(r.n)) })),
    agents: agentRows.map((r) => ({
      agent: String(r.agent_name), empId: String(r.emp_id || ""), tickets: num(r.n),
      resolvedPct: pct(num(r.resolved), num(r.n)), avgCsat: Math.round(num(r.avg_csat) * 100) / 100,
    })),
  };
}

async function getProductivityData(from?: string, to?: string): Promise<NeemansProductivityData> {
  const f = dateFilter(SALE_DATE_EXPR, from, to);

  const headlineP = db.execute<RowDataPacket[]>(
    `SELECT SUM(calls) AS total_calls, COUNT(DISTINCT NULLIF(emp_id, '')) AS active_agents,
       AVG(NULLIF(occu_pct, '') + 0) AS avg_occupancy, SUM(attendance) AS attendance_days,
       AVG(CASE WHEN net_login REGEXP '^[0-9]{1,3}:[0-9]{2}:[0-9]{2}$' THEN TIME_TO_SEC(net_login) END) AS avg_net_login_sec,
       AVG(CASE WHEN total_break REGEXP '^[0-9]{1,3}:[0-9]{2}:[0-9]{2}$' THEN TIME_TO_SEC(total_break) END) AS avg_total_break_sec
     FROM db_masmis.neemans_apr WHERE 1=1${f.sql}`,
    f.params,
  );
  const trendP = db.execute<RowDataPacket[]>(
    `SELECT ${SALE_DATE_EXPR} AS d, SUM(calls) AS calls,
       AVG(NULLIF(occu_pct, '') + 0) AS avg_occupancy, COUNT(DISTINCT NULLIF(emp_id, '')) AS login_agents
     FROM db_masmis.neemans_apr
     WHERE ${SALE_DATE_EXPR} IS NOT NULL${f.sql}
     GROUP BY ${SALE_DATE_EXPR} ORDER BY d ASC`,
    f.params,
  );
  const agentP = db.execute<RowDataPacket[]>(
    `SELECT emp_id, MAX(emp_name) AS emp_name, SUM(calls) AS calls,
       GROUP_CONCAT(login_time SEPARATOR '|') AS login_times,
       GROUP_CONCAT(talk SEPARATOR '|') AS talk_times,
       AVG(NULLIF(occu_pct, '') + 0) AS avg_occupancy, SUM(attendance) AS attendance_days
     FROM db_masmis.neemans_apr WHERE emp_id IS NOT NULL AND emp_id != ''${f.sql}
     GROUP BY emp_id ORDER BY calls DESC LIMIT 100`,
    f.params,
  );
  const lobP = db.execute<RowDataPacket[]>(
    `SELECT lob, SUM(calls) AS calls, COUNT(DISTINCT NULLIF(emp_id, '')) AS agents,
       AVG(NULLIF(occu_pct, '') + 0) AS avg_occupancy
     FROM db_masmis.neemans_apr WHERE lob IS NOT NULL AND lob != ''${f.sql}
     GROUP BY lob ORDER BY calls DESC`,
    f.params,
  );

  const [[[headlineRow]], [trendRows], [rawAgentRows], [lobRows]] = await Promise.all([headlineP, trendP, agentP, lobP]);

  return {
    headline: {
      totalCalls: num(headlineRow?.total_calls),
      activeAgents: num(headlineRow?.active_agents),
      avgOccupancyPct: Math.round(num(headlineRow?.avg_occupancy) * 100) / 100,
      attendanceDays: num(headlineRow?.attendance_days),
      avgNetLoginSec: Math.round(num(headlineRow?.avg_net_login_sec)),
      avgTotalBreakSec: Math.round(num(headlineRow?.avg_total_break_sec)),
    },
    dateWiseTrend: trendRows.map((r) => ({
      date: String(r.d), calls: num(r.calls), avgOccupancyPct: Math.round(num(r.avg_occupancy) * 100) / 100, loginAgents: num(r.login_agents),
    })),
    lobBreakdown: lobRows.map((r) => ({
      lob: String(r.lob), calls: num(r.calls), agents: num(r.agents), avgOccupancyPct: Math.round(num(r.avg_occupancy) * 100) / 100,
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

async function getInboundOverview(from: string, to: string): Promise<NeemansInboundOverview> {
  const { summary: s, trend: daily } = await getProjectOverview({ startDate: from, endDate: to }, "neemans");

  return {
    headline: {
      offered: num(s?.total),
      answered: num(s?.answered),
      abandoned: num(s?.abandoned),
      answerPct: num(s?.ans_pct),
      abandonPct: num(s?.abandon_pct),
      slPct: num(s?.sl_pct),
      ahtSec: num(s?.avg_handle),
      loginCount: num(s?.login_count),
      uniquePhones: num(s?.unique_phones),
      fcrPct: s?.fcr_pct === null || s?.fcr_pct === undefined ? null : num(s.fcr_pct),
    },
    dateWiseTrend: daily
      .map((r) => ({
        date: String(r.date),
        offered: num(r.offered),
        answered: num(r.answered),
        slPct: pct(num(r.sl_num), num(r.answered)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export async function getNeemansPerformanceDashboard(from?: string, to?: string): Promise<NeemansPerformanceDashboardData> {
  const validFrom = from && DATE_RE.test(from) ? from : null;
  const validTo = to && DATE_RE.test(to) ? to : null;
  const range = validFrom && validTo ? [validFrom, validTo] as const : [undefined, undefined] as const;
  const concrete = validFrom && validTo ? { from: validFrom, to: validTo } : currentMonthRange();

  const [sale, allocation, chat, productivity, cartFull, inboundResult] = await Promise.all([
    getSaleData(...range), getAllocationData(...range), getChatData(...range), getProductivityData(...range),
    getNeemansCartDashboard(concrete.from, concrete.to, { skipRecords: true }),
    getInboundOverview(concrete.from, concrete.to).then(
      (value) => ({ ok: true as const, value }),
      (err: unknown) => {
        console.error("[neemans-performance-dashboard] inbound overview failed:", err);
        return { ok: false as const };
      },
    ),
  ]);

  const cart: NeemansCartOverview = {
    headline: cartFull.headline,
    dateWiseTrend: cartFull.dateWiseTrend,
    dispositionBreakdown: cartFull.dispositionBreakdown,
    statusBreakdown: cartFull.statusBreakdown,
  };

  const overview: NeemansOverviewHeadline = {
    saleRevenue: sale.headline.revenue,
    saleCount: sale.headline.saleCount,
    rtoPct: sale.headline.rtoPct,
    totalAllocation: allocation.headline.totalAllocation,
    allocationConnectedPct: allocation.headline.connectedPct,
    totalChatTickets: chat.headline.totalTickets,
    chatResolvedPct: chat.headline.resolvedPct,
    avgOccupancyPct: productivity.headline.avgOccupancyPct,
    conversionPct: pct(sale.headline.saleCount, allocation.headline.totalAllocation),
  };

  return {
    from: validFrom, to: validTo, overview, sale, allocation, chat, productivity, cart,
    inbound: inboundResult.ok ? inboundResult.value : null,
    inboundError: inboundResult.ok ? null : "Inbound call data (dialer_db) is temporarily unavailable.",
  };
}
