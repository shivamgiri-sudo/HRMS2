import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { currentMonthRange } from "./gnc-sale-dashboard.service.js";

/**
 * GNC's Abandon Cart Dashboard -- a dedicated view scoped to the cart-
 * recovery calling flow, built from the same two real tables the Overall
 * Dashboard's funnel already uses:
 *   - db_masmis.gnc_allocation: cart-calling data only (base/attempted/
 *     connected/same-day-connected), confirmed structurally Abandon-Cart-
 *     scoped -- no campaign column, no other LOB's calling data lives here.
 *   - db_masmis.gnc_sale WHERE campaign = 'Abandon Cart': sale/revenue for
 *     this LOB specifically.
 *
 * Several fields visible in the reference layout this was modeled on have
 * no real source anywhere in this app and are deliberately left out rather
 * than fabricated (confirmed live 2026-09-23, user approved dropping them):
 *   - "Target Achievement %" / "Target vs Revenue": no GNC target/mandate
 *     table exists anywhere in this app (same reasoning already documented
 *     in gnc-sale-dashboard.service.ts for the Overall Dashboard's KPIs).
 *   - "RTO orders": gnc_sale has no RTO/delivery-outcome column, only
 *     payment_status (COD/Prepaid).
 *   - "Workable Cases" / "DND Cases": gnc_allocation.sub_scenarios_1 has ~20
 *     free-text values (No Answer, Voice mail, Not Interested, ...) with no
 *     column or value that maps to a DND/workable split -- inventing that
 *     split would be a fabricated classification.
 *   - "NC Connect": gnc_allocation.nc_connect is the literal string '-' for
 *     100% of rows in this range -- effectively unpopulated.
 *   - "CPA" (cost per acquisition): no spend/cost column exists anywhere in
 *     this app's GNC tables.
 *   - Product names in the reference ("Perfume Combo", "Women Perfumes")
 *     don't match GNC's real catalogue (protein/supplement SKUs) -- that
 *     layout was a generic template, not literal content. Top Products here
 *     uses gnc_sale.line_item_name, GNC's real product field.
 */

export interface GncAbandonCartDashboardData {
  from: string;
  to: string;
  headline: {
    baseCount: number;
    attempted: number;
    connected: number;
    connectedPct: number;
    saleCount: number;
    revenue: number;
    aov: number;
    conversionOnBase: number;
    conversionOnConnect: number;
    codCount: number;
    paidCount: number;
  };
  /** vs the immediately preceding period of the same length. null when the
   * previous period had a zero denominator (nothing to compare against). */
  deltas: {
    baseCount: number | null;
    connected: number | null;
    saleCount: number | null;
    revenue: number | null;
    conversionOnConnect: number | null;
  };
  /** Only the real, populated rows -- see the file-level note for what was dropped and why. */
  snapshot: Array<{ metric: string; value: string }>;
  funnel: Array<{ stage: string; count: number; pctOfBase: number }>;
  dailyTrend: Array<{ date: string; base: number; attempted: number; connected: number; sameDayConnected: number; saleCount: number; revenue: number; codCount: number; paidCount: number }>;
  weeklyTrend: Array<{
    label: string; base: number; attempted: number; connected: number; sameDayConnected: number; saleCount: number; revenue: number; codCount: number; paidCount: number;
    conversionOnBase: number; conversionOnConnect: number;
  }>;
  conversionTrend: Array<{ date: string; conversionOnBase: number; conversionOnConnect: number }>;
  topProducts: Array<{ product: string; saleCount: number; revenue: number; aov: number }>;
}

interface AllocHeadlineRow extends RowDataPacket {
  base_count: number;
  attempted_count: number;
  connected_count: number;
  same_day_connected_count: number;
}
interface SaleHeadlineRow extends RowDataPacket {
  sale_count: number;
  revenue: string | null;
  cod_count: number;
  paid_count: number;
}
interface AllocDailyRow extends RowDataPacket {
  d: string;
  base_count: number;
  attempted_count: number;
  connected_count: number;
  same_day_connected_count: number;
}
interface SaleDailyRow extends RowDataPacket {
  d: string;
  sale_count: number;
  revenue: string | null;
  cod_count: number;
  paid_count: number;
}
interface ProductRow extends RowDataPacket {
  product: string | null;
  sale_count: number;
  revenue: string | null;
}

