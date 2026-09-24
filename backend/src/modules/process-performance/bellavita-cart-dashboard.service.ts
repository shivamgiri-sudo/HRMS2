import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  setMonthlyTarget, type MonthlyTargetChange,
  loadSpanTargetContext, spanTarget, dayTargetFrom, eachDay,
  setDailyTarget, setDailyTargetsBulk, type DailyTargetChange,
} from "./dashboard-monthly-target.shared.js";

/** dashboard_metric_target keys for this dashboard's one editable target:
 * the monthly Abandon Cart Revenue commitment (Overview tab). Set via
 * setBellavitaCartMonthlyTarget / PUT .../bellavita-cart-dashboard/monthly-target. */
const CART_DASHBOARD_CODE = "bellavita_cart";
const CART_TARGET_METRIC = "BB_CART_REVENUE_TARGET";

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
 * - `same_day_connect` carries several unrelated tagging schemes mixed into
 *   one column across upload batches -- 'Connect'/'Not Connect' (the real
 *   same-day-of-call outcome), but also marketing-source values ('cpc',
 *   'GPay_April', 'KwikEngage_Automation') and a corrupted 18-digit numeric
 *   string on other rows. The primary "Connected %" KPI still uses
 *   `disposition` (Connect/Not Connect), which is clean and column-pure; but
 *   the "Same Day Unique Attempt/Connect" figures ARE this column's own
 *   'Connect'/'Not Connect' values specifically -- confirmed 2026-09-23
 *   against the reference sheet's own numbers (21,819 attempt / 9,421
 *   connect, matched exactly). Every other value in the column is ignored.
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
  /** abandonCartRevenue / abandonCartSaleCount -- average REALIZED order
   * value, distinct from `aov` above (average pre-recovery CART value). */
  abandonCartAov: number;
  /** Monthly target for abandonCartRevenue, admin-set (null = never set for this month). */
  target: number | null;
  achievementPct: number | null;
  /** disposition = 'Not Connect', a real value distinct from workableCases
   * (which is Connect + Not Connect combined). */
  ncConnectCount: number;
  /** Distinct (call_date, phone) pairs where bb_cart.same_day_connect is
   * 'Not Connect' or 'Connect' (attempt) / 'Connect' (connect) -- see the
   * header comment on why only those two values of that column are trusted. */
  sameDayUniqueAttempt: number;
  sameDayUniqueConnect: number;
  sameDayUniqueConnectPct: number;
  /** Deduped Abandon-Cart Sale-Made orders (same set as abandonCartSaleCount),
   * classified by bb_sale.payment_status/final_status. */
  codOrderCount: number;
  paidOrderCount: number;
  rtoOrderCount: number;
}

export interface BellavitaCartTopProduct {
  product: string;
  baseCount: number; cartValue: number;
  uniqueAttempted: number; uniqueConnected: number; connectedPct: number;
  /** null when this product's bb_cart variant_title had no exact-matching
   * bb_sale.line_item_name in range -- "not matched", not "zero sales". */
  saleCount: number | null; revenue: number | null; aov: number | null;
}

export interface BellavitaAllocationHeadline {
  totalAllocation: number;
  totalValue: number;
  uniqueCustomers: number;
}

export interface BellavitaCartTrendRow {
  date: string;
  cartCount: number; cartValue: number;
  connectedCount: number; uniqueCustomers: number; activeAgents: number;
  workableCases: number; dndCases: number; ncConnectCount: number;
  uniqueCallCount: number; uniqueCallConnectedCount: number;
  sameDayUniqueAttempt: number; sameDayUniqueConnect: number;
  /** SUM(bb_sale.amount)/COUNT(*) for this one day, same dedup as the
   * headline's abandonCartRevenue/abandonCartSaleCount. */
  abandonCartRevenue: number; abandonCartSaleCount: number;
  codOrderCount: number; paidOrderCount: number; rtoOrderCount: number;
}

