import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Bellavita's real Cart (abandoned-cart recovery) dashboard -- live
 * aggregates over db_masmis.bb_cart (69,868 rows, confirmed live
 * 2026-09-17), plus an embedded Allocation section over
 * db_masmis.bvo_repeat_allocation (the "Repeat Allocation" upload type
 * this process already has -- registered but 0 rows uploaded so far, per
 * the same "auto show once real data lands" convention used throughout
 * this folder: the query is real and wired up now, it just returns zeros
 * until someone uploads through that type).
 *
 * Column caveats found while building this:
 * - `status` is NOT a call/connectivity status despite the name -- it
 *   holds discount/promo codes ("APP100", "CART10", "COMBO DISCOUNT
 *   APPLIED", etc.) on the rows where it's populated, and '-'/blank
 *   otherwise. Shown as a "Discount Code" breakdown, not a status field.
 * - `same_day_connect` mixes several unrelated tagging schemes across
 *   upload batches (Connect/Not Connect, but also 'cpc', 'GPay_April',
 *   'KwikEngage_Automation', a corrupted 18-digit numeric string, etc.) --
 *   too inconsistent to build a trustworthy rate from, so the primary
 *   "Connected %" KPI uses `disposition` (Connect/Not Connect) instead,
 *   which is clean.
 */

export interface BellavitaCartHeadline {
  totalCarts: number;
  cartValue: number;
  aov: number;
  connectedCount: number;
  connectedPct: number;
  uniqueCustomers: number;
  activeAgents: number;
  /** disposition IN ('Connect','Not Connect') -- cases an agent actually
   * worked, as opposed to ones still sitting unattempted. */
  workableCases: number;
  /** disposition = 'Pending to call', per explicit user mapping (labeled
   * "DND Cases" in the reference sheet the user supplied -- this app's real
   * disposition values have no separate DND flag, only 'Pending to call',
   * so that's what's counted here rather than inventing a DND-specific
   * column that doesn't exist). */
  dndCases: number;
  /** Distinct (call_date, phone_number) pairs -- the same customer called
   * twice on the same day counts once; called again on a different day
   * counts again, per explicit "Unique call from date and Number" request. */
  uniqueCallCount: number;
  uniqueCallConnectedCount: number;
  uniqueCallConnectedPct: number;
  /** SUM(db_masmis.bb_sale.amount) WHERE campaign = 'Abandon Cart', over
   * the same date range (matched on bb_sale's own `Date` column) -- the
   * REALIZED revenue from recovered carts, a real, distinct figure from
   * `cartValue` above (which is the pre-recovery value of the carts
   * themselves, SUM(bb_cart.amount)). Same pattern already used for the
   * Chat dashboard's Revenue (campaign = 'Chat'). */
  abandonCartRevenue: number;
  abandonCartSaleCount: number;
}

export interface BellavitaAllocationHeadline {
  totalAllocation: number;
  totalValue: number;
  uniqueCustomers: number;
}

export interface BellavitaCartDashboardData {
  headline: BellavitaCartHeadline;
  from: string;
  to: string;
  dateWiseTrend: Array<{ date: string; cartCount: number; cartValue: number }>;
  dispositionBreakdown: Array<{ disposition: string; count: number; pct: number }>;
  discountBreakdown: Array<{ code: string; count: number }>;
  agents: Array<{ agent: string; cartCount: number; cartValue: number; connectedPct: number }>;
  allocation: { headline: BellavitaAllocationHeadline; hasData: boolean };
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function pad2(n: number): string { return String(n).padStart(2, "0"); }

function last30DaysRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 29);
  const f = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return { from: f(from), to: f(now) };
}

