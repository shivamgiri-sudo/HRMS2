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
  /** Monthly target for abandonCartRevenue, admin-set (null = never set for this month). */
  target: number | null;
  achievementPct: number | null;
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
  /** The calendar month (YYYY-MM) the headline's target/achievementPct apply
   * to -- always the month of `to`, so an admin editing the target knows
   * which month they're setting even when the selected range spans several. */
  targetMonth: string;
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
       COUNT(DISTINCT CASE WHEN agent NOT IN ('', '-', 'VDAD') THEN agent END) AS active_agents, -- VDAD = auto-dialer, not an agent
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
    // One row per Sale Made order (latest upload). The raw campaign='Abandon Cart'
    // rows also hold non-sale call outcomes and orders re-uploaded 2-3x:
    // 1-13 Sep 2026 gave 2,714 sales / 1,958,841 vs the true 832 / 599,148.
    `SELECT COUNT(*) AS n, SUM(s.amount) AS revenue
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
  const abandonCartRevenue = num(abandonSaleRow?.revenue);

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
      abandonCartSaleCount: num(abandonSaleRow?.n),
      target,
      achievementPct: target ? pct(abandonCartRevenue, target) : null,
    },
    from, to,
    targetMonth,
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
