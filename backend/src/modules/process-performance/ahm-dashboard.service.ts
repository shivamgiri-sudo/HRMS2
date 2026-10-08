import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * AHM -- a telesales-to-delivery operation (one row per outlet/SKU order line in
 * db_masmis.ahm_dump_raw, sql/1875): a Telesales agent takes the survey/order by phone, a
 * Delivery agent ("Delivered By") fulfils it, and each order carries a Last disposition
 * Status (Survey Taken, Pending, Switched Off, ...) and a Last Status (Delivered, Invoiced, ...).
 *
 * Definitions (read from the raw data, not guessed):
 * - An "order" = one Sales No; it repeats once per SKU line, so every grouping below counts
 *   COUNT(DISTINCT sales_no) for orders and COUNT(DISTINCT CASE WHEN ... THEN sales_no END)
 *   for a status/disposition split, never a per-line count (which would over-count an
 *   order with several SKU lines).
 * - Order Qty / Sales Qty = SUM(survey_qty) / SUM(sales_qty) -- the paid quantities. Offer
 *   (free/promotional) quantities are surfaced separately, never folded into these.
 * - Order Value / Sales Value = qty x sku_mrp, summed.
 * - Delivered % = orders whose Last Status = 'Delivered' / all orders in range. Every other
 *   Last Status value (Invoiced, or anything else actually present) is "Not Delivered" --
 *   the status table lists every value seen, so nothing is hidden behind the binary split.
 * - "Salesman" is the field/distributor rep who enlists the outlet -- a different role from
 *   Telesales (the call-centre agent this HRMS tracks) and Delivered By (the delivery
 *   agent). Agent-wise performance below is Telesales-id; Salesman is shown only as context.
 *
 * NOT covered here (flagged, not guessed): EC%/PC%/Lines Cut/Incoming% (the reference "GPI
 * Daily Performance Tracker" workbook's own Performance/DATA/CALL sheets) come from a
 * call-attempt log this raw order/survey export does not carry -- a different source table
 * would be needed before those KPIs could be built honestly. DPTS's NBO Billed/Unbilled
 * roster is a different, richer per-outlet master (coverage/tagging/black-outlet status)
 * this export also does not carry.
 */

const TABLE = "db_masmis.ahm_dump_raw";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AhmFilters { from: string; to: string; region: "MP" | "MM" | null }

export function currentMonthRange(): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
}

export function normalizeAhmFilters(input: { from?: unknown; to?: unknown; region?: unknown }): AhmFilters {
  const fallback = currentMonthRange();
  const from = typeof input.from === "string" && DATE_RE.test(input.from) ? input.from : fallback.from;
  const to = typeof input.to === "string" && DATE_RE.test(input.to) ? input.to : fallback.to;
  const region = input.region === "MP" || input.region === "MM" ? input.region : null;
  return { from, to, region };
}

function where(f: AhmFilters, extra?: { sql: string; params: unknown[] }): { sql: string; params: unknown[] } {
  const parts = [`survey_date >= ?`, `survey_date < DATE_ADD(?, INTERVAL 1 DAY)`];
  const params: unknown[] = [f.from, f.to];
  if (f.region) { parts.push(`source_region = ?`); params.push(f.region); }
  if (extra) { parts.push(extra.sql); params.push(...extra.params); }
  return { sql: `WHERE ${parts.join(" AND ")}`, params };
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);

export interface AhmHeadline {
  outlets: number; orders: number;
  orderQty: number; orderOfferQty: number; salesQty: number; salesOfferQty: number;
  orderValue: number; salesValue: number; gapQty: number; gapPct: number;
  delivered: number; deliveredPct: number; telesalesAgents: number; deliveryAgents: number;
}
export interface AhmStatusRow { status: string; orders: number; pct: number }
export interface AhmDispositionRow { disposition: string; orders: number; pct: number }
export interface AhmHourRow { hour: number; orders: number; orderQty: number; delivered: number }
export interface AhmDailyRow { date: string; orders: number; orderQty: number; salesQty: number; gapPct: number; deliveredPct: number }
export interface AhmGroupRow { name: string; orders: number; outlets: number; orderQty: number; salesQty: number; gapPct: number; deliveredPct: number }
export interface AhmAgentRow { agent: string; outlets: number; orders: number; orderQty: number; salesQty: number; deliveredPct: number }
export interface AhmProductRow { name: string; orderQty: number; salesQty: number; orders: number }

