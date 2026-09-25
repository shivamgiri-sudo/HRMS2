import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { setMonthlyTarget, type MonthlyTargetChange } from "./dashboard-monthly-target.shared.js";
import { MONTHLY_LOB_TARGETS, getAutoLobDailyTargets, sumTargets, type DailyTarget } from "./bellavita-auto-targets.shared.js";

const SALE_DASHBOARD_CODE = "bellavita_sale";

/** The Cart dashboard's own target key (bellavita-cart-dashboard.service.ts) --
 * imported as plain strings, not a function, so this file doesn't depend on
 * that module just for two constants. */
const CART_DASHBOARD_CODE = "bellavita_cart";
const CART_TARGET_METRIC = "BB_CART_REVENUE_TARGET";

/** dashboard_metric_target key for one LOB's monthly turnover target --
 * derived from the real `lob` value (e.g. "Repeat" -> BB_SALE_TARGET_REPEAT).
 * Shared by the loader below and by setBellavitaSaleMonthlyTarget, so a set
 * target is always read back under the exact key it was written with. */
export function lobTargetMetricCode(lob: string): string {
  const slug = lob.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `BB_SALE_TARGET_${slug || "UNKNOWN"}`;
}

/** Where a LOB's target actually lives. "Abandon Cart" is deliberately routed
 * to the SAME (dashboard_code, metric_code) the Bellavita Cart dashboard's own
 * Monthly Target editor uses (bellavita-cart-dashboard.service.ts) -- Abandon
 * Cart revenue is one business figure, not two, so setting it from either
 * dashboard updates the other automatically; there is no separate sync step
 * because there is no longer a separate value to keep in sync. Every other
 * LOB keeps its own bellavita_sale-scoped key, since it has no equivalent
 * dashboard elsewhere. */
function targetKeyFor(lob: string): { dashboardCode: string; metricCode: string } {
  if (lob.trim().toLowerCase() === "abandon cart") return { dashboardCode: CART_DASHBOARD_CODE, metricCode: CART_TARGET_METRIC };
  return { dashboardCode: SALE_DASHBOARD_CODE, metricCode: lobTargetMetricCode(lob) };
}

/**
 * Real KPI aggregates for Bellavita's Process Performance V2 "Sale
 * Performance" dashboard, computed live from db_masmis.bb_sale/bb_apr --
 * the exact tables the Bellavita uploaders (Sale/APR/Chat/Cart) write
 * into. Not derived from the reference Excel
 * (Bella_Vita_Overall_Sale_Performance_Dashboard) the user supplied --
 * that file was used only to decide which KPIs and layout to build, per
 * explicit instruction to "reference from uploader data". Confirmed live
 * 2026-09-16: bb_sale has 26,453 real rows (2026-04-30 .. 2026-09-12),
 * bb_apr has 5,951 rows across 128 distinct agents over the same range.
 *
 * LOB_TARGETS below WAS fabricated-data territory until the user supplied
 * the real monthly target figures directly (2026-09-17, alongside a photo
 * of the LOB/Target table) -- Repeat Customer LOB / Chat / Abandon Cart /
 * Inbound. No target uploader/table exists for Bellavita (unlike e.g.
 * Neemans' NEEMANS_MONTH_TARGET_MASMIS), so these are hardcoded from that
 * explicit figure, not computed -- update them by hand if the business
 * target changes. Abandon Cart's target carries the user's own caveat
 * ("this target for only 14") preserved verbatim in its note field, since
 * its meaning (14 days? 14 agents?) was not clarified.
 *
 * Every bb_sale-sourced query below runs against DEDUPED_SALE_SQL, not the
 * raw table, per explicit user instruction ("Bella Vita Order ID should be
 * unique") and ("Calling Status ... should be only 'Sale Made'"). Confirmed
 * live 2026-09-16: bb_sale mixes real completed sales (calling_status=
 * 'Sale Made', 21,228 rows) with non-sale call-attempt outcomes (PTP,
 * Call Disconnected Before Pitch, Not Interested, etc.) in the SAME table,
 * and 3,059 order ids were re-uploaded 2-3x each (verbatim duplicate rows
 * -- same amount every time, confirmed live -- from 3 different
 * upload_batch_id values), inflating every total by ~3,066 rows before
 * this fix. DEDUPED_SALE_SQL keeps exactly one row (MIN(id)) per
 * bella_vita_order_id, only among calling_status='Sale Made' rows.
 */