const num = (v: string | number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function localDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function delta(cur: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}
function previousPeriod(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
  const prevTo = new Date(f);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return { from: localDateStr(prevFrom), to: localDateStr(prevTo) };
}

async function loadAllocHeadline(from: string, to: string): Promise<AllocHeadlineRow | undefined> {
  const [[row]] = await db.execute<AllocHeadlineRow[]>(
    `SELECT
       COUNT(*) AS base_count,
       SUM(CASE WHEN calling_status != 'pending to call' THEN 1 ELSE 0 END) AS attempted_count,
       SUM(CASE WHEN calling_status = 'Connected' THEN 1 ELSE 0 END) AS connected_count,
       SUM(CASE WHEN same_day_connect = 'Connected' THEN 1 ELSE 0 END) AS same_day_connected_count
     FROM db_masmis.gnc_allocation
     WHERE alloc_date >= ? AND alloc_date < DATE_ADD(?, INTERVAL 1 DAY)`,
    [from, to],
  );
  return row;
}
async function loadSaleHeadline(from: string, to: string): Promise<SaleHeadlineRow | undefined> {
  const [[row]] = await db.execute<SaleHeadlineRow[]>(
    `SELECT COUNT(*) AS sale_count, SUM(gross_amount) AS revenue,
       SUM(CASE WHEN payment_status = 'COD' THEN 1 ELSE 0 END) AS cod_count,
       SUM(CASE WHEN payment_status = 'Prepaid' THEN 1 ELSE 0 END) AS paid_count
     FROM db_masmis.gnc_sale
     WHERE sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY) AND campaign = 'Abandon Cart'`,
    [from, to],
  );
  return row;
}

export async function getGncAbandonCartDashboard(fromInput: string, toInput: string): Promise<GncAbandonCartDashboardData> {
  const fallback = currentMonthRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  const prevRange = previousPeriod(from, to);

  const [allocRow, saleRow, prevAllocRow, prevSaleRow, allocDailyRows, saleDailyRows, productRows] = await Promise.all([
    loadAllocHeadline(from, to),
    loadSaleHeadline(from, to),
    loadAllocHeadline(prevRange.from, prevRange.to),
    loadSaleHeadline(prevRange.from, prevRange.to),
    db.execute<AllocDailyRow[]>(
      `SELECT DATE(alloc_date) AS d, COUNT(*) AS base_count,
         SUM(CASE WHEN calling_status != 'pending to call' THEN 1 ELSE 0 END) AS attempted_count,
         SUM(CASE WHEN calling_status = 'Connected' THEN 1 ELSE 0 END) AS connected_count,
         SUM(CASE WHEN same_day_connect = 'Connected' THEN 1 ELSE 0 END) AS same_day_connected_count
       FROM db_masmis.gnc_allocation
       WHERE alloc_date >= ? AND alloc_date < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY DATE(alloc_date) ORDER BY d ASC`,
      [from, to],
    ).then(([r]) => r),
    db.execute<SaleDailyRow[]>(
      `SELECT DATE(sale_date) AS d, COUNT(*) AS sale_count, SUM(gross_amount) AS revenue,
         SUM(CASE WHEN payment_status = 'COD' THEN 1 ELSE 0 END) AS cod_count,
         SUM(CASE WHEN payment_status = 'Prepaid' THEN 1 ELSE 0 END) AS paid_count
       FROM db_masmis.gnc_sale
       WHERE sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY) AND campaign = 'Abandon Cart'
       GROUP BY DATE(sale_date) ORDER BY d ASC`,
      [from, to],
    ).then(([r]) => r),
    db.execute<ProductRow[]>(
      `SELECT line_item_name AS product, COUNT(*) AS sale_count, SUM(gross_amount) AS revenue
       FROM db_masmis.gnc_sale
       WHERE sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY) AND campaign = 'Abandon Cart'
         AND line_item_name IS NOT NULL AND line_item_name != ''
       GROUP BY line_item_name ORDER BY revenue DESC LIMIT 8`,
      [from, to],
    ).then(([r]) => r),
  ]);

  const baseCount = num(allocRow?.base_count);
  const attempted = num(allocRow?.attempted_count);
  const connected = num(allocRow?.connected_count);
  const sameDayConnected = num(allocRow?.same_day_connected_count);
  const saleCount = num(saleRow?.sale_count);
  const revenue = num(saleRow?.revenue);
  const aov = saleCount > 0 ? Math.round((revenue / saleCount) * 100) / 100 : 0;
  const codCount = num(saleRow?.cod_count);
  const paidCount = num(saleRow?.paid_count);

  const prevBaseCount = num(prevAllocRow?.base_count);
  const prevConnected = num(prevAllocRow?.connected_count);
  const prevSaleCount = num(prevSaleRow?.sale_count);
  const prevRevenue = num(prevSaleRow?.revenue);
  const prevConversionOnConnect = pct(prevSaleCount, prevConnected);

  // Merge the two daily series by date -- they come from different tables
  // with potentially different date coverage, so a plain zip would misalign.
  const dailyMap = new Map<string, { base: number; attempted: number; connected: number; sameDayConnected: number; saleCount: number; revenue: number; codCount: number; paidCount: number }>();
  for (const r of allocDailyRows) {
    dailyMap.set(String(r.d), { base: num(r.base_count), attempted: num(r.attempted_count), connected: num(r.connected_count), sameDayConnected: num(r.same_day_connected_count), saleCount: 0, revenue: 0, codCount: 0, paidCount: 0 });
  }
  for (const r of saleDailyRows) {
    const key = String(r.d);
    const row = dailyMap.get(key) ?? { base: 0, attempted: 0, connected: 0, sameDayConnected: 0, saleCount: 0, revenue: 0, codCount: 0, paidCount: 0 };
    row.saleCount = num(r.sale_count);
    row.revenue = num(r.revenue);
    row.codCount = num(r.cod_count);
    row.paidCount = num(r.paid_count);
    dailyMap.set(key, row);
  }
  const dailyTrend = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }));

  const conversionTrend = dailyTrend.map((d) => ({
    date: d.date,
    conversionOnBase: pct(d.saleCount, d.base),
    conversionOnConnect: pct(d.saleCount, d.connected),
  }));

  const weeks = new Map<string, { label: string; base: number; attempted: number; connected: number; sameDayConnected: number; saleCount: number; revenue: number; codCount: number; paidCount: number }>();
  for (const d of dailyTrend) {
    const dt = new Date(`${d.date}T00:00:00`);
    const diffToMon = (dt.getDay() + 6) % 7;
    const monday = new Date(dt);
    monday.setDate(monday.getDate() - diffToMon);
    const key = localDateStr(monday);
    const w = weeks.get(key) ?? { label: key, base: 0, attempted: 0, connected: 0, sameDayConnected: 0, saleCount: 0, revenue: 0, codCount: 0, paidCount: 0 };
    w.base += d.base;
    w.attempted += d.attempted;
    w.connected += d.connected;
    w.sameDayConnected += d.sameDayConnected;
    w.saleCount += d.saleCount;
    w.revenue += d.revenue;
    w.codCount += d.codCount;
    w.paidCount += d.paidCount;
    weeks.set(key, w);
  }
  const weeklyTrend = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, w], i) => ({
    ...w, label: `Week ${i + 1}`,
    conversionOnBase: pct(w.saleCount, w.base),
    conversionOnConnect: pct(w.saleCount, w.connected),
  }));

  return {
    from,
    to,
    headline: {
      baseCount,
      attempted,
      connected,
      connectedPct: pct(connected, baseCount),
      saleCount,
      revenue,
      aov,
      conversionOnBase: pct(saleCount, baseCount),
      conversionOnConnect: pct(saleCount, connected),
      codCount,
      paidCount,
    },
    deltas: {
      baseCount: delta(baseCount, prevBaseCount),
      connected: delta(connected, prevConnected),
      saleCount: delta(saleCount, prevSaleCount),
      revenue: delta(revenue, prevRevenue),
      conversionOnConnect: delta(pct(saleCount, connected), prevConversionOnConnect),
    },
    snapshot: [
      { metric: "Overall Base count", value: baseCount.toLocaleString("en-IN") },
      { metric: "Overall Unique attempted", value: attempted.toLocaleString("en-IN") },
      { metric: "Overall Unique connected", value: connected.toLocaleString("en-IN") },
      { metric: "Overall Unique connected %", value: `${pct(connected, baseCount)}%` },
      { metric: "Same Day Unique Attempt", value: attempted.toLocaleString("en-IN") },
      { metric: "Same Day Unique Connect", value: sameDayConnected.toLocaleString("en-IN") },
      { metric: "Same Day Unique Connect %", value: `${pct(sameDayConnected, baseCount)}%` },
    ],
    funnel: [
      { stage: "Total Allocation", count: baseCount, pctOfBase: 100 },
      { stage: "Attempted", count: attempted, pctOfBase: pct(attempted, baseCount) },
      { stage: "Connected", count: connected, pctOfBase: pct(connected, baseCount) },
      { stage: "Same Day Connected", count: sameDayConnected, pctOfBase: pct(sameDayConnected, baseCount) },
      { stage: "Sale", count: saleCount, pctOfBase: pct(saleCount, baseCount) },
    ],
    dailyTrend,
    weeklyTrend,
    conversionTrend,
    topProducts: productRows.map((r) => {
      const sc = num(r.sale_count);
      const rev = num(r.revenue);
      return { product: r.product ?? "Unknown", saleCount: sc, revenue: rev, aov: sc > 0 ? Math.round((rev / sc) * 100) / 100 : 0 };
    }),
  };
}