export interface AhmDashboardData {
  from: string; to: string; region: "MP" | "MM" | null;
  headline: AhmHeadline;
  statuses: AhmStatusRow[];
  dispositions: AhmDispositionRow[];
  hourly: AhmHourRow[];
  daily: AhmDailyRow[];
  byZone: AhmGroupRow[];
  byTown: AhmGroupRow[];
  byTelesales: AhmAgentRow[];
  byDeliveredBy: AhmAgentRow[];
  byFranchise: AhmProductRow[];
  byCategory: AhmProductRow[];
  dataAvailable: boolean;
}

const COUNTERS = `
  COUNT(DISTINCT outlet_id) AS outlets,
  COUNT(DISTINCT sales_no) AS orders,
  SUM(survey_qty) AS order_qty,
  SUM(survey_offer_qty) AS order_offer_qty,
  SUM(sales_qty) AS sales_qty,
  SUM(sales_offer_qty) AS sales_offer_qty,
  SUM(survey_qty * COALESCE(sku_mrp, 0)) AS order_value,
  SUM(sales_qty * COALESCE(sku_mrp, 0)) AS sales_value,
  COUNT(DISTINCT CASE WHEN last_status = 'Delivered' THEN sales_no END) AS delivered`;

export async function getAhmDashboard(f: AhmFilters): Promise<AhmDashboardData> {
  const w = where(f);

  const [[headlineRow], statusRows, dispoRows, hourRows, dailyRows, zoneRows, townRows, tsRows, dbRows, franRows, catRows] =
    await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT ${COUNTERS},
                COUNT(DISTINCT telesales_id) AS telesales_agents,
                COUNT(DISTINCT delivered_by) AS delivery_agents
           FROM ${TABLE} ${w.sql}`, w.params).then(([r]) => r),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(last_status, ''), 'Unknown') AS status, COUNT(DISTINCT sales_no) AS orders
           FROM ${TABLE} ${w.sql} GROUP BY status ORDER BY orders DESC`, w.params),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(last_disposition_status, ''), 'Unknown') AS disposition, COUNT(DISTINCT sales_no) AS orders
           FROM ${TABLE} ${w.sql} GROUP BY disposition ORDER BY orders DESC`, w.params),
      db.execute<RowDataPacket[]>(
        `SELECT HOUR(survey_date) AS hour, COUNT(DISTINCT sales_no) AS orders, SUM(survey_qty) AS order_qty,
                COUNT(DISTINCT CASE WHEN last_status = 'Delivered' THEN sales_no END) AS delivered
           FROM ${TABLE} ${w.sql} GROUP BY hour ORDER BY hour`, w.params),
      db.execute<RowDataPacket[]>(
        `SELECT DATE(survey_date) AS d, COUNT(DISTINCT sales_no) AS orders, SUM(survey_qty) AS order_qty,
                SUM(sales_qty) AS sales_qty,
                COUNT(DISTINCT CASE WHEN last_status = 'Delivered' THEN sales_no END) AS delivered
           FROM ${TABLE} ${w.sql} GROUP BY d ORDER BY d`, w.params),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(zone, ''), 'Unmapped') AS name, ${COUNTERS}
           FROM ${TABLE} ${w.sql} GROUP BY name ORDER BY orders DESC LIMIT 60`, w.params),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(city_town, ''), 'Unmapped') AS name, ${COUNTERS}
           FROM ${TABLE} ${w.sql} GROUP BY name ORDER BY orders DESC LIMIT 100`, w.params),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(telesales_id, ''), 'Unmapped') AS agent, ${COUNTERS}
           FROM ${TABLE} ${w.sql} GROUP BY agent ORDER BY orders DESC LIMIT 200`, w.params),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(delivered_by, ''), 'Unmapped') AS agent, ${COUNTERS}
           FROM ${TABLE} ${w.sql} GROUP BY agent ORDER BY orders DESC LIMIT 200`, w.params),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(franchise, ''), 'Unmapped') AS name, COUNT(DISTINCT sales_no) AS orders,
                SUM(survey_qty) AS order_qty, SUM(sales_qty) AS sales_qty
           FROM ${TABLE} ${w.sql} GROUP BY name ORDER BY order_qty DESC LIMIT 30`, w.params),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(category, ''), 'Unmapped') AS name, COUNT(DISTINCT sales_no) AS orders,
                SUM(survey_qty) AS order_qty, SUM(sales_qty) AS sales_qty
           FROM ${TABLE} ${w.sql} GROUP BY name ORDER BY order_qty DESC LIMIT 30`, w.params),
    ]);

  const h = headlineRow ?? {};
  const orders = num(h.orders);
  const orderQty = num(h.order_qty);
  const salesQty = num(h.sales_qty);
  const gapQty = orderQty - salesQty;
  const delivered = num(h.delivered);
  const headline: AhmHeadline = {
    outlets: num(h.outlets), orders,
    orderQty, orderOfferQty: num(h.order_offer_qty), salesQty, salesOfferQty: num(h.sales_offer_qty),
    orderValue: num(h.order_value), salesValue: num(h.sales_value),
    gapQty, gapPct: pct(gapQty, orderQty),
    delivered, deliveredPct: pct(delivered, orders),
    telesalesAgents: num(h.telesales_agents), deliveryAgents: num(h.delivery_agents),
  };

  const statusTotal = statusRows[0].reduce((s, r) => s + num(r.orders), 0);
  const statuses: AhmStatusRow[] = statusRows[0].map((r) => ({
    status: String(r.status), orders: num(r.orders), pct: pct(num(r.orders), statusTotal),
  }));

  const dispoTotal = dispoRows[0].reduce((s, r) => s + num(r.orders), 0);
  const dispositions: AhmDispositionRow[] = dispoRows[0].map((r) => ({
    disposition: String(r.disposition), orders: num(r.orders), pct: pct(num(r.orders), dispoTotal),
  }));

  const hourly: AhmHourRow[] = hourRows[0].map((r) => ({
    hour: num(r.hour), orders: num(r.orders), orderQty: num(r.order_qty), delivered: num(r.delivered),
  }));

  const daily: AhmDailyRow[] = dailyRows[0].map((r) => {
    const oq = num(r.order_qty), sq = num(r.sales_qty), ord = num(r.orders);
    return {
      date: String(r.d).slice(0, 10), orders: ord, orderQty: oq, salesQty: sq,
      gapPct: pct(oq - sq, oq), deliveredPct: pct(num(r.delivered), ord),
    };
  });

  const groupRow = (r: RowDataPacket): AhmGroupRow => {
    const oq = num(r.order_qty), sq = num(r.sales_qty), ord = num(r.orders);
    return {
      name: String(r.name), orders: ord, outlets: num(r.outlets), orderQty: oq, salesQty: sq,
      gapPct: pct(oq - sq, oq), deliveredPct: pct(num(r.delivered), ord),
    };
  };
  const byZone = zoneRows[0].map(groupRow);
  const byTown = townRows[0].map(groupRow);

  const agentRow = (r: RowDataPacket): AhmAgentRow => ({
    agent: String(r.agent), outlets: num(r.outlets), orders: num(r.orders),
    orderQty: num(r.order_qty), salesQty: num(r.sales_qty), deliveredPct: pct(num(r.delivered), num(r.orders)),
  });
  const byTelesales = tsRows[0].map(agentRow);
  const byDeliveredBy = dbRows[0].map(agentRow);

  const productRow = (r: RowDataPacket): AhmProductRow => ({
    name: String(r.name), orderQty: num(r.order_qty), salesQty: num(r.sales_qty), orders: num(r.orders),
  });
  const byFranchise = franRows[0].map(productRow);
  const byCategory = catRows[0].map(productRow);

  return {
    from: f.from, to: f.to, region: f.region, headline, statuses, dispositions, hourly, daily,
    byZone, byTown, byTelesales, byDeliveredBy, byFranchise, byCategory,
    dataAvailable: headline.orders > 0,
  };
}

export type AhmDetailKind = "telesales" | "deliveredBy" | "zone" | "town";
const DETAIL_COLUMN: Record<AhmDetailKind, string> = {
  telesales: "telesales_id", deliveredBy: "delivered_by", zone: "zone", town: "city_town",
};

export interface AhmDetailRow extends RowDataPacket {
  id: string; sales_no: string; survey_date: Date | null; outlet_id: string; outlet_name: string | null;
  product_sku: string | null; survey_qty: number; sales_qty: number; sku_mrp: number | null;
  last_status: string | null; last_disposition_status: string | null; delivered_by: string | null;
  telesales_id: string | null; zone: string | null; city_town: string | null;
}

export interface AhmDetail {
  kind: AhmDetailKind; key: string; counts: AhmGroupRow;
  daily: AhmDailyRow[];
  dispositions: AhmDispositionRow[];
  rows: AhmDetailRow[]; rowsTotal: number;
}

/** Row drill-down (Drill-Down Mandate): the group's own totals, its daily trend, its
 * disposition split, and up to 200 of its real order-line rows for full-record detail. */
export async function getAhmDetail(kind: AhmDetailKind, key: string, f: AhmFilters): Promise<AhmDetail | null> {
  const col = DETAIL_COLUMN[kind];
  const w = where(f, { sql: `${col} = ?`, params: [key] });

  const [[countsRow], dailyRows, dispoRows, rows, [totalRow]] = await Promise.all([
    db.execute<RowDataPacket[]>(`SELECT ${COUNTERS} FROM ${TABLE} ${w.sql}`, w.params).then(([r]) => r),
    db.execute<RowDataPacket[]>(
      `SELECT DATE(survey_date) AS d, COUNT(DISTINCT sales_no) AS orders, SUM(survey_qty) AS order_qty,
              SUM(sales_qty) AS sales_qty, COUNT(DISTINCT CASE WHEN last_status = 'Delivered' THEN sales_no END) AS delivered
         FROM ${TABLE} ${w.sql} GROUP BY d ORDER BY d`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(last_disposition_status, ''), 'Unknown') AS disposition, COUNT(DISTINCT sales_no) AS orders
         FROM ${TABLE} ${w.sql} GROUP BY disposition ORDER BY orders DESC`, w.params),
    db.execute<AhmDetailRow[]>(
      `SELECT id, sales_no, survey_date, outlet_id, outlet_name, product_sku, survey_qty, sales_qty, sku_mrp,
              last_status, last_disposition_status, delivered_by, telesales_id, zone, city_town
         FROM ${TABLE} ${w.sql} ORDER BY survey_date DESC LIMIT 200`, w.params),
    db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${TABLE} ${w.sql}`, w.params).then(([r]) => r),
  ]);

  if (!countsRow || num(countsRow.orders) === 0) return null;

  const oq = num(countsRow.order_qty), sq = num(countsRow.sales_qty), ord = num(countsRow.orders);
  const counts: AhmGroupRow = {
    name: key, orders: ord, outlets: num(countsRow.outlets), orderQty: oq, salesQty: sq,
    gapPct: pct(oq - sq, oq), deliveredPct: pct(num(countsRow.delivered), ord),
  };
  const dailyTotal = (rs: RowDataPacket[]): AhmDailyRow[] => rs.map((r) => {
    const o = num(r.order_qty), s = num(r.sales_qty), n = num(r.orders);
    return { date: String(r.d).slice(0, 10), orders: n, orderQty: o, salesQty: s, gapPct: pct(o - s, o), deliveredPct: pct(num(r.delivered), n) };
  });
  const dispoTotal = dispoRows[0].reduce((s, r) => s + num(r.orders), 0);

  return {
    kind, key, counts,
    daily: dailyTotal(dailyRows[0]),
    dispositions: dispoRows[0].map((r) => ({ disposition: String(r.disposition), orders: num(r.orders), pct: pct(num(r.orders), dispoTotal) })),
    rows: rows[0], rowsTotal: num(totalRow.n),
  };
}
