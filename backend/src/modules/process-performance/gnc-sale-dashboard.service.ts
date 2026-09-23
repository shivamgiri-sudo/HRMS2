import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Real KPI aggregates for GNC's Process Performance V2 "Sale Performance"
 * dashboard, computed live from db_masmis.gnc_sale/gnc_allocation/gnc_apr --
 * the exact tables the GNC uploaders (Sale/APR/Allocation/Chat) write into.
 * KPI/layout choice was inspired by the reference Excel the user supplied
 * (GNC_Overall_Sale_Performance_Dashboard), but none of that file's own
 * numbers are used -- only this app's own uploaded data.
 *
 * Two KPIs from that reference file are deliberately omitted, same rule
 * already applied to Bellavita's sibling dashboard:
 * - "Ach%" (achievement vs mandate): no GNC target/mandate table exists
 *   anywhere in this app (unlike Neemans' NEEMANS_MONTH_TARGET_MASMIS).
 *   gnc_sale.target is a sparse per-row int (1,399/2,572 rows) whose real
 *   meaning was never confirmed against a verified source -- showing an
 *   "Ach%" built on it would be fabricating a number.
 * - "RTO%" / state-wise revenue: db_masmis.gnc_sale has no RTO/final-status
 *   or state column at all (confirmed via SHOW COLUMNS + live distinct-value
 *   probe: `status` holds fulfillment-provider names 'Zecpe'/'Shopify'/'-',
 *   not a delivery outcome). Replaced with campaign-wise and TL-wise
 *   revenue instead, both real populated columns.
 *
 * Confirmed live 2026-09-16: gnc_sale has 2,572 real rows (2026-04-30 ..
 * 2026-09-14), gnc_allocation has 60,383 rows, gnc_apr has 1,181 rows
 * across 39 distinct agents.
 *
 * agentPerformance's DOJ/Tenure/Bucket/Attendance columns (added per user
 * request, mirroring the reference Excel's "LOB&Agent Wise Sale Made Perf"
 * sheet) are backed by real data this app already owns, NOT the reference
 * file: DOJ from mas_hrms.employees.date_of_joining (all 32 real GNC sale
 * agents matched a real employee row, confirmed live), Tenure/Bucket
 * computed from that DOJ, Attendance from db_masmis.gnc_apr.atten (a real
 * daily 0/1 flag). "Target"/"Achv%"/"TQ/MQ/BQ" and every RTO-related column
 * from that same reference sheet are deliberately NOT reproduced here --
 * same reasoning as the headline KPIs above: gnc_sale.target was checked
 * live and is NOT a per-agent monthly quota (it varies row-to-row, even
 * within the same agent, and the same value is shared across up to 14
 * different agents) -- it does not match the reference sheet's Target
 * column semantics, and no other GNC target/mandate table exists anywhere
 * in this app.
 */

