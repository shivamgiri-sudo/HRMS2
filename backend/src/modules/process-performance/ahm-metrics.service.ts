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
  const surveyTaken = num(r.survey_taken), agents = num(r.telesales_agents), lines = num(r.line_count);
  const out: AhmMetricRow[] = [
    { metricKey: "AHM_ORDERS", date, value: orders, numerator: null, denominator: null },
    { metricKey: "AHM_OUTLETS", date, value: num(r.outlets), numerator: null, denominator: null },
    { metricKey: "AHM_ORDER_QTY", date, value: orderQty, numerator: null, denominator: null },
    { metricKey: "AHM_ORDER_VALUE", date, value: r4(num(r.order_value)), numerator: null, denominator: null },
    { metricKey: "AHM_DELIVERED_PCT", date, value: r4((delivered / orders) * 100), numerator: delivered * 100, denominator: orders },
    { metricKey: "AHM_SURVEY_TAKEN_PCT", date, value: r4((surveyTaken / orders) * 100), numerator: surveyTaken * 100, denominator: orders },
  ];
  if (lines > 0) {
    out.push({ metricKey: "AHM_LINES_CUT", date, value: lines, numerator: null, denominator: null });
    out.push({ metricKey: "AHM_LINES_PER_ORDER", date, value: r4(lines / orders), numerator: lines, denominator: orders });
  }
  if (orderQty > 0) out.push({ metricKey: "AHM_FILL_RATE_PCT", date, value: r4((salesQty / orderQty) * 100), numerator: salesQty * 100, denominator: orderQty });
  if (agents > 0) {
    out.push({ metricKey: "AHM_TELESALES_AGENTS", date, value: agents, numerator: null, denominator: null });
    out.push({ metricKey: "AHM_ORDERS_PER_AGENT", date, value: r4(orders / agents), numerator: orders, denominator: agents });
  }
  return out;
}

/**
 * Pure: one day's call-log aggregate -> EC / PC / Incoming rows. Each rate's denominator is only the calls the file gave
 * evidence for (is_connected / is_productive / is_incoming not NULL), so an unclassified call never counts as a miss.
 */
export function ahmCallMetricRows(date: string, r: Record<string, unknown>): AhmMetricRow[] {
  const calls = num(r.calls);
  if (calls <= 0) return [];
  const out: AhmMetricRow[] = [{ metricKey: "AHM_CALLS", date, value: calls, numerator: null, denominator: null }];
  const rate = (key: string, part: unknown, whole: unknown) => {
    const w = num(whole);
    if (w > 0) out.push({ metricKey: key, date, value: r4((num(part) / w) * 100), numerator: num(part) * 100, denominator: w });
  };
  rate("AHM_EC_PCT", r.connected, r.connected_known);
  rate("AHM_PC_PCT", r.productive, r.productive_known);
  rate("AHM_INCOMING_PCT", r.incoming, r.incoming_known);
  return out;
}

async function writeRows(processId: string, rows: AhmMetricRow[], note: string): Promise<number> {
  for (const m of rows) {
    await db.execute(
      `INSERT INTO process_metric_actual
         (id, process_id, metric_key, score_date, actual_value, source, source_connector_key, note, rollup_numerator, rollup_denominator)
       VALUES (UUID(), ?, ?, ?, ?, 'connector', NULL, ?, ?, ?)
       ON DUPLICATE KEY UPDATE actual_value = VALUES(actual_value), source = 'connector', note = VALUES(note),
         rollup_numerator = VALUES(rollup_numerator), rollup_denominator = VALUES(rollup_denominator)`,
      [processId, m.metricKey, m.date, m.value, note, m.numerator, m.denominator]);
  }
  return rows.length;
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
            COUNT(DISTINCT NULLIF(telesales_id, '')) AS telesales_agents,
            COUNT(DISTINCT CONCAT(sales_no, '|', product_code)) AS line_count
       FROM db_masmis.ahm_dump_raw
      WHERE survey_date >= ? AND survey_date < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY d`, [from, to]);

  let written = 0;
  for (const r of rows as RowDataPacket[]) written += await writeRows(processId, ahmMetricRows(String(r.d), r), "AHM dump roll-up");

  // Call-attempt log: absent until the table exists / a file has been uploaded, which is not an error.
  try {
    const [calls] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(call_date, '%Y-%m-%d') AS d, COUNT(*) AS calls,
              SUM(is_connected = 1) AS connected, SUM(is_connected IS NOT NULL) AS connected_known,
              SUM(is_productive = 1) AS productive, SUM(is_productive IS NOT NULL) AS productive_known,
              SUM(is_incoming = 1) AS incoming, SUM(is_incoming IS NOT NULL) AS incoming_known
         FROM ahm_call_log WHERE call_date >= ? AND call_date <= ? GROUP BY d`, [from, to]);
    for (const r of calls as RowDataPacket[]) written += await writeRows(processId, ahmCallMetricRows(String(r.d), r), "AHM call log roll-up");
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "ER_NO_SUCH_TABLE") throw err;
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
