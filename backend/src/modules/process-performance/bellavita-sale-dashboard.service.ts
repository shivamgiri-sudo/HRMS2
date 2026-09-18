import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

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
export const LOB_TARGETS: Record<string, { target: number; note?: string }> = {
  Repeat: { target: 4_200_000 },
  Chat: { target: 5_400_000 },
  "Abandon Cart": { target: 1_026_564, note: "Target figure as supplied: \"this target for only 14\" (14 days or 14 agents -- not clarified)." },
  Inbound: { target: 239_400 },
};

export interface BellavitaSaleDashboardData {
  headline: {
    turnover: number;
    saleCount: number;
    prepaidPct: number;
    rtoPct: number;
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
  lobRevenue: Array<{
    lob: string;
    saleCount: number;
    turnover: number;
    target: number | null;
    achievementPct: number | null;
    targetNote?: string;
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
 * One row per bella_vita_order_id (MIN(id) as the representative),
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
      SELECT bella_vita_order_id, MIN(id) AS min_id
      FROM db_masmis.bb_sale
      WHERE \`Date\` >= ? AND \`Date\` < DATE_ADD(?, INTERVAL 1 DAY)
        AND calling_status = 'Sale Made'
        AND bella_vita_order_id IS NOT NULL AND bella_vita_order_id != ''
      GROUP BY bella_vita_order_id
    ) dk ON dk.min_id = s.id
  ) ds`;
}

export async function getBellavitaSaleDashboard(fromInput: string, toInput: string): Promise<BellavitaSaleDashboardData> {
  const fallback = currentMonthRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  // `Date` < the day AFTER `to`, so the end date is fully inclusive rather
  // than cutting off at midnight of that day.
  const range = [from, to];
  const deduped = dedupedSaleSql();

  const [[headlineRow]] = await db.execute<HeadlineRow[]>(
    `SELECT
       SUM(CAST(amount AS DECIMAL(14,2))) AS turnover,
       COUNT(*) AS sale_count,
       SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
       SUM(CASE WHEN payment_status = 'cod' THEN 1 ELSE 0 END) AS cod_count,
       SUM(CASE WHEN final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count,
       SUM(CASE WHEN final_status != 'RTO' THEN CAST(amount AS DECIMAL(14,2)) ELSE 0 END) AS net_turnover,
       SUM(CASE WHEN final_status != 'RTO' THEN 1 ELSE 0 END) AS net_sale_count
     FROM ${deduped}`,
    range,
  );

  const [[activeAgentsRow]] = await db.execute<ActiveAgentsRow[]>(
    `SELECT COUNT(DISTINCT noiid) AS active_agents
     FROM db_masmis.bb_apr
     WHERE report_date >= ? AND report_date < DATE_ADD(?, INTERVAL 1 DAY)`,
    range,
  );

  const [trendRows] = await db.execute<TrendRow[]>(
    `SELECT DATE(ds.\`Date\`) AS d,
       COUNT(*) AS sale_count,
       SUM(CAST(ds.amount AS DECIMAL(14,2))) AS turnover,
       SUM(CASE WHEN ds.payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
       SUM(CASE WHEN ds.payment_status = 'cod' THEN 1 ELSE 0 END) AS cod_count,
       SUM(CASE WHEN ds.final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count
     FROM ${deduped}
     GROUP BY DATE(ds.\`Date\`)
     ORDER BY d ASC`,
    range,
  );

  const [lobRows] = await db.execute<LobRow[]>(
    `SELECT ds.lob AS lob, COUNT(*) AS sale_count, SUM(CAST(ds.amount AS DECIMAL(14,2))) AS turnover,
       SUM(CASE WHEN ds.payment_status = 'cod' THEN 1 ELSE 0 END) AS cod_count,
       SUM(CASE WHEN ds.payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
       SUM(CASE WHEN ds.final_status = 'RTO' THEN CAST(ds.amount AS DECIMAL(14,2)) ELSE 0 END) AS rto_amount,
       SUM(CASE WHEN ds.final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count,
       SUM(CASE WHEN ds.final_status != 'RTO' THEN 1 ELSE 0 END) AS net_sale_count,
       SUM(CASE WHEN ds.final_status != 'RTO' THEN CAST(ds.amount AS DECIMAL(14,2)) ELSE 0 END) AS net_turnover
     FROM ${deduped}
     WHERE ds.lob IS NOT NULL AND ds.lob != ''
     GROUP BY ds.lob
     ORDER BY turnover DESC`,
    range,
  );

  const [stateRows] = await db.execute<StateRow[]>(
    `SELECT ds.state AS state, COUNT(*) AS sale_count, SUM(CAST(ds.amount AS DECIMAL(14,2))) AS turnover,
       SUM(CASE WHEN ds.final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count
     FROM ${deduped}
     WHERE ds.state IS NOT NULL AND ds.state != ''
     GROUP BY ds.state
     ORDER BY turnover DESC
     LIMIT 10`,
    range,
  );

  const [performerRows] = await db.execute<PerformerRow[]>(
    `SELECT ds.emp_id AS emp_id, MAX(ds.emp_name) AS emp_name, COUNT(*) AS sale_count,
       SUM(CAST(ds.amount AS DECIMAL(14,2))) AS turnover,
       SUM(CASE WHEN ds.final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count,
       SUM(CASE WHEN ds.payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
       MAX(ds.lob) AS lob
     FROM ${deduped}
     WHERE ds.emp_id IS NOT NULL AND ds.emp_id != ''
     GROUP BY ds.emp_id
     ORDER BY turnover DESC
     LIMIT 5`,
    range,
  );

  const [topRtoStateRows] = await db.execute<StateRow[]>(
    `SELECT ds.state AS state, COUNT(*) AS sale_count,
       SUM(CASE WHEN ds.final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count
     FROM ${deduped}
     WHERE ds.state IS NOT NULL AND ds.state != ''
     GROUP BY ds.state
     HAVING COUNT(*) >= 5
     ORDER BY (SUM(CASE WHEN ds.final_status = 'RTO' THEN 1 ELSE 0 END) / COUNT(*)) DESC
     LIMIT 5`,
    range,
  );

  const turnover = num(headlineRow?.turnover);
  const saleCount = num(headlineRow?.sale_count);
  const paidCount = num(headlineRow?.paid_count);
  const codCount = num(headlineRow?.cod_count);
  const rtoCount = num(headlineRow?.rto_count);

  const lobRevenue = lobRows.map((r) => {
    const lob = r.lob || "Unknown";
    const turnoverVal = num(r.turnover);
    const saleCountVal = num(r.sale_count);
    const codCountVal = num(r.cod_count);
    const paidCountVal = num(r.paid_count);
    const rtoCountVal = num(r.rto_count);
    const targetInfo = LOB_TARGETS[lob];
    return {
      lob,
      saleCount: saleCountVal,
      turnover: turnoverVal,
      target: targetInfo?.target ?? null,
      achievementPct: targetInfo ? pct(turnoverVal, targetInfo.target) : null,
      targetNote: targetInfo?.note,
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
      rtoPct: pct(rtoCount, saleCount),
      aov: saleCount > 0 ? Math.round((turnover / saleCount) * 100) / 100 : 0,
      activeAgents: num(activeAgentsRow?.active_agents),
      netTurnover: num(headlineRow?.net_turnover),
      netSaleCount: num(headlineRow?.net_sale_count),
    },
    from,
    to,
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