export interface GncSaleDashboardData {
  headline: {
    turnover: number;
    saleCount: number;
    prepaidPct: number;
    codPct: number;
    aov: number;
    activeAgents: number;
    totalAllocation: number;
    sameDayConnectedPct: number;
  };
  /** Total Allocation -> Attempted -> Connected -> Same Day Connected -> Sale,
   * all from db_masmis.gnc_allocation (calling_status/same_day_connect) and
   * gnc_sale. Attempted/Connected are dialer row counts, not deduplicated by
   * customer -- gnc_allocation has no natural customer key confirmed reliable
   * enough to dedupe on, so this stays row-level rather than claiming a
   * "unique" figure it can't back up. Sale is Abandon Cart's own sale count
   * (gnc_allocation is cart-calling data only), NOT the overall sale count --
   * using the overall figure would mix in Chat/Inbound sales this funnel's
   * earlier stages have nothing to do with. */
  funnel: Array<{ stage: string; count: number; pctOfBase: number }>;
  from: string;
  to: string;
  dateWiseTrend: Array<{
    date: string;
    saleCount: number;
    turnover: number;
    prepaidCount: number;
    codCount: number;
  }>;
  campaignRevenue: Array<{
    campaign: string;
    saleCount: number;
    codCount: number;
    paidCount: number;
    codPct: number;
    paidPct: number;
    turnover: number;
    /** Abandon Cart: Sale Count / Total Allocation (Connected + Not
     * Connected, excluding pending-to-call), from db_masmis.gnc_allocation.
     * Chat: Sale Count / Total chat tickets, from db_masmis.gnc_chat.
     * Inbound has no addressable-contact table in this app (no allocation/
     * ticket source), so it shows null rather than a fabricated ratio. */
    conversionPct: number | null;
  }>;
  tlRevenue: Array<{ tl: string; saleCount: number; turnover: number }>;
  topPerformers: Array<{
    empId: string;
    empName: string;
    tl: string;
    campaign: string;
    saleCount: number;
    turnover: number;
    prepaidPct: number;
  }>;
  allocationStatus: Array<{ status: string; count: number; pct: number }>;
  /** Ordered by total turnover desc -- drives the date-wise breakdown table's column order. */
  campaigns: string[];
  dateWiseBreakdown: Array<{
    date: string;
    byCampaign: Record<string, {
      codSaleCount: number; codAmount: number;
      paidSaleCount: number; paidAmount: number;
      totalSaleCount: number; totalAmount: number;
    }>;
    totalSaleCount: number;
    totalAmount: number;
  }>;
  agentPerformance: Array<{
    empId: string;
    empName: string;
    doj: string | null;
    tenureDays: number | null;
    bucket: string;
    tl: string;
    lob: string;
    saleCount: number;
    codCount: number;
    paidCount: number;
    codPct: number;
    paidPct: number;
    revenue: number;
    attendanceDays: number;
  }>;
}

interface HeadlineRow extends RowDataPacket {
  turnover: string | null;
  sale_count: number;
  prepaid_count: number;
  cod_count: number;
}
interface ActiveAgentsRow extends RowDataPacket {
  active_agents: number;
}
interface AllocationHeadlineRow extends RowDataPacket {
  total_allocation: number;
  connected_count: number;
  attempted_count: number;
  dial_connected_count: number;
}
interface TrendRow extends RowDataPacket {
  d: string;
  sale_count: number;
  turnover: string | null;
  prepaid_count: number;
  cod_count: number;
}
interface CampaignRow extends RowDataPacket {
  campaign: string | null;
  sale_count: number;
  cod_count: number;
  paid_count: number;
  turnover: string | null;
}
interface DateCampaignRow extends RowDataPacket {
  d: string;
  campaign: string;
  cod_sale_count: number;
  cod_amount: string | null;
  paid_sale_count: number;
  paid_amount: string | null;
  total_sale_count: number;
  total_amount: string | null;
}
interface AgentSaleRow extends RowDataPacket {
  emp_id: string;
  emp_name: string | null;
  tl: string | null;
  campaign: string | null;
  sale_count: number;
  cod_count: number;
  paid_count: number;
  turnover: string | null;
}
interface EmployeeRow extends RowDataPacket {
  employee_code: string;
  first_name: string | null;
  last_name: string | null;
  date_of_joining: string;
}
interface AttendanceRow extends RowDataPacket {
  emp_id: string;
  attendance_days: string | null;
}
interface TlRow extends RowDataPacket {
  tl: string | null;
  sale_count: number;
  turnover: string | null;
}
interface PerformerRow extends RowDataPacket {
  emp_id: string;
  emp_name: string | null;
  tl: string | null;
  campaign: string | null;
  sale_count: number;
  turnover: string | null;
  prepaid_count: number;
}
interface AllocationStatusRow extends RowDataPacket {
  calling_status: string | null;
  n: number;
}

const num = (v: string | number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);

/** Same ladder the reference Excel's own "Bucket" column uses (0-30 / 31-60
 * / 61-90 / 91-120 / 121-180 / 180 Above), applied to a REAL tenure figure
 * computed from mas_hrms.employees.date_of_joining -- not reproduced from
 * that file's own bucket values. */
function tenureBucket(days: number | null): string {
  if (days === null) return "Unknown";
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  if (days <= 120) return "91-120";
  if (days <= 180) return "121-180";
  return "180 Above";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local YYYY-MM-DD, deliberately NOT via toISOString(): that converts
 * through UTC, and this host's local clock is IST (UTC+5:30) -- midnight
 * on the 1st of the month, converted to UTC, rolls the range back a day.
 * Same bug class already documented for Bellavita's sibling service. */
function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = localDateStr(now);
  return { from, to };
}