/** Real monthly LOB targets, supplied directly by the user (2026-09-17) --
 * see the module doc comment above. Keyed by the exact `lob` values found
 * in db_masmis.bb_sale (confirmed live: "Repeat", "Chat", "Abandon Cart",
 * "Inbound" -- note the LOB column drops "customer"/"Customer" from the
 * campaign name, e.g. bb_sale.lob="Repeat" while the target photo's row
 * label is "Repeat Customer LOB"). */
export const LOB_TARGETS: Record<string, { target: number; note?: string }> = Object.fromEntries(
  Object.entries(MONTHLY_LOB_TARGETS).map(([lob, target]) => [lob, { target }]),
);

export interface BellavitaSaleDashboardData {
  headline: {
    turnover: number;
    saleCount: number;
    prepaidPct: number;
    rtoPct: number;
    /** The last date rtoPct's window actually reaches (from through today - 7
     * days, capped at `to` if the selected range ends sooner) -- so the UI can
     * show the reader exactly which dates the figure covers. */
    rtoPctThrough: string;
    aov: number;
    activeAgents: number;
    /** Turnover/saleCount with RTO orders excluded -- the reference
     * sheet's "Net Sale Amount" row (Overall Sale Performance minus its
     * own RTO/RTD column). */
    netTurnover: number;
    netSaleCount: number;
  };
  from: string;
  to: string;
  dateWiseTrend: Array<{
    date: string;
    saleCount: number;
    turnover: number;
    paidCount: number;
    codCount: number;
    rtoCount: number;
  }>;
  /** The calendar month (YYYY-MM) lobRevenue's target/achievementPct apply to
   * -- always the month of `to` (same convention as Bellavita Cart / Chat's
   * planned capacity). */
  targetMonth: string;
  /** Automatic per-LOB daily revenue targets for the selected days up to today (only LOBs present
   * in this view) -- what the charts/drill-downs use for date-wise Target vs Achi%. */
  dailyTargets: Record<string, DailyTarget[]>;
  lobRevenue: Array<{
    lob: string;
    saleCount: number;
    turnover: number;
    target: number | null;
    achievementPct: number | null;
    targetNote?: string;
    /** "auto" = computed by the automatic target rules (bellavita-auto-targets.shared.ts):
     * fixed monthly / days-in-month summed over the selected days up to today, or Abandon
     * Cart's date-wise Revenue Target; "none" = no target rule for this LOB. ("manual" /
     * "default" are legacy values the older editors used and are no longer produced.) */
    targetSource: "auto" | "manual" | "default" | "none";
    codCount: number;
    paidCount: number;
    codPct: number;
    paidPct: number;
    rtoAmount: number;
    rtoCount: number;
    rtoPct: number;
    aov: number;
    netSaleCount: number;
    netRevenue: number;
  }>;
  lobGrandTotal: {
    saleCount: number;
    turnover: number;
    codCount: number;
    paidCount: number;
    codPct: number;
    paidPct: number;
    rtoAmount: number;
    rtoCount: number;
    rtoPct: number;
    aov: number;
    netSaleCount: number;
    netRevenue: number;
    target: number;
    achievementPct: number;
  };
  stateRevenue: Array<{ state: string; saleCount: number; turnover: number; rtoCount: number }>;
  topPerformers: Array<{
    empId: string;
    empName: string;
    saleCount: number;
    turnover: number;
    rtoPct: number;
    prepaidPct: number;
    lob: string;
  }>;
  topRtoStates: Array<{ state: string; saleCount: number; rtoPct: number }>;
}

