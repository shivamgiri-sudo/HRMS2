import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * GNC Chat dashboard -- live aggregates over db_masmis.gnc_chat (6,019 rows
 * confirmed live 2026-09-21) plus db_masmis.gnc_sale filtered to
 * campaign = 'Chat' for the order/revenue KPIs, via GET
 * /api/process-performance/gnc-chat-dashboard.
 *
 * Built by reverse-engineering the user's own reference workbook
 * (GNC_Chat_Dashboard_Sep'26.xlsb) -- every KPI below reproduces a formula
 * actually found in that file, not a guess:
 *
 * - report_date/unique_flag/frt_in_tat/response_in_tat/qrc are NOT derived
 *   here -- they are already precomputed columns on gnc_chat itself (the
 *   uploader writes them straight from the source file's own "Chat" sheet,
 *   which is the workbook's *authoritative* sheet -- confirmed live: its
 *   header row is column-for-column identical to gnc_chat, and its row
 *   count, 6,018 (+1 header), matches gnc_chat's 6,019 almost exactly).
 *   Their formulas there:
 *     - report_date  = INT(FirstAssignedAt)            [Chat!CA]
 *     - unique_flag  = first occurrence by customer phone number is
 *       "Unique" (COUNTIF over the phone-number column); every later
 *       repeat contact from that number is "Repeat"    [Chat!CB]
 *     - frt_in_tat   = "Out TAT" when (first agent message time of day -
 *       assignment time of day) > 60 SECONDS, else "IN TAT" [Chat!CC]
 *     - response_in_tat = "IN TAT" when CustomerResolutionTime(min) <= 60
 *       MINUTES, else "Out TAT"                          [Chat!CE]
 *     - qrc          = VLOOKUP of the ticket's raw tag against the
 *       workbook's own ~150-row Disposition sheet, collapsed to 6 buckets
 *       (Query / Inactive chat / Inactive sale chat / Request chat /
 *       Escalation / Saleschat)                          [Chat!CD]
 *
 * VALIDATION FINDING (the user explicitly asked every chart/insight to be
 * checked): the workbook's own "Dashboard" sheet mislabels the FRT KPI as
 * "In TAT FRT (With in 10 Sec)" in one block, while its own formula (above)
 * and its own "Date Wise Chat Performance" sheet's column header both use
 * 60 SECONDS. 60 seconds is what frt_in_tat is actually computed from
 * (verified against the "Chat" sheet's live formula), so that is what this
 * dashboard uses -- the "10 Sec" text in the source file is a stale label,
 * not a different rule.
 *
 * SECOND VALIDATION FINDING: the workbook also has an older, unrelated
 * "Chat Raw" sheet (a different, Freshdesk-style export with its own
 * separate FRT/date logic) that a few Dashboard-sheet cells still pull
 * from instead of the "Chat" sheet -- e.g. its own "Total Chat Count" MTD
 * tile reads 6,877 from "Chat Raw" right next to a "6,017" from "Chat" for
 * what a viewer would assume is the same number. "Chat Raw" has no live
 * counterpart in this app (only "Chat" was ever wired to an uploader), so
 * this dashboard is built on "Chat"/gnc_chat only -- the authoritative,
 * currently-uploaded source -- and never on the stale "Chat Raw" figures.
 *
 * THIRD VALIDATION FINDING: agent_name is NULL on all 189 still-queued
 * (never assigned) tickets; first_agent_name is never null. The workbook's
 * own Agent Wise Performance sheet already groups by FirstAgentName for
 * exactly this reason (COUNTIFS(Chat!$I:$I, ...), column I = FirstAgentName),
 * so this service does the same.
 *
 * FOURTH VALIDATION FINDING: gnc_chat has no agent/employee-code column at
 * all (confirmed via SHOW COLUMNS) -- linking a chat agent to their Chat
 * campaign) is name-based, exactly like the workbook, and just as
 * fragile: live names disagree between the two tables for at least two
 * agents -- "Viviek ." (chat) vs "Vivek Kumar" (sale) and "Akash ."
 * (chat) vs "AKASH SHARMA" (sale). Normalizing case/spacing/trailing dots
 * fixes the safe cases (e.g. "TANNU  RATHORE" vs "TANNU RATHORE") but
 * deliberately does NOT force a match across a different surname, since
 * that would be guessing whether two names are the same person. The
 * `saleLinkage` section is kept separate from the main agent table for
 * this reason, with the unmatched names listed explicitly rather than
 * silently dropped or wrongly merged.
 *
 * csat_rating is stored as a bracketed string (e.g. "[5]", and on 2 rows
 * "[1,1]"/"[5,5]") -- confirmed live; parsed by taking the first number
 * inside the brackets.
 */

const CHAT_DATE = `STR_TO_DATE(report_date, '%e-%b-%y')`;
const CSAT_NUM = `CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(csat_rating, '[', -1), ']', 1) AS DECIMAL(4,1))`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface GncChatDashboardData {
  from: string;
  to: string;
  headline: {
    totalChats: number;
    uniqueChats: number;
    repeatChats: number;
    frtInTatPct: number;
    resolutionInTatPct: number;
    orders: number;
    conversionPct: number;
    grossRevenue: number;
    netRevenue: number;
    avgCsat: number;
    csatResponses: number;
  };
  dateWiseTrend: Array<{
    date: string; totalChats: number; uniqueChats: number;
    frtInTatPct: number; resolutionInTatPct: number; orders: number; revenue: number;
  }>;
  qrcBreakdown: Array<{ qrc: string; count: number; pct: number }>;
  channelBreakdown: Array<{ channel: string; count: number; pct: number }>;
  statusBreakdown: Array<{ status: string; count: number; pct: number }>;
  csatBreakdown: Array<{ rating: number; count: number }>;
  tagBreakdown: Array<{ tag: string; count: number }>;
  agents: Array<{
    agent: string; totalChats: number; uniqueChats: number;
    frtInTatPct: number; resolutionInTatPct: number;
  }>;
  saleLinkage: {
    matched: Array<{ agent: string; saleCount: number; revenue: number }>;
    unmatchedSaleNames: Array<{ name: string; saleCount: number; revenue: number }>;
  };
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);

/** Case/spacing/trailing-dot normalization only -- never merges two
 * genuinely different names (see the module header's fourth finding). */
function normalizeAgentName(v: string): string {
  return v.trim().toUpperCase().replace(/\.+$/, "").replace(/\s+/g, " ").trim();
}

function currentMonthRange(): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
}

export async function getGncChatDashboard(fromInput: string, toInput: string): Promise<GncChatDashboardData> {
  const fallback = currentMonthRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  const range = [from, to];

  const [
    [headlineRows], [saleHeadlineRows], [trendRows], [saleTrendRows],
    [qrcRows], [channelRows], [statusRows], [csatRows], [tagRows], [agentRows], [saleAgentRows],
  ] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(unique_flag = 'Unique') AS uniq,
         SUM(unique_flag = 'Repeat') AS rep,
         SUM(frt_in_tat = 'IN TAT') AS frt_in,
         SUM(response_in_tat = 'IN TAT') AS res_in,
         SUM(csat_rating IS NOT NULL AND csat_rating != '') AS csat_n,
         AVG(CASE WHEN csat_rating IS NOT NULL AND csat_rating != '' THEN ${CSAT_NUM} END) AS avg_csat
       FROM db_masmis.gnc_chat
       WHERE ${CHAT_DATE} >= ? AND ${CHAT_DATE} < DATE_ADD(?, INTERVAL 1 DAY)`,
      range,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS orders, SUM(gross_amount) AS gross, SUM(sum_before_gst) AS net
       FROM db_masmis.gnc_sale
       WHERE campaign = 'Chat' AND sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY)`,
      range,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT ${CHAT_DATE} AS d, COUNT(*) AS total, SUM(unique_flag = 'Unique') AS uniq,
         SUM(frt_in_tat = 'IN TAT') AS frt_in, SUM(response_in_tat = 'IN TAT') AS res_in
       FROM db_masmis.gnc_chat
       WHERE ${CHAT_DATE} >= ? AND ${CHAT_DATE} < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY d ORDER BY d`,
      range,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT sale_date AS d, COUNT(*) AS orders, SUM(gross_amount) AS revenue
       FROM db_masmis.gnc_sale
       WHERE campaign = 'Chat' AND sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY d`,
      range,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT qrc, COUNT(*) AS n FROM db_masmis.gnc_chat
       WHERE ${CHAT_DATE} >= ? AND ${CHAT_DATE} < DATE_ADD(?, INTERVAL 1 DAY) AND qrc IS NOT NULL AND qrc != ''
       GROUP BY qrc ORDER BY n DESC`,
      range,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT channel, COUNT(*) AS n FROM db_masmis.gnc_chat
       WHERE ${CHAT_DATE} >= ? AND ${CHAT_DATE} < DATE_ADD(?, INTERVAL 1 DAY) AND channel IS NOT NULL AND channel != ''
       GROUP BY channel ORDER BY n DESC`,
      range,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT ticket_status, COUNT(*) AS n FROM db_masmis.gnc_chat
       WHERE ${CHAT_DATE} >= ? AND ${CHAT_DATE} < DATE_ADD(?, INTERVAL 1 DAY) AND ticket_status IS NOT NULL AND ticket_status != ''
       GROUP BY ticket_status ORDER BY n DESC`,
      range,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT ${CSAT_NUM} AS rating, COUNT(*) AS n FROM db_masmis.gnc_chat
       WHERE ${CHAT_DATE} >= ? AND ${CHAT_DATE} < DATE_ADD(?, INTERVAL 1 DAY) AND csat_rating IS NOT NULL AND csat_rating != ''
       GROUP BY rating ORDER BY rating`,
      range,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT tags, COUNT(*) AS n FROM db_masmis.gnc_chat
       WHERE ${CHAT_DATE} >= ? AND ${CHAT_DATE} < DATE_ADD(?, INTERVAL 1 DAY) AND tags IS NOT NULL AND tags != ''
       GROUP BY tags ORDER BY n DESC LIMIT 15`,
      range,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT first_agent_name AS agent, COUNT(*) AS total, SUM(unique_flag = 'Unique') AS uniq,
         SUM(frt_in_tat = 'IN TAT') AS frt_in, SUM(response_in_tat = 'IN TAT') AS res_in
       FROM db_masmis.gnc_chat
       WHERE ${CHAT_DATE} >= ? AND ${CHAT_DATE} < DATE_ADD(?, INTERVAL 1 DAY) AND first_agent_name IS NOT NULL AND first_agent_name != ''
       GROUP BY first_agent_name ORDER BY total DESC`,
      range,
    ),
    db.execute<RowDataPacket[]>(
      `SELECT emp_name, COUNT(*) AS n, SUM(gross_amount) AS revenue
       FROM db_masmis.gnc_sale
       WHERE campaign = 'Chat' AND sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY)
         AND emp_name IS NOT NULL AND emp_name != ''
       GROUP BY emp_name ORDER BY revenue DESC`,
      range,
    ),
  ]);

  const h = headlineRows[0];
  const sh = saleHeadlineRows[0];
  const totalChats = num(h?.total);
  const uniqueChats = num(h?.uniq);
  const orders = num(sh?.orders);

  const revenueByDay = new Map<string, { orders: number; revenue: number }>();
  for (const r of saleTrendRows) revenueByDay.set(String(r.d), { orders: num(r.orders), revenue: num(r.revenue) });

  const agentNameSet = new Set(agentRows.map((r) => normalizeAgentName(String(r.agent))));
  const matched: GncChatDashboardData["saleLinkage"]["matched"] = [];
  const unmatchedSaleNames: GncChatDashboardData["saleLinkage"]["unmatchedSaleNames"] = [];
  const saleByNormalizedName = new Map<string, { agent: string; saleCount: number; revenue: number }>();
  for (const r of saleAgentRows) {
    const rawName = String(r.emp_name);
    const key = normalizeAgentName(rawName);
    if (agentNameSet.has(key)) {
      const agentRow = agentRows.find((a) => normalizeAgentName(String(a.agent)) === key);
      const displayName = agentRow ? String(agentRow.agent) : rawName;
      const existing = saleByNormalizedName.get(key);
      saleByNormalizedName.set(key, {
        agent: displayName,
        saleCount: (existing?.saleCount ?? 0) + num(r.n),
        revenue: (existing?.revenue ?? 0) + num(r.revenue),
      });
    } else {
      unmatchedSaleNames.push({ name: rawName, saleCount: num(r.n), revenue: num(r.revenue) });
    }
  }
  matched.push(...saleByNormalizedName.values());
  matched.sort((a, b) => b.revenue - a.revenue);

  return {
    from,
    to,
    headline: {
      totalChats,
      uniqueChats,
      repeatChats: num(h?.rep),
      frtInTatPct: pct(num(h?.frt_in), totalChats),
      resolutionInTatPct: pct(num(h?.res_in), totalChats),
      orders,
      conversionPct: pct(orders, uniqueChats),
      grossRevenue: num(sh?.gross),
      netRevenue: num(sh?.net),
      avgCsat: Math.round(num(h?.avg_csat) * 100) / 100,
      csatResponses: num(h?.csat_n),
    },
    dateWiseTrend: trendRows.map((r) => {
      const d = String(r.d);
      const sale = revenueByDay.get(d);
      const total = num(r.total);
      return {
        date: d,
        totalChats: total,
        uniqueChats: num(r.uniq),
        frtInTatPct: pct(num(r.frt_in), total),
        resolutionInTatPct: pct(num(r.res_in), total),
        orders: sale?.orders ?? 0,
        revenue: sale?.revenue ?? 0,
      };
    }),
    qrcBreakdown: qrcRows.map((r) => ({ qrc: String(r.qrc), count: num(r.n), pct: pct(num(r.n), totalChats) })),
    channelBreakdown: channelRows.map((r) => ({ channel: String(r.channel), count: num(r.n), pct: pct(num(r.n), totalChats) })),
    statusBreakdown: statusRows.map((r) => ({ status: String(r.ticket_status), count: num(r.n), pct: pct(num(r.n), totalChats) })),
    csatBreakdown: csatRows.map((r) => ({ rating: num(r.rating), count: num(r.n) })),
    tagBreakdown: tagRows.map((r) => ({ tag: String(r.tags), count: num(r.n) })),
    agents: agentRows.map((r) => {
      const total = num(r.total);
      return {
        agent: String(r.agent),
        totalChats: total,
        uniqueChats: num(r.uniq),
        frtInTatPct: pct(num(r.frt_in), total),
        resolutionInTatPct: pct(num(r.res_in), total),
      };
    }),
    saleLinkage: { matched, unmatchedSaleNames },
  };
}
