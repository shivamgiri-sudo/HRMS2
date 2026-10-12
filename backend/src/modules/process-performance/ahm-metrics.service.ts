import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * AHM process-grain KPI metrics for Process Operations.
 *
 * One value per survey day per metric, written to process_metric_actual (source 'connector') from
 * db_masmis.ahm_dump_raw. Definitions match ahm-dashboard.service.ts exactly so the tiles and the dashboard agree:
 * an order is a distinct Sales No (it repeats per SKU line), Delivered = Last Status 'Delivered', Survey Taken =
 * Last disposition Status 'Survey Taken', value = qty x SKU MRP.
 *
 * Percent metrics keep their parts: rollup_numerator is stored scaled (x100) and rollup_denominator as counted, so a
 * period figure is SUM(numerator)/SUM(denominator), never a mean of daily rates (see 1685_process_metric_rollup_inputs).
 * A day with no orders writes no row at all -- never a zero standing in for "nothing was measured".
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type AhmMetricRow = {
  metricKey: string; date: string; value: number; numerator: number | null; denominator: number | null;
};

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const num = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };

/** Pure: one day's aggregate row -> the metric rows to write. Empty when the day had no orders. */
export function ahmMetricRows(date: string, r: Record<string, unknown>): AhmMetricRow[] {
  const orders = num(r.orders);
  if (orders <= 0) return [];
  const orderQty = num(r.order_qty), salesQty = num(r.sales_qty), delivered = num(r.delivered);
  const surveyTaken = num(r.survey_taken), agents = num(r.telesales_agents);
  const out: AhmMetricRow[] = [
    { metricKey: "AHM_ORDERS", date, value: orders, numerator: null, denominator: null },
    { metricKey: "AHM_OUTLETS", date, value: num(r.outlets), numerator: null, denominator: null },
    { metricKey: "AHM_ORDER_QTY", date, value: orderQty, numerator: null, denominator: null },
    { metricKey: "AHM_ORDER_VALUE", date, value: r4(num(r.order_value)), numerator: null, denominator: null },
    { metricKey: "AHM_DELIVERED_PCT", date, value: r4((delivered / orders) * 100), numerator: delivered * 100, denominator: orders },
    { metricKey: "AHM_SURVEY_TAKEN_PCT", date, value: r4((surveyTaken / orders) * 100), numerator: surveyTaken * 100, denominator: orders },
  ];
  if (orderQty > 0) out.push({ metricKey: "AHM_FILL_RATE_PCT", date, value: r4((salesQty / orderQty) * 100), numerator: salesQty * 100, denominator: orderQty });
  if (agents > 0) {
    out.push({ metricKey: "AHM_TELESALES_AGENTS", date, value: agents, numerator: null, denominator: null });
    out.push({ metricKey: "AHM_ORDERS_PER_AGENT", date, value: r4(orders / agents), numerator: orders, denominator: agents });
  }
  return out;
}

export async function syncAhmProcessMetrics(from: string, to: string): Promise<{ days: number; written: number; skipped?: string }> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new Error("from/to must be YYYY-MM-DD");
  const [pm] = await db.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE process_code = 'AHM' AND active_status = 1 LIMIT 1`);
  const processId = (pm as RowDataPacket[])[0]?.id ? String((pm as RowDataPacket[])[0].id) : null;
  if (!processId) return { days: 0, written: 0, skipped: "no active AHM process" };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(survey_date, '%Y-%m-%d') AS d,
            COUNT(DISTINCT sales_no) AS orders, COUNT(DISTINCT outlet_id) AS outlets,
            SUM(survey_qty) AS order_qty, SUM(sales_qty) AS sales_qty, SUM(survey_qty * COALESCE(sku_mrp, 0)) AS order_value,
            COUNT(DISTINCT CASE WHEN last_status = 'Delivered' THEN sales_no END) AS delivered,
            COUNT(DISTINCT CASE WHEN last_disposition_status = 'Survey Taken' THEN sales_no END) AS survey_taken,
            COUNT(DISTINCT NULLIF(telesales_id, '')) AS telesales_agents
       FROM db_masmis.ahm_dump_raw
      WHERE survey_date >= ? AND survey_date < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY d`, [from, to]);

  let written = 0;
  for (const r of rows as RowDataPacket[]) {
    const date = String(r.d);
    for (const m of ahmMetricRows(date, r)) {
      await db.execute(
        `INSERT INTO process_metric_actual
           (id, process_id, metric_key, score_date, actual_value, source, source_connector_key, note, rollup_numerator, rollup_denominator)
         VALUES (UUID(), ?, ?, ?, ?, 'connector', NULL, 'AHM dump roll-up', ?, ?)
         ON DUPLICATE KEY UPDATE actual_value = VALUES(actual_value), source = 'connector', note = VALUES(note),
           rollup_numerator = VALUES(rollup_numerator), rollup_denominator = VALUES(rollup_denominator)`,
        [processId, m.metricKey, m.date, m.value, m.numerator, m.denominator]);
      written++;
    }
  }
  return { days: (rows as RowDataPacket[]).length, written };
}

/** Last `days` days up to today -- the window Process Operations reads. */
export function recentRange(days = 45): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const to = new Date(); const from = new Date(); from.setDate(from.getDate() - days);
  return { from: ymd(from), to: ymd(to) };
}