export async function getGncSaleDashboard(fromInput: string, toInput: string): Promise<GncSaleDashboardData> {
  const fallback = currentMonthRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  // Upper bound is the day AFTER `to`, so the end date is fully inclusive
  // rather than cutting off at midnight of that day.
  const range = [from, to];

  const [[headlineRow]] = await db.execute<HeadlineRow[]>(
    `SELECT
       SUM(gross_amount) AS turnover,
       COUNT(*) AS sale_count,
       SUM(CASE WHEN payment_status = 'Prepaid' THEN 1 ELSE 0 END) AS prepaid_count,
       SUM(CASE WHEN payment_status = 'COD' THEN 1 ELSE 0 END) AS cod_count
     FROM db_masmis.gnc_sale
     WHERE sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY)`,
    range,
  );

  const [[activeAgentsRow]] = await db.execute<ActiveAgentsRow[]>(
    `SELECT COUNT(DISTINCT emp_id) AS active_agents
     FROM db_masmis.gnc_apr
     WHERE report_date >= ? AND report_date < DATE_ADD(?, INTERVAL 1 DAY)`,
    range,
  );

  const [[allocationHeadlineRow]] = await db.execute<AllocationHeadlineRow[]>(
    `SELECT
       COUNT(*) AS total_allocation,
       SUM(CASE WHEN same_day_connect = 'Connected' THEN 1 ELSE 0 END) AS connected_count,
       SUM(CASE WHEN calling_status != 'pending to call' THEN 1 ELSE 0 END) AS attempted_count,
       SUM(CASE WHEN calling_status = 'Connected' THEN 1 ELSE 0 END) AS dial_connected_count
     FROM db_masmis.gnc_allocation
     WHERE alloc_date >= ? AND alloc_date < DATE_ADD(?, INTERVAL 1 DAY)`,
    range,
  );

  const [trendRows] = await db.execute<TrendRow[]>(
    `SELECT DATE(sale_date) AS d,
       COUNT(*) AS sale_count,
       SUM(gross_amount) AS turnover,
       SUM(CASE WHEN payment_status = 'Prepaid' THEN 1 ELSE 0 END) AS prepaid_count,
       SUM(CASE WHEN payment_status = 'COD' THEN 1 ELSE 0 END) AS cod_count
     FROM db_masmis.gnc_sale
     WHERE sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY DATE(sale_date)
     ORDER BY d ASC`,
    range,
  );

  const [campaignRows] = await db.execute<CampaignRow[]>(
    `SELECT campaign, COUNT(*) AS sale_count,
       SUM(CASE WHEN payment_status = 'COD' THEN 1 ELSE 0 END) AS cod_count,
       SUM(CASE WHEN payment_status = 'Prepaid' THEN 1 ELSE 0 END) AS paid_count,
       SUM(gross_amount) AS turnover
     FROM db_masmis.gnc_sale
     WHERE sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY) AND campaign IS NOT NULL AND campaign != ''
     GROUP BY campaign
     ORDER BY turnover DESC`,
    range,
  );

  const [tlRows] = await db.execute<TlRow[]>(
    `SELECT tl, COUNT(*) AS sale_count, SUM(gross_amount) AS turnover
     FROM db_masmis.gnc_sale
     WHERE sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY) AND tl IS NOT NULL AND tl != ''
     GROUP BY tl
     ORDER BY turnover DESC`,
    range,
  );

  const [performerRows] = await db.execute<PerformerRow[]>(
    `SELECT emp_id, MAX(emp_name) AS emp_name, MAX(tl) AS tl, MAX(campaign) AS campaign,
       COUNT(*) AS sale_count, SUM(gross_amount) AS turnover,
       SUM(CASE WHEN payment_status = 'Prepaid' THEN 1 ELSE 0 END) AS prepaid_count
     FROM db_masmis.gnc_sale
     WHERE sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY) AND emp_id IS NOT NULL AND emp_id != ''
     GROUP BY emp_id
     ORDER BY turnover DESC
     LIMIT 5`,
    range,
  );

  // Abandon Cart's own Connected + Not Connected allocation total (excludes
  // "pending to call", which is neither connected nor not-connected) -- the
  // denominator for Abandon Cart's Conversion %, per gnc_allocation being
  // cart-calling data only (no campaign split, so this can't be computed
  // for any other LOB).
  const [[cartConnectRow]] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN LOWER(TRIM(calling_status)) = 'connected' THEN 1 ELSE 0 END) AS connected,
       SUM(CASE WHEN LOWER(TRIM(calling_status)) = 'not connected' THEN 1 ELSE 0 END) AS not_connected
     FROM db_masmis.gnc_allocation
     WHERE alloc_date >= ? AND alloc_date < DATE_ADD(?, INTERVAL 1 DAY)`,
    range,
  );
  const cartAllocationTotal = num(cartConnectRow?.connected) + num(cartConnectRow?.not_connected);

  // Chat's own denominator: total chat tickets handled in the range, from
  // db_masmis.gnc_chat (the GNC Chat uploader's destination table). Its
  // own "is_checkout_created" flag is unusable for this -- confirmed live
  // 2026-09-22 that all 6,019 rows in the table hold the literal string
  // 'FALSE', including rows that have a real order_id -- so ticket COUNT(*)
  // is used as the denominator instead, same structural idea as Abandon
  // Cart's Connected+Not Connected total. report_date is stored as text
  // ("1-Sep-26"), parsed with STR_TO_DATE to match the ISO `range`.
  const [[chatTicketRow]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total_tickets
     FROM db_masmis.gnc_chat
     WHERE STR_TO_DATE(report_date, '%e-%b-%y') >= ?
       AND STR_TO_DATE(report_date, '%e-%b-%y') < DATE_ADD(?, INTERVAL 1 DAY)`,
    range,
  );
  const chatTicketTotal = num(chatTicketRow?.total_tickets);

  const [allocationStatusRows] = await db.execute<AllocationStatusRow[]>(
    `SELECT calling_status, COUNT(*) AS n
     FROM db_masmis.gnc_allocation
     WHERE alloc_date >= ? AND alloc_date < DATE_ADD(?, INTERVAL 1 DAY) AND calling_status IS NOT NULL AND calling_status != ''
     GROUP BY calling_status
     ORDER BY n DESC`,
    range,
  );

  const [dateCampaignRows] = await db.execute<DateCampaignRow[]>(
    `SELECT DATE(sale_date) AS d, campaign,
       SUM(CASE WHEN payment_status = 'COD' THEN 1 ELSE 0 END) AS cod_sale_count,
       SUM(CASE WHEN payment_status = 'COD' THEN gross_amount ELSE 0 END) AS cod_amount,
       SUM(CASE WHEN payment_status = 'Prepaid' THEN 1 ELSE 0 END) AS paid_sale_count,
       SUM(CASE WHEN payment_status = 'Prepaid' THEN gross_amount ELSE 0 END) AS paid_amount,
       COUNT(*) AS total_sale_count,
       SUM(gross_amount) AS total_amount
     FROM db_masmis.gnc_sale
     WHERE sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY) AND campaign IS NOT NULL AND campaign != ''
     GROUP BY DATE(sale_date), campaign
     ORDER BY d ASC`,
    range,
  );

  const [agentSaleRows] = await db.execute<AgentSaleRow[]>(
    `SELECT emp_id, MAX(emp_name) AS emp_name, MAX(tl) AS tl, MAX(campaign) AS campaign,
       COUNT(*) AS sale_count,
       SUM(CASE WHEN payment_status = 'COD' THEN 1 ELSE 0 END) AS cod_count,
       SUM(CASE WHEN payment_status = 'Prepaid' THEN 1 ELSE 0 END) AS paid_count,
       SUM(gross_amount) AS turnover
     FROM db_masmis.gnc_sale
     WHERE sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY) AND emp_id IS NOT NULL AND emp_id != ''
     GROUP BY emp_id
     ORDER BY turnover DESC`,
    range,
  );

  // An agent's campaign/LOB is the one they actually sold most in. MAX(campaign)
  // picked alphabetically, so an agent with 66 Abandon Cart sales and 1 Chat
  // sale was shown as "Chat" (Top Performers + Agent-wise LOB column).
  const [agentCampaignRows] = await db.execute<RowDataPacket[]>(
    `SELECT emp_id, campaign, COUNT(*) AS n
     FROM db_masmis.gnc_sale
     WHERE sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY) AND emp_id IS NOT NULL AND emp_id != ''
       AND campaign IS NOT NULL AND campaign != ''
     GROUP BY emp_id, campaign`,
    range,
  );
  const topCampaignByAgent = new Map<string, { campaign: string; n: number }>();
  for (const r of agentCampaignRows) {
    const key = String(r.emp_id);
    const cur = topCampaignByAgent.get(key);
    if (!cur || num(r.n) > cur.n) topCampaignByAgent.set(key, { campaign: String(r.campaign), n: num(r.n) });
  }
  const primaryCampaign = (empId: string, fallback: string | null): string =>
    topCampaignByAgent.get(empId)?.campaign || fallback || "Unknown";

  const agentIds = agentSaleRows.map((r) => r.emp_id);
  let employeeRows: EmployeeRow[] = [];
  let attendanceRows: AttendanceRow[] = [];
  if (agentIds.length > 0) {
    const placeholders = agentIds.map(() => "?").join(",");
    [employeeRows] = await db.execute<EmployeeRow[]>(
      `SELECT employee_code, first_name, last_name, date_of_joining
       FROM mas_hrms.employees WHERE employee_code IN (${placeholders})`,
      agentIds,
    );
    [attendanceRows] = await db.execute<AttendanceRow[]>(
      // Distinct present DAYS: gnc_apr repeats an agent-day when the same APR
      // file is uploaded more than once (1 Sep 2026: 6 agent-days x3), so
      // SUM(atten) reported 13 days for agents who were present on 11.
      `SELECT emp_id, COUNT(DISTINCT CASE WHEN atten > 0 THEN report_date END) AS attendance_days
       FROM db_masmis.gnc_apr
       WHERE report_date >= ? AND report_date < DATE_ADD(?, INTERVAL 1 DAY) AND emp_id IN (${placeholders})
       GROUP BY emp_id`,
      [...range, ...agentIds],
    );
  }
  const employeeByCode = new Map(employeeRows.map((e) => [e.employee_code, e]));
  const attendanceByEmpId = new Map(attendanceRows.map((a) => [a.emp_id, num(a.attendance_days)]));

  const turnover = num(headlineRow?.turnover);
  const saleCount = num(headlineRow?.sale_count);
  const prepaidCount = num(headlineRow?.prepaid_count);
  const codCount = num(headlineRow?.cod_count);
  const totalAllocation = num(allocationHeadlineRow?.total_allocation);
  const connectedCount = num(allocationHeadlineRow?.connected_count);
  const attemptedCount = num(allocationHeadlineRow?.attempted_count);
  const dialConnectedCount = num(allocationHeadlineRow?.dial_connected_count);
  // gnc_allocation is Abandon-Cart-only data (cart-calling), so the funnel's
  // final "Sale" stage must be Abandon Cart's own sale count, not the overall
  // `saleCount` (which also includes Chat/Inbound sales and would overstate
  // this funnel's true conversion rate).
  const cartSaleCount = num(campaignRows.find((r) => r.campaign === "Abandon Cart")?.sale_count);

  return {
    headline: {
      turnover,
      saleCount,
      prepaidPct: pct(prepaidCount, saleCount),
      codPct: pct(codCount, saleCount),
      aov: saleCount > 0 ? Math.round((turnover / saleCount) * 100) / 100 : 0,
      activeAgents: num(activeAgentsRow?.active_agents),
      totalAllocation,
      sameDayConnectedPct: pct(connectedCount, totalAllocation),
    },
    funnel: [
      { stage: "Total Allocation", count: totalAllocation, pctOfBase: 100 },
      { stage: "Attempted", count: attemptedCount, pctOfBase: pct(attemptedCount, totalAllocation) },
      { stage: "Connected", count: dialConnectedCount, pctOfBase: pct(dialConnectedCount, totalAllocation) },
      { stage: "Same Day Connected", count: connectedCount, pctOfBase: pct(connectedCount, totalAllocation) },
      { stage: "Sale", count: cartSaleCount, pctOfBase: pct(cartSaleCount, totalAllocation) },
    ],
    from,
    to,
    dateWiseTrend: trendRows.map((r) => ({
      date: String(r.d),
      saleCount: num(r.sale_count),
      turnover: num(r.turnover),
      prepaidCount: num(r.prepaid_count),
      codCount: num(r.cod_count),
    })),
    campaignRevenue: campaignRows.map((r) => ({
      campaign: r.campaign || "Unknown",
      saleCount: num(r.sale_count),
      codCount: num(r.cod_count),
      paidCount: num(r.paid_count),
      codPct: pct(num(r.cod_count), num(r.sale_count)),
      paidPct: pct(num(r.paid_count), num(r.sale_count)),
      turnover: num(r.turnover),
      conversionPct: (r.campaign === "Abandon Cart" && cartAllocationTotal > 0)
        ? pct(num(r.sale_count), cartAllocationTotal)
        : (r.campaign === "Chat" && chatTicketTotal > 0)
          ? pct(num(r.sale_count), chatTicketTotal)
          : null,
    })),
    tlRevenue: tlRows.map((r) => ({
      tl: r.tl || "Unknown",
      saleCount: num(r.sale_count),
      turnover: num(r.turnover),
    })),
    topPerformers: performerRows.map((r) => ({
      empId: r.emp_id,
      empName: r.emp_name || r.emp_id,
      tl: r.tl || "Unknown",
      campaign: primaryCampaign(r.emp_id, r.campaign),
      saleCount: num(r.sale_count),
      turnover: num(r.turnover),
      prepaidPct: pct(num(r.prepaid_count), num(r.sale_count)),
    })),
    allocationStatus: allocationStatusRows.map((r) => ({
      status: r.calling_status || "Unknown",
      count: num(r.n),
      pct: pct(num(r.n), totalAllocation),
    })),
    campaigns: campaignRows.map((r) => r.campaign || "Unknown"),
    dateWiseBreakdown: buildDateWiseBreakdown(dateCampaignRows),
    agentPerformance: agentSaleRows.map((r) => {
      const emp = employeeByCode.get(r.emp_id);
      const empName = (emp && [emp.first_name, emp.last_name].filter(Boolean).join(" ")) || r.emp_name || r.emp_id;
      const doj = emp?.date_of_joining ? String(emp.date_of_joining).slice(0, 10) : null;
      const tenureDays = doj ? Math.floor((Date.now() - new Date(doj).getTime()) / 86400000) : null;
      const saleCount = num(r.sale_count);
      const codCount = num(r.cod_count);
      const paidCount = num(r.paid_count);
      return {
        empId: r.emp_id,
        empName,
        doj,
        tenureDays,
        bucket: tenureBucket(tenureDays),
        tl: r.tl || "Unknown",
        lob: primaryCampaign(r.emp_id, r.campaign),
        saleCount,
        codCount,
        paidCount,
        codPct: pct(codCount, saleCount),
        paidPct: pct(paidCount, saleCount),
        revenue: num(r.turnover),
        attendanceDays: attendanceByEmpId.get(r.emp_id) ?? 0,
      };
    }),
  };
}