function resolveRange(fromInput: string, toInput: string): { from: string; to: string } {
  const fallback = last30DaysRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** call_date is "D-Mon-YY" text (e.g. "13-Sep-26"); MySQL parses this
 * natively via STR_TO_DATE with %e-%b-%y, same pattern used elsewhere in
 * this folder for identically-formatted date columns. */
const CART_DATE_EXPR = "STR_TO_DATE(call_date, '%e-%b-%y')";

export async function getBellavitaCartDashboard(fromInput: string, toInput: string): Promise<BellavitaCartDashboardData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const range = [from, to];

  const [[headlineRow]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, SUM(amount) AS value,
       SUM(CASE WHEN disposition = 'Connect' THEN 1 ELSE 0 END) AS connected,
       COUNT(DISTINCT NULLIF(phone_number, '')) AS unique_customers,
       COUNT(DISTINCT NULLIF(agent, '')) AS active_agents,
       SUM(CASE WHEN disposition IN ('Connect', 'Not Connect') THEN 1 ELSE 0 END) AS workable_cases,
       SUM(CASE WHEN disposition = 'Pending to call' THEN 1 ELSE 0 END) AS dnd_cases,
       COUNT(DISTINCT CASE WHEN phone_number IS NOT NULL AND phone_number != ''
         THEN CONCAT(call_date, '|', phone_number) END) AS unique_call_count,
       COUNT(DISTINCT CASE WHEN disposition = 'Connect' AND phone_number IS NOT NULL AND phone_number != ''
         THEN CONCAT(call_date, '|', phone_number) END) AS unique_call_connected
     FROM db_masmis.bb_cart
     WHERE ${CART_DATE_EXPR} >= ? AND ${CART_DATE_EXPR} < DATE_ADD(?, INTERVAL 1 DAY)`,
    range,
  );

  /** bb_sale's own `Date` column is a plain "YYYY-MM-DD" string (confirmed
   * live, same as the Chat dashboard's identical cross-reference) -- directly
   * comparable to `from`/`to` without parsing. */
  const [[abandonSaleRow]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n, SUM(amount) AS revenue
     FROM db_masmis.bb_sale
     WHERE campaign = 'Abandon Cart' AND \`Date\` >= ? AND \`Date\` <= ?`,
    [from, to],
  );

  const [trendRows] = await db.execute<RowDataPacket[]>(
    `SELECT ${CART_DATE_EXPR} AS d, COUNT(*) AS cart_count, SUM(amount) AS cart_value
     FROM db_masmis.bb_cart
     WHERE ${CART_DATE_EXPR} >= ? AND ${CART_DATE_EXPR} < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY ${CART_DATE_EXPR} ORDER BY d ASC`,
    range,
  );

  const [dispositionRows] = await db.execute<RowDataPacket[]>(
    `SELECT disposition, COUNT(*) AS n
     FROM db_masmis.bb_cart
     WHERE ${CART_DATE_EXPR} >= ? AND ${CART_DATE_EXPR} < DATE_ADD(?, INTERVAL 1 DAY)
       AND disposition IS NOT NULL AND disposition NOT IN ('', '-')
     GROUP BY disposition ORDER BY n DESC`,
    range,
  );

  const [discountRows] = await db.execute<RowDataPacket[]>(
    `SELECT status AS code, COUNT(*) AS n
     FROM db_masmis.bb_cart
     WHERE ${CART_DATE_EXPR} >= ? AND ${CART_DATE_EXPR} < DATE_ADD(?, INTERVAL 1 DAY)
       AND status IS NOT NULL AND status NOT IN ('', '-') AND status != 'Connect' AND status != 'Pending to call'
     GROUP BY status ORDER BY n DESC LIMIT 15`,
    range,
  );

  const [agentRows] = await db.execute<RowDataPacket[]>(
    `SELECT agent, COUNT(*) AS n, SUM(amount) AS value,
       SUM(CASE WHEN disposition = 'Connect' THEN 1 ELSE 0 END) AS connected
     FROM db_masmis.bb_cart
     WHERE ${CART_DATE_EXPR} >= ? AND ${CART_DATE_EXPR} < DATE_ADD(?, INTERVAL 1 DAY) AND agent IS NOT NULL AND agent != ''
     GROUP BY agent ORDER BY value DESC LIMIT 200`,
    range,
  );

  const [[allocRow]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, SUM(order_invoice_amount) AS value, COUNT(DISTINCT NULLIF(mobile_no, '')) AS unique_customers
     FROM db_masmis.bvo_repeat_allocation`,
  );

  const totalCarts = num(headlineRow?.total);
  const connectedCount = num(headlineRow?.connected);
  const allocTotal = num(allocRow?.total);
  const uniqueCallCount = num(headlineRow?.unique_call_count);
  const uniqueCallConnectedCount = num(headlineRow?.unique_call_connected);

  return {
    headline: {
      totalCarts,
      cartValue: num(headlineRow?.value),
      aov: totalCarts > 0 ? Math.round((num(headlineRow?.value) / totalCarts) * 100) / 100 : 0,
      connectedCount,
      connectedPct: pct(connectedCount, totalCarts),
      uniqueCustomers: num(headlineRow?.unique_customers),
      activeAgents: num(headlineRow?.active_agents),
      workableCases: num(headlineRow?.workable_cases),
      dndCases: num(headlineRow?.dnd_cases),
      uniqueCallCount,
      uniqueCallConnectedCount,
      uniqueCallConnectedPct: pct(uniqueCallConnectedCount, uniqueCallCount),
      abandonCartRevenue: num(abandonSaleRow?.revenue),
      abandonCartSaleCount: num(abandonSaleRow?.n),
    },
    from, to,
    dateWiseTrend: trendRows.map((r) => ({ date: String(r.d), cartCount: num(r.cart_count), cartValue: num(r.cart_value) })),
    dispositionBreakdown: dispositionRows.map((r) => ({ disposition: String(r.disposition), count: num(r.n), pct: pct(num(r.n), totalCarts) })),
    discountBreakdown: discountRows.map((r) => ({ code: String(r.code), count: num(r.n) })),
    agents: agentRows.map((r) => ({
      agent: String(r.agent), cartCount: num(r.n), cartValue: num(r.value), connectedPct: pct(num(r.connected), num(r.n)),
    })),
    allocation: {
      headline: {
        totalAllocation: allocTotal,
        totalValue: num(allocRow?.value),
        uniqueCustomers: num(allocRow?.unique_customers),
      },
      hasData: allocTotal > 0,
    },
  };
}