export interface BellavitaCartDashboardData {
  headline: BellavitaCartHeadline;
  from: string;
  to: string;
  /** The calendar month (YYYY-MM) the headline's target/achievementPct apply
   * to -- always the month of `to`, so an admin editing the target knows
   * which month they're setting even when the selected range spans several. */
  targetMonth: string;
  /** Every headline KPI, broken down by day -- the single dataset every KPI
   * card's date-wise/week-wise drill-down drawer reads from (week-wise is
   * summed client-side from these rows), so a click on any card can never
   * disagree with another. uniqueCustomers/activeAgents are real per-day
   * DISTINCT counts but -- being distinct counts -- do not sum to the
   * headline's own range-wide totals (the same customer/agent appearing on
   * multiple days is correctly counted once per day, not once overall);
   * shown as-is rather than a misleading forced reconciliation. */
  dateWiseTrend: BellavitaCartTrendRow[];
  dispositionBreakdown: Array<{ disposition: string; count: number; pct: number }>;
  discountBreakdown: Array<{ code: string; count: number }>;
  agents: Array<{ agent: string; cartCount: number; cartValue: number; connectedPct: number }>;
  allocation: { headline: BellavitaAllocationHeadline; hasData: boolean };
  /** Top 10 products by base cart count -- see BellavitaCartTopProduct's own
   * doc comment for why this is "Products" only, not "Campaigns" (bb_cart has
   * no campaign/lob column). */
  topProducts: BellavitaCartTopProduct[];
  /** Only populated when headline.totalCarts is 0 -- MAX(call_date) across
   * all of bb_cart, same "genuinely no data" vs "outside the uploaded
   * window" distinction the Chat dashboard's own latestAvailableDate makes
   * (confirmed live: bb_cart's newest upload is 2026-09-13, so a "this
   * month" default reaching into late September shows nothing despite
   * 21,868 real rows existing). */
  latestAvailableDate: string | null;
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
       COUNT(DISTINCT CASE WHEN agent NOT IN ('', '-', 'VDAD') THEN agent END) AS active_agents, -- VDAD = auto-dialer, not an agent
       SUM(CASE WHEN disposition IN ('Connect', 'Not Connect') THEN 1 ELSE 0 END) AS workable_cases,
       SUM(CASE WHEN disposition = 'Pending to call' THEN 1 ELSE 0 END) AS dnd_cases,
       SUM(CASE WHEN disposition = 'Not Connect' THEN 1 ELSE 0 END) AS nc_connect,
       COUNT(DISTINCT CASE WHEN phone_number IS NOT NULL AND phone_number != ''
         THEN CONCAT(call_date, '|', phone_number) END) AS unique_call_count,
       COUNT(DISTINCT CASE WHEN disposition = 'Connect' AND phone_number IS NOT NULL AND phone_number != ''
         THEN CONCAT(call_date, '|', phone_number) END) AS unique_call_connected,
       -- "Same day" = same_day_connect IN ('Connect','Not Connect') -- confirmed
       -- correct 2026-09-23 against the reference sheet's own figures (21,819
       -- attempt / 9,421 connect, matched exactly). This column also carries
       -- several unrelated tagging schemes on other rows (marketing-source
       -- values like 'cpc'/'GPay_April', corrupted numeric strings, etc. --
       -- see this file's header comment), so only its two real Connect/Not
       -- Connect values are trusted here; a prior version of this query
       -- avoided the column entirely and compared call_date to created_at
       -- instead, which was wrong -- agents here never call the same
       -- calendar day a cart is abandoned, so that always returned 0.
       COUNT(DISTINCT CASE WHEN same_day_connect IN ('Connect', 'Not Connect') AND phone_number IS NOT NULL AND phone_number != ''
         THEN CONCAT(call_date, '|', phone_number) END) AS same_day_attempt,
       COUNT(DISTINCT CASE WHEN same_day_connect = 'Connect' AND phone_number IS NOT NULL AND phone_number != ''
         THEN CONCAT(call_date, '|', phone_number) END) AS same_day_connect_real
     FROM db_masmis.bb_cart
     WHERE ${CART_DATE_EXPR} >= ? AND ${CART_DATE_EXPR} < DATE_ADD(?, INTERVAL 1 DAY)`,
    range,
  );

  /** bb_sale's own `Date` column is a plain "YYYY-MM-DD" string (confirmed
   * live, same as the Chat dashboard's identical cross-reference) -- directly
   * comparable to `from`/`to` without parsing. */
  const [[abandonSaleRow]] = await db.execute<RowDataPacket[]>(
    // One row per Sale Made order (latest upload). The raw campaign='Abandon Cart'
    // rows also hold non-sale call outcomes and orders re-uploaded 2-3x:
    // 1-13 Sep 2026 gave 2,714 sales / 1,958,841 vs the true 832 / 599,148.
    `SELECT COUNT(*) AS n, SUM(s.amount) AS revenue,
       SUM(CASE WHEN s.payment_status = 'cod' THEN 1 ELSE 0 END) AS cod_orders,
       SUM(CASE WHEN s.payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_orders,
       SUM(CASE WHEN s.final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_orders
     FROM db_masmis.bb_sale s
     INNER JOIN (
       SELECT bella_vita_order_id, MAX(id) AS keep_id
       FROM db_masmis.bb_sale
       WHERE campaign = 'Abandon Cart' AND calling_status = 'Sale Made' AND \`Date\` >= ? AND \`Date\` <= ?
         AND bella_vita_order_id IS NOT NULL AND bella_vita_order_id != ''
       GROUP BY bella_vita_order_id
     ) dk ON dk.keep_id = s.id`,
    [from, to],
  );

  // Top Products -- bb_cart's own `variant_title` (a real, clean product-name
  // column; bb_cart has no `campaign`/`lob` column at all, so a "Top
  // Campaigns" cut isn't possible from this table -- see this file's header
  // comment). Revenue/AOV are joined from bb_sale's `line_item_name` by exact
  // trimmed match, best-effort: the two columns come from different systems
  // (cart export vs order export) and don't always agree on punctuation/
  // encoding, so an unmatched product shows null revenue, never a fabricated 0.
  const [topProductRows] = await db.execute<RowDataPacket[]>(
    `SELECT variant_title AS product, COUNT(*) AS base_count, SUM(amount) AS cart_value,
       COUNT(DISTINCT CASE WHEN disposition = 'Connect' AND phone_number IS NOT NULL AND phone_number != '' THEN phone_number END) AS unique_connected,
       COUNT(DISTINCT CASE WHEN phone_number IS NOT NULL AND phone_number != '' THEN phone_number END) AS unique_attempted
     FROM db_masmis.bb_cart
     WHERE ${CART_DATE_EXPR} >= ? AND ${CART_DATE_EXPR} < DATE_ADD(?, INTERVAL 1 DAY)
       AND variant_title IS NOT NULL AND variant_title != ''
     GROUP BY variant_title ORDER BY base_count DESC LIMIT 10`,
    range,
  );
  const topProductNames = topProductRows.map((r) => String(r.product).trim());
  let productSaleRows: RowDataPacket[] = [];
  if (topProductNames.length > 0) {
    [productSaleRows] = await db.execute<RowDataPacket[]>(
      `SELECT s.line_item_name AS product, COUNT(*) AS n, SUM(s.amount) AS revenue
       FROM db_masmis.bb_sale s
       INNER JOIN (
         SELECT bella_vita_order_id, MAX(id) AS keep_id
         FROM db_masmis.bb_sale
         WHERE campaign = 'Abandon Cart' AND calling_status = 'Sale Made' AND \`Date\` >= ? AND \`Date\` <= ?
           AND bella_vita_order_id IS NOT NULL AND bella_vita_order_id != ''
         GROUP BY bella_vita_order_id
       ) dk ON dk.keep_id = s.id
       WHERE TRIM(s.line_item_name) IN (${topProductNames.map(() => "?").join(",")})
       GROUP BY s.line_item_name`,
      [from, to, ...topProductNames],
    );
  }
  const productSaleByName = new Map<string, { n: number; revenue: number }>(
    productSaleRows.map((r) => [String(r.product).trim(), { n: num(r.n), revenue: num(r.revenue) }]),
  );

  const [trendRows] = await db.execute<RowDataPacket[]>(
    `SELECT ${CART_DATE_EXPR} AS d, COUNT(*) AS cart_count, SUM(amount) AS cart_value,
       SUM(CASE WHEN disposition = 'Connect' THEN 1 ELSE 0 END) AS connected,
       COUNT(DISTINCT NULLIF(phone_number, '')) AS unique_customers,
       COUNT(DISTINCT CASE WHEN agent NOT IN ('', '-', 'VDAD') THEN agent END) AS active_agents,
       SUM(CASE WHEN disposition IN ('Connect', 'Not Connect') THEN 1 ELSE 0 END) AS workable_cases,
       SUM(CASE WHEN disposition = 'Pending to call' THEN 1 ELSE 0 END) AS dnd_cases,
       SUM(CASE WHEN disposition = 'Not Connect' THEN 1 ELSE 0 END) AS nc_connect,
       COUNT(DISTINCT CASE WHEN phone_number IS NOT NULL AND phone_number != '' THEN phone_number END) AS unique_call_count,
       COUNT(DISTINCT CASE WHEN disposition = 'Connect' AND phone_number IS NOT NULL AND phone_number != '' THEN phone_number END) AS unique_call_connected,
       -- Same trusted-values-only convention as the headline query above.
       COUNT(DISTINCT CASE WHEN same_day_connect IN ('Connect', 'Not Connect') AND phone_number IS NOT NULL AND phone_number != '' THEN phone_number END) AS same_day_attempt,
       COUNT(DISTINCT CASE WHEN same_day_connect = 'Connect' AND phone_number IS NOT NULL AND phone_number != '' THEN phone_number END) AS same_day_connect_real
     FROM db_masmis.bb_cart
     WHERE ${CART_DATE_EXPR} >= ? AND ${CART_DATE_EXPR} < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY ${CART_DATE_EXPR} ORDER BY d ASC`,
    range,
  );

  // Same dedup shape as abandonSaleRow above (MAX(id) per order across the
  // whole selected range, THEN grouped) -- see the Chat dashboard's own
  // getBellavitaChatTlTrend comment for why dedup must happen before any
  // per-day grouping, not after, or a stale re-upload gets double-counted.
  const [revenueTrendRows] = await db.execute<RowDataPacket[]>(
    `SELECT s.\`Date\` AS d, COUNT(*) AS n, SUM(s.amount) AS revenue,
       SUM(CASE WHEN s.payment_status = 'cod' THEN 1 ELSE 0 END) AS cod_orders,
       SUM(CASE WHEN s.payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_orders,
       SUM(CASE WHEN s.final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_orders
     FROM db_masmis.bb_sale s
     INNER JOIN (
       SELECT bella_vita_order_id, MAX(id) AS keep_id
       FROM db_masmis.bb_sale
       WHERE campaign = 'Abandon Cart' AND calling_status = 'Sale Made' AND \`Date\` >= ? AND \`Date\` <= ?
         AND bella_vita_order_id IS NOT NULL AND bella_vita_order_id != ''
       GROUP BY bella_vita_order_id
     ) dk ON dk.keep_id = s.id
     GROUP BY s.\`Date\``,
    [from, to],
  );
  const revenueByDate = new Map<string, { n: number; revenue: number; cod: number; paid: number; rto: number }>(
    revenueTrendRows.map((r) => [String(r.d), {
      n: num(r.n), revenue: num(r.revenue), cod: num(r.cod_orders), paid: num(r.paid_orders), rto: num(r.rto_orders),
    }]),
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
  let latestAvailableDate: string | null = null;
  if (totalCarts === 0) {
    const [[latestRow]] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(${CART_DATE_EXPR}) AS latest FROM db_masmis.bb_cart WHERE call_date IS NOT NULL AND call_date != ''`,
    );
    latestAvailableDate = latestRow?.latest ? String(latestRow.latest) : null;
  }
  const connectedCount = num(headlineRow?.connected);
  const allocTotal = num(allocRow?.total);
  const uniqueCallCount = num(headlineRow?.unique_call_count);
  const uniqueCallConnectedCount = num(headlineRow?.unique_call_connected);
  const abandonCartRevenue = num(abandonSaleRow?.revenue);
  const abandonCartSaleCount = num(abandonSaleRow?.n);
  const sameDayUniqueAttempt = num(headlineRow?.same_day_attempt);
  const sameDayUniqueConnect = num(headlineRow?.same_day_connect_real);

  // The target editor's default month is `to`'s month; the actual headline
  // figure sums every day in [from, to], preferring a real uploaded daily
  // target per day and falling back to that day's monthly target / days in
  // its month where no daily value has been set (dashboard-monthly-target.shared.ts).
  const targetMonth = to.slice(0, 7);
  const targetDays = eachDay(from, to);
  const targetCtx = await loadSpanTargetContext(CART_DASHBOARD_CODE, CART_TARGET_METRIC, targetDays);
  const target = spanTarget(targetCtx, targetDays);

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
      abandonCartRevenue,
      abandonCartSaleCount,
      abandonCartAov: abandonCartSaleCount > 0 ? Math.round((abandonCartRevenue / abandonCartSaleCount) * 100) / 100 : 0,
      target,
      achievementPct: target ? pct(abandonCartRevenue, target) : null,
      ncConnectCount: num(headlineRow?.nc_connect),
      sameDayUniqueAttempt,
      sameDayUniqueConnect,
      sameDayUniqueConnectPct: pct(sameDayUniqueConnect, sameDayUniqueAttempt),
      codOrderCount: num(abandonSaleRow?.cod_orders),
      paidOrderCount: num(abandonSaleRow?.paid_orders),
      rtoOrderCount: num(abandonSaleRow?.rto_orders),
    },
    from, to,
    targetMonth,
    dateWiseTrend: trendRows.map((r) => {
      const d = String(r.d);
      const rev = revenueByDate.get(d);
      return {
        date: d, cartCount: num(r.cart_count), cartValue: num(r.cart_value),
        connectedCount: num(r.connected), uniqueCustomers: num(r.unique_customers), activeAgents: num(r.active_agents),
        workableCases: num(r.workable_cases), dndCases: num(r.dnd_cases), ncConnectCount: num(r.nc_connect),
        uniqueCallCount: num(r.unique_call_count), uniqueCallConnectedCount: num(r.unique_call_connected),
        sameDayUniqueAttempt: num(r.same_day_attempt), sameDayUniqueConnect: num(r.same_day_connect_real),
        abandonCartRevenue: rev?.revenue ?? 0, abandonCartSaleCount: rev?.n ?? 0,
        codOrderCount: rev?.cod ?? 0, paidOrderCount: rev?.paid ?? 0, rtoOrderCount: rev?.rto ?? 0,
      };
    }),
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
    topProducts: topProductRows.map((r) => {
      const product = String(r.product).trim();
      const sale = productSaleByName.get(product) ?? null;
      const baseCount = num(r.base_count);
      const uniqueAttempted = num(r.unique_attempted);
      const uniqueConnected = num(r.unique_connected);
      return {
        product, baseCount, cartValue: num(r.cart_value),
        uniqueAttempted, uniqueConnected, connectedPct: pct(uniqueConnected, baseCount),
        saleCount: sale ? sale.n : null,
        revenue: sale ? sale.revenue : null,
        aov: sale && sale.n > 0 ? Math.round((sale.revenue / sale.n) * 100) / 100 : null,
      };
    }),
    latestAvailableDate,
  };
}

/** Sets the Abandon Cart Revenue target for one calendar month. See
 * dashboard-monthly-target.shared.ts's header comment for the storage model. */
export async function setBellavitaCartMonthlyTarget(month: string, value: number, actorId: string): Promise<MonthlyTargetChange> {
  return setMonthlyTarget(CART_DASHBOARD_CODE, CART_TARGET_METRIC, month, value, actorId);
}

/* ---------------------------- date-wise target ------------------------------ */
/**
 * A per-DATE Abandon Cart Revenue target, from the reference sheet the user
 * supplied (2026-09-21 screenshots): Date / Conv Tgt% / Allocation / Sale
 * Target / Revenue target, with two real formulas shown in the sheet:
 *   Sale Target    = Allocation x Conv Tgt%      (cell formula "=C2*B2")
 *   Revenue target = Sale Target x 500            (cell formula "=D2*500")
 * Conv Tgt% and Allocation are the business's own planning inputs (a
 * per-day conversion-rate target and a per-day planned allocation volume --
 * not live counts, since the sheet repeats the same Allocation for many
 * consecutive days); this module trusts them as given and only computes the
 * two derived columns, so the formula can never silently drift from what
 * was actually entered. 500 is the sheet's own fixed assumed revenue-per-
 * sale figure, not something this app derived -- if that assumption ever
 * changes, this constant needs updating alongside it.
 *
 * Only the final Revenue target is persisted (as a daily row in
 * dashboard_metric_target, reusing the exact same table/metric the monthly
 * target above uses, just with target_period='daily' -- see
 * dashboard-monthly-target.shared.ts). Conv Tgt%/Allocation/Sale Target are
 * returned to the caller for display right after an upload, but are not
 * stored as their own columns: this app's target table only has one numeric
 * value per row, and Revenue target is the one the dashboard's Achievement%
 * actually needs. Storing the three drivers too would need a new table.
 */
const REVENUE_PER_SALE = 500;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export interface CartDailyTargetInput { date: string; convTgtPct: number; allocation: number }
export interface CartDailyTargetComputed extends CartDailyTargetInput { saleTarget: number; revenueTarget: number }

/** Pure, no DB access -- lets the frontend preview Sale Target/Revenue target
 * as an admin types, using the exact same formula the upload endpoint applies. */
export function computeCartDailyTargets(rows: CartDailyTargetInput[]): CartDailyTargetComputed[] {
  return rows.map((r) => {
    const saleTarget = round3(r.allocation * (r.convTgtPct / 100));
    return { ...r, saleTarget, revenueTarget: Math.round(saleTarget * REVENUE_PER_SALE) };
  });
}

function validateDailyTargetInputs(rows: CartDailyTargetInput[]): void {
  if (rows.length === 0) throw new Error("No rows to upload");
  if (rows.length > 400) throw new Error("Too many rows in one upload (max 400)");
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new Error(`Invalid date: "${r.date}" (expected YYYY-MM-DD)`);
    if (!Number.isFinite(r.convTgtPct) || r.convTgtPct < 0 || r.convTgtPct > 100) throw new Error(`Conv Tgt% must be 0-100 for ${r.date}`);
    if (!Number.isFinite(r.allocation) || r.allocation < 0) throw new Error(`Allocation must be a non-negative number for ${r.date}`);
  }
}

/** The "upload" path: Date/Conv Tgt%/Allocation rows in, computed Sale
 * Target/Revenue target out, with Revenue target persisted as each date's
 * daily target. Every row is validated before anything is written. */
export async function uploadBellavitaCartDailyTargets(rows: CartDailyTargetInput[], actorId: string): Promise<CartDailyTargetComputed[]> {
  validateDailyTargetInputs(rows);
  const computed = computeCartDailyTargets(rows);
  await setDailyTargetsBulk(CART_DASHBOARD_CODE, CART_TARGET_METRIC, computed.map((c) => ({ date: c.date, value: c.revenueTarget })), actorId);
  return computed;
}

/** A quick single-date override, bypassing the Conv Tgt%/Allocation formula
 * -- for correcting one day's Revenue target directly without re-deriving it. */
export async function setBellavitaCartDailyTarget(date: string, value: number, actorId: string): Promise<DailyTargetChange> {
  return setDailyTarget(CART_DASHBOARD_CODE, CART_TARGET_METRIC, date, value, actorId);
}

export interface CartDailyTargetRow { date: string; target: number | null; source: "daily" | "monthly" | "none"; actualRevenue: number }

/** The effective per-day target for a range, for the chart/table + edit UI:
 * a real uploaded daily value where set ("daily"), else that day's monthly
 * target's even share ("monthly"), else null ("none") -- alongside that same
 * day's real Abandon Cart Revenue (identical definition to the Overview
 * headline's abandonCartRevenue: db_masmis.bb_sale, campaign = 'Abandon
 * Cart', calling_status = 'Sale Made', one row per order), so the chart can
 * show Target vs Actual, not the target in isolation. */
export async function getBellavitaCartDailyTargets(fromInput: string, toInput: string): Promise<{ from: string; to: string; rows: CartDailyTargetRow[] }> {
  const { from, to } = resolveRange(fromInput, toInput);
  const days = eachDay(from, to);
  const [ctx, revenueRows] = await Promise.all([
    loadSpanTargetContext(CART_DASHBOARD_CODE, CART_TARGET_METRIC, days),
    db.execute<RowDataPacket[]>(
      `SELECT DATE(s.\`Date\`) AS d, SUM(s.amount) AS revenue
       FROM db_masmis.bb_sale s
       INNER JOIN (
         SELECT bella_vita_order_id, MAX(id) AS keep_id
         FROM db_masmis.bb_sale
         WHERE campaign = 'Abandon Cart' AND calling_status = 'Sale Made' AND \`Date\` >= ? AND \`Date\` <= ?
           AND bella_vita_order_id IS NOT NULL AND bella_vita_order_id != ''
         GROUP BY bella_vita_order_id
       ) dk ON dk.keep_id = s.id
       GROUP BY DATE(s.\`Date\`)`,
      [from, to],
    ).then(([rows]) => rows),
  ]);
  const revenueByDate = new Map<string, number>();
  for (const r of revenueRows) revenueByDate.set(String(r.d), Number(r.revenue) || 0);

  const rows: CartDailyTargetRow[] = days.map((d) => {
    const actualRevenue = revenueByDate.get(d) ?? 0;
    if (ctx.dailyByDate.has(d)) return { date: d, target: ctx.dailyByDate.get(d)!, source: "daily", actualRevenue };
    const t = dayTargetFrom(ctx, d);
    return t === null
      ? { date: d, target: null, source: "none", actualRevenue }
      : { date: d, target: Math.round(t), source: "monthly", actualRevenue };
  });
  return { from, to, rows };
}