export interface GncAgentDetail {
  empId: string;
  empName: string;
  tl: string;
  lob: string;
  doj: string | null;
  tenureDays: number | null;
  bucket: string;
  from: string;
  to: string;
  totals: { saleCount: number; codCount: number; paidCount: number; revenue: number; aov: number };
  daily: Array<{
    date: string; saleCount: number; codCount: number; paidCount: number; revenue: number;
    present: boolean | null;
  }>;
}

interface AgentDayRow extends RowDataPacket {
  d: string;
  sale_count: number;
  cod_count: number;
  paid_count: number;
  turnover: string | null;
}
interface AgentAttendanceDayRow extends RowDataPacket {
  report_date: string;
  atten: number;
}

/** One agent's own day-by-day Sale Made / COD / Paid / Revenue, plus their
 * attendance flag from gnc_apr for each of those days -- the drill-down
 * behind a row click on Agent-wise Performance. Same tables and the same
 * DOJ/tenure/bucket logic getGncSaleDashboard already uses for that agent,
 * just scoped to one emp_id instead of every agent. */
export async function getGncAgentDetail(empId: string, fromInput: string, toInput: string): Promise<GncAgentDetail | null> {
  const fallback = currentMonthRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  const range = [empId, from, to];

  const [[identityRow]] = await db.execute<RowDataPacket[]>(
    `SELECT MAX(emp_name) AS emp_name, MAX(tl) AS tl, MAX(campaign) AS campaign
     FROM db_masmis.gnc_sale WHERE emp_id = ? AND sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY)`,
    range,
  );
  if (!identityRow?.emp_name) return null;

  const [dayRows] = await db.execute<AgentDayRow[]>(
    `SELECT DATE(sale_date) AS d, COUNT(*) AS sale_count,
       SUM(CASE WHEN payment_status = 'COD' THEN 1 ELSE 0 END) AS cod_count,
       SUM(CASE WHEN payment_status = 'Prepaid' THEN 1 ELSE 0 END) AS paid_count,
       SUM(gross_amount) AS turnover
     FROM db_masmis.gnc_sale
     WHERE emp_id = ? AND sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY DATE(sale_date) ORDER BY d ASC`,
    range,
  );

  const [attendanceRows] = await db.execute<AgentAttendanceDayRow[]>(
    `SELECT report_date, MAX(atten) AS atten FROM db_masmis.gnc_apr
     WHERE emp_id = ? AND report_date >= ? AND report_date < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY report_date`,
    range,
  );
  const presentByDate = new Map(attendanceRows.map((r) => [String(r.report_date), num(r.atten) > 0]));

  const [employeeRows] = await db.execute<EmployeeRow[]>(
    `SELECT employee_code, first_name, last_name, date_of_joining FROM mas_hrms.employees WHERE employee_code = ?`,
    [empId],
  );
  const employee = employeeRows[0] ?? null;
  const doj = employee?.date_of_joining ?? null;
  const tenureDays = doj ? Math.floor((Date.now() - new Date(doj).getTime()) / 86400000) : null;

  const daily = dayRows.map((r) => ({
    date: String(r.d), saleCount: num(r.sale_count), codCount: num(r.cod_count), paidCount: num(r.paid_count),
    revenue: num(r.turnover), present: presentByDate.get(String(r.d)) ?? null,
  }));
  const saleCount = daily.reduce((s, d) => s + d.saleCount, 0);
  const codCount = daily.reduce((s, d) => s + d.codCount, 0);
  const paidCount = daily.reduce((s, d) => s + d.paidCount, 0);
  const revenue = daily.reduce((s, d) => s + d.revenue, 0);

  return {
    empId,
    empName: String(identityRow.emp_name),
    tl: String(identityRow.tl ?? "Unassigned"),
    lob: String(identityRow.campaign ?? "Unknown"),
    doj, tenureDays, bucket: tenureBucket(tenureDays),
    from, to,
    totals: { saleCount, codCount, paidCount, revenue, aov: saleCount > 0 ? Math.round((revenue / saleCount) * 100) / 100 : 0 },
    daily,
  };
}