interface HeadlineRow extends RowDataPacket {
  turnover: string | null;
  sale_count: number;
  paid_count: number;
  cod_count: number;
  rto_count: number;
  net_turnover: string | null;
  net_sale_count: number;
}
interface ActiveAgentsRow extends RowDataPacket {
  active_agents: number;
}
interface TrendRow extends RowDataPacket {
  d: string;
  sale_count: number;
  turnover: string | null;
  paid_count: number;
  cod_count: number;
  rto_count: number;
}
interface LobRow extends RowDataPacket {
  lob: string | null;
  sale_count: number;
  turnover: string | null;
  cod_count: number;
  paid_count: number;
  rto_amount: string | null;
  rto_count: number;
  net_sale_count: number;
  net_turnover: string | null;
}
interface StateRow extends RowDataPacket {
  state: string | null;
  sale_count: number;
  turnover: string | null;
  rto_count: number;
}
interface PerformerRow extends RowDataPacket {
  emp_id: string;
  emp_name: string | null;
  sale_count: number;
  turnover: string | null;
  rto_count: number;
  paid_count: number;
  lob: string | null;
}

const num = (v: string | number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Default range: the 1st of the current month through today, server-side
 * so the API has a sane fallback even if a caller omits from/to. */
/** Local YYYY-MM-DD, deliberately NOT via toISOString(): that converts
 * through UTC, and this host's local clock is IST (UTC+5:30) — midnight
 * on the 1st of the month, converted to UTC, lands on 18:30 the PREVIOUS
 * day, silently rolling the range back a day (confirmed live 2026-09-16:
 * produced "2026-08-31" instead of "2026-09-01"). Same bug class already
 * documented elsewhere in this codebase for this exact host. */
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

/**
 * One row per bella_vita_order_id (MAX(id) = the LATEST upload is the
 * representative; the alias below is still named min_id). Re-uploads refresh
 * final_status/RTO and agent attribution, so MIN(id) kept the stale first
 * upload and understated RTO: 1-13 Sep 2026 RTO was 190 (7.61%) with MIN(id)
 * vs 292 (11.69%) with MAX(id); amount/payment_status/state never differ
 * across the copies),
 * restricted to calling_status='Sale Made' and the date range -- every
 * bb_sale aggregate below reads from this instead of the raw table. Takes
 * its own [from, to] pair since it's re-embedded per query (MySQL has no
 * cross-statement CTE reuse across separate db.execute() calls).
 */
export function dedupedSaleSql(): string {
  return `(
    SELECT s.*
    FROM db_masmis.bb_sale s
    INNER JOIN (
      SELECT bella_vita_order_id, MAX(id) AS min_id
      FROM db_masmis.bb_sale
      WHERE \`Date\` >= ? AND \`Date\` < DATE_ADD(?, INTERVAL 1 DAY)
        AND calling_status = 'Sale Made'
        AND bella_vita_order_id IS NOT NULL AND bella_vita_order_id != ''
      GROUP BY bella_vita_order_id
    ) dk ON dk.min_id = s.id
  ) ds`;
}

export async function getBellavitaSaleDashboard(
  fromInput: string, toInput: string,
  /** Real value of bb_sale.lob (or unset/"All" for every LOB). Narrows every
   * query below -- headline, trend, state/top-performer breakdowns -- to that
   * one LOB. Not applied to activeAgentsRow: bb_apr (the roster/attendance
   * source for that count) carries no LOB column to filter by. */
  lobFilter?: string,
  /** Real value of bb_sale.emp_id -- for the Top Performers row drill-down
   * drawer (date-wise/week-wise performance for one agent). Only narrows
   * headline/RTO/dateWiseTrend, the three fields that drawer reads; the
   * LOB/state/performer breakdowns below are deliberately left scoped to
   * `lobFilter` only, since a single-agent view of "top performers" etc.
   * would just be a trivial one-row table nothing renders. */
  empIdFilter?: string,
): Promise<BellavitaSaleDashboardData> {
  const fallback = currentMonthRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  // `Date` < the day AFTER `to`, so the end date is fully inclusive rather
  // than cutting off at midnight of that day.
  const range = [from, to];
  const deduped = dedupedSaleSql();
  const lob = lobFilter && lobFilter !== "All" ? lobFilter : undefined;
  const lobParam = lob ? [lob] : [];
  const empId = empIdFilter && empIdFilter.trim() ? empIdFilter.trim() : undefined;
  const empParam = empId ? [empId] : [];
  const headlineConds = [lob ? "lob = ?" : null, empId ? "emp_id = ?" : null].filter(Boolean).join(" AND ");
  const headlineParams = [...range, ...lobParam, ...empParam];

  // ONE de-duplicated pass over bb_sale (a few seconds on the shared DB), aggregated here. This used to be eight separate
  // queries that each re-ran the de-dup join over bb_sale (~35s in total, past the browser's 30s timeout, and still ~19s
  // when run together). The filters and aggregates below are the same ones those queries applied.
  const saleRowsP = db.execute<RowDataPacket[]>(
    `SELECT DATE(ds.\`Date\`) AS d, ds.lob AS lob, ds.state AS state, ds.emp_id AS emp_id, ds.emp_name AS emp_name,
            ds.amount AS amount, ds.payment_status AS payment_status, ds.final_status AS final_status
       FROM ${deduped}`,
    range,
  );

  const activeP = db.execute<ActiveAgentsRow[]>(
    `SELECT COUNT(DISTINCT noiid) AS active_agents
     FROM db_masmis.bb_apr
     WHERE report_date >= ? AND report_date < DATE_ADD(?, INTERVAL 1 DAY)`,
    range,
  );

  // RTO status takes time to settle after a sale -- an order from the last
  // few days almost always still shows final_status != 'RTO' simply because
  // the return window hasn't closed yet, not because it won't RTO. Counting
  // those in the headline RTO% would understate the real rate, so that one
  // figure only looks at orders through 7 days ago (never the still-settling
  // last week), even when the selected range itself extends closer to today.
  // Every other headline figure keeps using the full selected range as-is.
  const rtoCutoffDate = new Date();
  rtoCutoffDate.setDate(rtoCutoffDate.getDate() - 7);
  const rtoCutoff = localDateStr(rtoCutoffDate);
  const rtoTo = to < rtoCutoff ? to : rtoCutoff;
  const rtoP = rtoTo >= from
    ? db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS sale_count, SUM(CASE WHEN final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count
       FROM ${deduped}
       ${headlineConds ? `WHERE ${headlineConds}` : ""}`,
      [from, rtoTo, ...lobParam, ...empParam],
    )
    : null;

  const [[saleRows], [[activeAgentsRow]], rtoRes] = await Promise.all([saleRowsP, activeP, rtoP ?? Promise.resolve(null)]);
  const rtoRow = rtoRes ? (rtoRes[0] as RowDataPacket[])[0] : undefined;
  const rtoSaleCount = num(rtoRow?.sale_count);
  const rtoOnlyCount = num(rtoRow?.rto_count);

  const amt = (r: RowDataPacket): number => num(r.amount);
  const isRto = (r: RowDataPacket): boolean => r.final_status === "RTO";
  const isPaid = (r: RowDataPacket): boolean => r.payment_status === "paid";
  const isCod = (r: RowDataPacket): boolean => r.payment_status === "cod";
  const sumBy = (rows: RowDataPacket[], pick: (r: RowDataPacket) => number): number => rows.reduce((n, r) => n + pick(r), 0);
  const groupBy = (rows: RowDataPacket[], key: (r: RowDataPacket) => string): Map<string, RowDataPacket[]> => {
    const m = new Map<string, RowDataPacket[]>();
    for (const r of rows) { const k = key(r); const g = m.get(k); if (g) g.push(r); else m.set(k, [r]); }
    return m;
  };

  // headline / trend honour the LOB and agent filters; the LOB/state/performer breakdowns honour the LOB filter only.
  const headlineRows = saleRows.filter((r) => (!lob || r.lob === lob) && (!empId || r.emp_id === empId));
  const lobScoped = lob ? saleRows.filter((r) => r.lob === lob) : saleRows;

  const headlineRow: HeadlineRow = {
    turnover: String(sumBy(headlineRows, amt)),
    sale_count: headlineRows.length,
    paid_count: headlineRows.filter(isPaid).length,
    cod_count: headlineRows.filter(isCod).length,
    rto_count: headlineRows.filter(isRto).length,
    net_turnover: String(sumBy(headlineRows.filter((r) => !isRto(r)), amt)),
    net_sale_count: headlineRows.filter((r) => !isRto(r)).length,
  } as HeadlineRow;

  const trendRows: TrendRow[] = [...groupBy(headlineRows, (r) => String(r.d).slice(0, 10)).entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([d, g]) => ({
      d, sale_count: g.length, turnover: String(sumBy(g, amt)), paid_count: g.filter(isPaid).length,
      cod_count: g.filter(isCod).length, rto_count: g.filter(isRto).length,
    })) as TrendRow[];

  const lobRows: LobRow[] = [...groupBy(lobScoped.filter((r) => r.lob), (r) => String(r.lob)).entries()]
    .map(([l, g]) => ({
      lob: l, sale_count: g.length, turnover: String(sumBy(g, amt)), cod_count: g.filter(isCod).length, paid_count: g.filter(isPaid).length,
      rto_amount: String(sumBy(g.filter(isRto), amt)), rto_count: g.filter(isRto).length,
      net_sale_count: g.filter((r) => !isRto(r)).length, net_turnover: String(sumBy(g.filter((r) => !isRto(r)), amt)),
    }))
    .sort((x, y) => num(y.turnover) - num(x.turnover)) as LobRow[];

  const stateGroups = [...groupBy(lobScoped.filter((r) => r.state), (r) => String(r.state)).entries()];
  const stateRows: StateRow[] = stateGroups
    .map(([st, g]) => ({ state: st, sale_count: g.length, turnover: String(sumBy(g, amt)), rto_count: g.filter(isRto).length }))
    .sort((x, y) => num(y.turnover) - num(x.turnover)).slice(0, 10) as StateRow[];

  const performerRows: PerformerRow[] = [...groupBy(lobScoped.filter((r) => r.emp_id), (r) => String(r.emp_id)).entries()]
    .map(([id, g]) => ({
      emp_id: id, emp_name: g.map((r) => r.emp_name).filter(Boolean).sort().at(-1) ?? null, sale_count: g.length,
      turnover: String(sumBy(g, amt)), rto_count: g.filter(isRto).length, paid_count: g.filter(isPaid).length,
      lob: g.map((r) => r.lob).filter(Boolean).sort().at(-1) ?? null,
    }))
    .sort((x, y) => num(y.turnover) - num(x.turnover)).slice(0, 5) as PerformerRow[];

  const topRtoStateRows: StateRow[] = stateGroups
    .filter(([, g]) => g.length >= 5)
    .map(([st, g]) => ({ state: st, sale_count: g.length, turnover: null, rto_count: g.filter(isRto).length }))
    .sort((x, y) => y.rto_count / y.sale_count - x.rto_count / x.sale_count).slice(0, 5) as StateRow[];

  const turnover = num(headlineRow?.turnover);
  const saleCount = num(headlineRow?.sale_count);
  const paidCount = num(headlineRow?.paid_count);
  const codCount = num(headlineRow?.cod_count);

  // Targets are automatic (bellavita-auto-targets.shared.ts): nothing is stored or edited. Each LOB's
  // target is the sum of its daily targets over the selected days up to today ("MTD till today").
  const targetMonth = to.slice(0, 7);
  const dailyTargets = await getAutoLobDailyTargets(lobRows.map((r) => r.lob || "Unknown"), from, to);

  const lobRevenue = lobRows.map((r) => {
    const lob = r.lob || "Unknown";
    const turnoverVal = num(r.turnover);
    const saleCountVal = num(r.sale_count);
    const codCountVal = num(r.cod_count);
    const paidCountVal = num(r.paid_count);
    const rtoCountVal = num(r.rto_count);
    const hasRule = dailyTargets[lob] !== undefined;
    const target = hasRule ? sumTargets(dailyTargets[lob]) : null;
    const targetSource: "auto" | "none" = hasRule ? "auto" : "none";
    return {
      lob,
      saleCount: saleCountVal,
      turnover: turnoverVal,
      target,
      targetSource,
      achievementPct: target ? pct(turnoverVal, target) : null,
      targetNote: undefined,
      codCount: codCountVal,
      paidCount: paidCountVal,
      codPct: pct(codCountVal, paidCountVal + codCountVal),
      paidPct: pct(paidCountVal, paidCountVal + codCountVal),
      rtoAmount: num(r.rto_amount),
      rtoCount: rtoCountVal,
      rtoPct: pct(rtoCountVal, saleCountVal),
      aov: saleCountVal > 0 ? Math.round((turnoverVal / saleCountVal) * 100) / 100 : 0,
      netSaleCount: num(r.net_sale_count),
      netRevenue: num(r.net_turnover),
    };
  });

  /**
   * Grand Total row across every LOB -- target is only the sum of
   * LOB_TARGETS for LOBs actually present this period (not every key in
   * that constant), so achievementPct compares like against like rather
   * than penalizing a period where, say, no Inbound sales landed yet.
   */
  const lobTotalSaleCount = lobRevenue.reduce((s, r) => s + r.saleCount, 0);
  const lobTotalTurnover = lobRevenue.reduce((s, r) => s + r.turnover, 0);
  const lobTotalCod = lobRevenue.reduce((s, r) => s + r.codCount, 0);
  const lobTotalPaid = lobRevenue.reduce((s, r) => s + r.paidCount, 0);
  const lobTotalRtoAmount = lobRevenue.reduce((s, r) => s + r.rtoAmount, 0);
  const lobTotalRtoCount = lobRevenue.reduce((s, r) => s + r.rtoCount, 0);
  const lobTotalNetSaleCount = lobRevenue.reduce((s, r) => s + r.netSaleCount, 0);
  const lobTotalNetRevenue = lobRevenue.reduce((s, r) => s + r.netRevenue, 0);
  const lobTotalTarget = lobRevenue.reduce((s, r) => s + (r.target ?? 0), 0);
  const lobGrandTotal = {
    saleCount: lobTotalSaleCount,
    turnover: lobTotalTurnover,
    codCount: lobTotalCod,
    paidCount: lobTotalPaid,
    codPct: pct(lobTotalCod, lobTotalPaid + lobTotalCod),
    paidPct: pct(lobTotalPaid, lobTotalPaid + lobTotalCod),
    rtoAmount: lobTotalRtoAmount,
    rtoCount: lobTotalRtoCount,
    rtoPct: pct(lobTotalRtoCount, lobTotalSaleCount),
    aov: lobTotalSaleCount > 0 ? Math.round((lobTotalTurnover / lobTotalSaleCount) * 100) / 100 : 0,
    netSaleCount: lobTotalNetSaleCount,
    netRevenue: lobTotalNetRevenue,
    target: lobTotalTarget,
    achievementPct: pct(lobTotalTurnover, lobTotalTarget),
  };

  return {
    headline: {
      turnover,
      saleCount,
      prepaidPct: pct(paidCount, paidCount + codCount),
      rtoPct: pct(rtoOnlyCount, rtoSaleCount),
      rtoPctThrough: rtoTo,
      aov: saleCount > 0 ? Math.round((turnover / saleCount) * 100) / 100 : 0,
      activeAgents: num(activeAgentsRow?.active_agents),
      netTurnover: num(headlineRow?.net_turnover),
      netSaleCount: num(headlineRow?.net_sale_count),
    },
    from,
    to,
    targetMonth,
    dailyTargets,
    dateWiseTrend: trendRows.map((r) => ({
      date: String(r.d),
      saleCount: num(r.sale_count),
      turnover: num(r.turnover),
      paidCount: num(r.paid_count),
      codCount: num(r.cod_count),
      rtoCount: num(r.rto_count),
    })),
    lobRevenue,
    lobGrandTotal,
    stateRevenue: stateRows.map((r) => ({
      state: r.state || "Unknown",
      saleCount: num(r.sale_count),
      turnover: num(r.turnover),
      rtoCount: num(r.rto_count),
    })),
    topPerformers: performerRows.map((r) => ({
      empId: r.emp_id,
      empName: r.emp_name || r.emp_id,
      saleCount: num(r.sale_count),
      turnover: num(r.turnover),
      rtoPct: pct(num(r.rto_count), num(r.sale_count)),
      prepaidPct: pct(num(r.paid_count), num(r.sale_count)),
      lob: r.lob || "Unknown",
    })),
    topRtoStates: topRtoStateRows.map((r) => ({
      state: r.state || "Unknown",
      saleCount: num(r.sale_count),
      rtoPct: pct(num(r.rto_count), num(r.sale_count)),
    })),
  };
}

/** Sets one LOB's turnover target for one calendar month, overriding the
 * hardcoded LOB_TARGETS fallback for that LOB from then on. `lob` must be a
 * real value from db_masmis.bb_sale.lob (or an existing LOB_TARGETS key) --
 * the same string this endpoint's caller reads off the dashboard's own
 * lobRevenue rows, so it's a closed set at the UI level even though this
 * function itself doesn't enumerate every possible LOB. See
 * dashboard-monthly-target.shared.ts's header comment for the storage model. */
export async function setBellavitaSaleMonthlyTarget(lob: string, month: string, value: number, actorId: string): Promise<MonthlyTargetChange> {
  const trimmed = lob.trim();
  if (!trimmed) throw new Error("lob is required");
  const { dashboardCode, metricCode } = targetKeyFor(trimmed);
  const change = await setMonthlyTarget(dashboardCode, metricCode, month, value, actorId);
  return { ...change, metricCode: trimmed }; // report back the real LOB name, not its internal metric code
}

/* --------------------------- date x LOB matrix ----------------------------- */

/**
 * Date-wise, LOB-wise Sale/Revenue split by COD vs Paid -- the "BVO Chat
 * QRC"-style raw matrix the user supplied as a reference sheet (columns:
 * Repeat Customer / Chat / Inbound / Abandon Cart, each split COD | Paid |
 * Grand Total, plus an Overall Sale Performance block, an RTO block and a
 * Net Sale Amount block, one row per date). Reuses DEDUPED_SALE_SQL, same as
 * every other query in this file, so it can never disagree with the
 * headline/LOB-wise table above.
 *
 * "RTO , RTD & Revenue" in the reference sheet: this app's data only carries
 * one return-status flag (bb_sale.final_status = 'RTO'), confirmed by every
 * other RTO figure in this file -- there is no separate "RTD" value anywhere
 * in db_masmis.bb_sale. So this block reports RTO only, under that same
 * combined label (matching the reference sheet's own header), rather than
 * inventing a second, non-existent bucket.
 */
export interface DateLobBlockRow {
  codSale: number; codRevenue: number;
  paidSale: number; paidRevenue: number;
  totalSale: number; totalRevenue: number;
  codPct: number; paidPct: number;
}
export interface DateLobMatrixRow {
  date: string;
  lobs: Record<string, DateLobBlockRow>;
  overall: DateLobBlockRow;
  rtoCount: number; rtoRevenue: number;
  netSaleCount: number; netSaleRevenue: number;
}
export interface BellavitaDateLobMatrixData {
  from: string; to: string;
  /** Real LOBs present in this range, in the reference sheet's own display order
   * (Repeat, Chat, Abandon Cart, Inbound), with any unexpected extra LOB appended. */
  lobOrder: string[];
  rows: DateLobMatrixRow[];
  grandTotal: DateLobMatrixRow;
}

const LOB_DISPLAY_ORDER = ["Repeat", "Chat", "Abandon Cart", "Inbound"];

function emptyBlock(): DateLobBlockRow {
  return { codSale: 0, codRevenue: 0, paidSale: 0, paidRevenue: 0, totalSale: 0, totalRevenue: 0, codPct: 0, paidPct: 0 };
}
function finalizeBlock(b: DateLobBlockRow): DateLobBlockRow {
  return { ...b, codPct: pct(b.codSale, b.codSale + b.paidSale), paidPct: pct(b.paidSale, b.codSale + b.paidSale) };
}
function addBlock(dst: DateLobBlockRow, src: { codSale: number; codRevenue: number; paidSale: number; paidRevenue: number; totalSale: number; totalRevenue: number }) {
  dst.codSale += src.codSale; dst.codRevenue += src.codRevenue;
  dst.paidSale += src.paidSale; dst.paidRevenue += src.paidRevenue;
  dst.totalSale += src.totalSale; dst.totalRevenue += src.totalRevenue;
}

interface DateLobRawRow extends RowDataPacket {
  d: string; lob: string | null;
  cod_n: number; cod_rev: string | null; paid_n: number; paid_rev: string | null;
  total_n: number; total_rev: string | null; rto_n: number; rto_rev: string | null;
}

export async function getBellavitaSaleDateLobMatrix(fromInput: string, toInput: string): Promise<BellavitaDateLobMatrixData> {
  const fallback = currentMonthRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  const deduped = dedupedSaleSql();

  const [rows] = await db.execute<DateLobRawRow[]>(
    `SELECT DATE(ds.\`Date\`) AS d, ds.lob AS lob,
       SUM(CASE WHEN ds.payment_status = 'cod' THEN 1 ELSE 0 END) AS cod_n,
       SUM(CASE WHEN ds.payment_status = 'cod' THEN CAST(ds.amount AS DECIMAL(14,2)) ELSE 0 END) AS cod_rev,
       SUM(CASE WHEN ds.payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_n,
       SUM(CASE WHEN ds.payment_status = 'paid' THEN CAST(ds.amount AS DECIMAL(14,2)) ELSE 0 END) AS paid_rev,
       COUNT(*) AS total_n, SUM(CAST(ds.amount AS DECIMAL(14,2))) AS total_rev,
       SUM(CASE WHEN ds.final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_n,
       SUM(CASE WHEN ds.final_status = 'RTO' THEN CAST(ds.amount AS DECIMAL(14,2)) ELSE 0 END) AS rto_rev
     FROM ${deduped}
     WHERE ds.lob IS NOT NULL AND ds.lob != ''
     GROUP BY DATE(ds.\`Date\`), ds.lob
     ORDER BY d ASC`,
    [from, to],
  );

  const lobsSeen = new Set<string>(rows.map((r) => r.lob || "Unknown"));
  const lobOrder = [...LOB_DISPLAY_ORDER.filter((l) => lobsSeen.has(l)), ...[...lobsSeen].filter((l) => !LOB_DISPLAY_ORDER.includes(l)).sort()];

  const byDate = new Map<string, DateLobMatrixRow>();
  for (const r of rows) {
    const date = String(r.d);
    const lob = r.lob || "Unknown";
    let row = byDate.get(date);
    if (!row) {
      row = { date, lobs: {}, overall: emptyBlock(), rtoCount: 0, rtoRevenue: 0, netSaleCount: 0, netSaleRevenue: 0 };
      byDate.set(date, row);
    }
    const block: DateLobBlockRow = {
      codSale: num(r.cod_n), codRevenue: num(r.cod_rev),
      paidSale: num(r.paid_n), paidRevenue: num(r.paid_rev),
      totalSale: num(r.total_n), totalRevenue: num(r.total_rev),
      codPct: 0, paidPct: 0,
    };
    row.lobs[lob] = finalizeBlock(block);
    addBlock(row.overall, block);
    row.rtoCount += num(r.rto_n);
    row.rtoRevenue += num(r.rto_rev);
    row.netSaleCount += num(r.total_n) - num(r.rto_n);
    row.netSaleRevenue += num(r.total_rev) - num(r.rto_rev);
  }
  for (const row of byDate.values()) row.overall = finalizeBlock(row.overall);

  const rowsOut = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const grandTotal: DateLobMatrixRow = { date: "Grand Total", lobs: {}, overall: emptyBlock(), rtoCount: 0, rtoRevenue: 0, netSaleCount: 0, netSaleRevenue: 0 };
  for (const lob of lobOrder) grandTotal.lobs[lob] = emptyBlock();
  for (const row of rowsOut) {
    for (const lob of lobOrder) if (row.lobs[lob]) addBlock(grandTotal.lobs[lob], row.lobs[lob]);
    addBlock(grandTotal.overall, row.overall);
    grandTotal.rtoCount += row.rtoCount; grandTotal.rtoRevenue += row.rtoRevenue;
    grandTotal.netSaleCount += row.netSaleCount; grandTotal.netSaleRevenue += row.netSaleRevenue;
  }
  for (const lob of lobOrder) grandTotal.lobs[lob] = finalizeBlock(grandTotal.lobs[lob]);
  grandTotal.overall = finalizeBlock(grandTotal.overall);

  return { from, to, lobOrder, rows: rowsOut, grandTotal };
}