export interface GncCampaignDetail {
  campaign: string;
  from: string;
  to: string;
  totals: {
    saleCount: number; codCount: number; paidCount: number; revenue: number; aov: number;
    /** Same Sale Count / addressable-contacts definition the LOB-wise Summary
     * table's headline conversionPct uses -- null when this LOB has no
     * addressable-contact source in this app (see that field's own comment). */
    conversionPct: number | null;
  };
  daily: Array<{
    date: string; saleCount: number; codCount: number; paidCount: number; revenue: number; conversionPct: number | null;
  }>;
}

interface CampaignDayRow extends RowDataPacket {
  d: string;
  sale_count: number;
  cod_count: number;
  paid_count: number;
  turnover: string | null;
}

/** One LOB's own day-by-day Sale Made / COD / Paid / Revenue / Conversion% --
 * the drill-down behind a row click on the LOB-wise Summary table. Reuses
 * the same campaign===Abandon Cart/Chat denominator logic getGncSaleDashboard
 * uses for the aggregate conversionPct, just grouped by day too. */
export async function getGncCampaignDetail(campaignInput: string, fromInput: string, toInput: string): Promise<GncCampaignDetail | null> {
  const fallback = currentMonthRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  const campaign = campaignInput.trim();
  if (!campaign) return null;

  const [dayRows] = await db.execute<CampaignDayRow[]>(
    `SELECT DATE(sale_date) AS d, COUNT(*) AS sale_count,
       SUM(CASE WHEN payment_status = 'COD' THEN 1 ELSE 0 END) AS cod_count,
       SUM(CASE WHEN payment_status = 'Prepaid' THEN 1 ELSE 0 END) AS paid_count,
       SUM(gross_amount) AS turnover
     FROM db_masmis.gnc_sale
     WHERE campaign = ? AND sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY DATE(sale_date) ORDER BY d ASC`,
    [campaign, from, to],
  );
  if (dayRows.length === 0) return null;

  const denomByDay = new Map<string, number>();
  if (campaign === "Abandon Cart") {
    const [cartRows] = await db.execute<RowDataPacket[]>(
      `SELECT alloc_date AS d,
         SUM(CASE WHEN LOWER(TRIM(calling_status)) = 'connected' THEN 1 ELSE 0 END) AS connected,
         SUM(CASE WHEN LOWER(TRIM(calling_status)) = 'not connected' THEN 1 ELSE 0 END) AS not_connected
       FROM db_masmis.gnc_allocation
       WHERE alloc_date >= ? AND alloc_date < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY alloc_date`,
      [from, to],
    );
    for (const r of cartRows) denomByDay.set(String(r.d), num(r.connected) + num(r.not_connected));
  } else if (campaign === "Chat") {
    const [chatRows] = await db.execute<RowDataPacket[]>(
      `SELECT STR_TO_DATE(report_date, '%e-%b-%y') AS d, COUNT(*) AS n
       FROM db_masmis.gnc_chat
       WHERE STR_TO_DATE(report_date, '%e-%b-%y') >= ? AND STR_TO_DATE(report_date, '%e-%b-%y') < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY STR_TO_DATE(report_date, '%e-%b-%y')`,
      [from, to],
    );
    for (const r of chatRows) denomByDay.set(String(r.d), num(r.n));
  }

  const daily = dayRows.map((r) => {
    const d = String(r.d);
    const saleCount = num(r.sale_count);
    const denom = denomByDay.get(d) ?? 0;
    return {
      date: d, saleCount, codCount: num(r.cod_count), paidCount: num(r.paid_count), revenue: num(r.turnover),
      conversionPct: denom > 0 ? pct(saleCount, denom) : null,
    };
  });
  const saleCount = daily.reduce((s, d) => s + d.saleCount, 0);
  const codCount = daily.reduce((s, d) => s + d.codCount, 0);
  const paidCount = daily.reduce((s, d) => s + d.paidCount, 0);
  const revenue = daily.reduce((s, d) => s + d.revenue, 0);
  const totalDenom = [...denomByDay.values()].reduce((s, v) => s + v, 0);

  return {
    campaign, from, to,
    totals: {
      saleCount, codCount, paidCount, revenue,
      aov: saleCount > 0 ? Math.round((revenue / saleCount) * 100) / 100 : 0,
      conversionPct: totalDenom > 0 ? pct(saleCount, totalDenom) : null,
    },
    daily,
  };
}

function buildDateWiseBreakdown(rows: DateCampaignRow[]): GncSaleDashboardData["dateWiseBreakdown"] {
  const byDate = new Map<string, GncSaleDashboardData["dateWiseBreakdown"][number]>();
  for (const r of rows) {
    const dateKey = String(r.d);
    let entry = byDate.get(dateKey);
    if (!entry) {
      entry = { date: dateKey, byCampaign: {}, totalSaleCount: 0, totalAmount: 0 };
      byDate.set(dateKey, entry);
    }
    const codSaleCount = num(r.cod_sale_count);
    const codAmount = num(r.cod_amount);
    const paidSaleCount = num(r.paid_sale_count);
    const paidAmount = num(r.paid_amount);
    const totalSaleCount = num(r.total_sale_count);
    const totalAmount = num(r.total_amount);
    entry.byCampaign[r.campaign] = { codSaleCount, codAmount, paidSaleCount, paidAmount, totalSaleCount, totalAmount };
    entry.totalSaleCount += totalSaleCount;
    entry.totalAmount += totalAmount;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
