import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Read side for process_metric_actual — the figures a client supplies by hand,
 * by spreadsheet, or out of their own database, for the metrics no internal
 * pipeline measures (Prepaid %, Net Revenue, ROI, the email/reshipment TATs,
 * PAN Submission, GS1's three TATs).
 *
 * This is the fourth source behind the same registry resolver contract as
 * kpi_daily_actual, the dialer CDR feed and the Shivamgiri audit pilot. The
 * caller passes which keys are summed rather than averaged, because the
 * registry — not this file — is what knows a metric's family.
 *
 * A metric with no reading is simply absent from the returned map. It is never
 * a zero: on this dashboard a zero means "measured zero", and inventing one is
 * the exact failure this whole feature exists to prevent. COUNT(actual_value)
 * rather than COUNT(*) is what makes a row entered with a blank value read as
 * no reading instead of as a measured zero.
 */

export interface ProcessMetricReading {
  value: number | null;
  count: number;
  trend: Array<{ period: string; value: number | null }>;
}

/** SUM for the volume family, AVG for everything else, decided per row. */
function aggregateExpr(sumKeys: string[]): string {
  if (!sumKeys.length) return "AVG(actual_value)";
  const list = sumKeys.map(() => "?").join(",");
  return `CASE WHEN metric_key IN (${list}) THEN SUM(actual_value) ELSE AVG(actual_value) END`;
}

/**
 * A metric can be stored under two different keys: the registry's own metricKey
 * when a person typed the figure in, or a kpi_metric_master.metric_code when a
 * KPI Studio process-grain definition computed it. `aliases` maps the second
 * back to the first so a caller asks once and gets an answer either way.
 */
export async function fetchProcessMetricValues(
  processId: string,
  metricKeys: string[],
  from: string,
  to: string,
  sumKeys: string[] = [],
  aliases: Record<string, string> = {},
): Promise<Map<string, ProcessMetricReading>> {
  const out = new Map<string, ProcessMetricReading>();
  if (!metricKeys.length) return out;

  // Query for both spellings, then fold the alias back onto the registry key so
  // the caller never has to know which one produced the number.
  const aliasToKey = new Map<string, string>();
  for (const [key, alias] of Object.entries(aliases)) {
    if (alias && alias !== key) aliasToKey.set(alias, key);
  }
  const queryKeys = [...new Set([...metricKeys, ...aliasToKey.keys()])];
  const canonical = (k: string) => aliasToKey.get(k) ?? k;

  const keyList = queryKeys.map(() => "?").join(",");
  const agg = aggregateExpr(sumKeys);
  // sumKeys are bound first because the CASE expression appears in the SELECT
  // list, ahead of the WHERE clause's own placeholders.
  const params = [...sumKeys, processId, ...queryKeys, from, to];

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_key, ${agg} AS value, COUNT(actual_value) AS n
       FROM process_metric_actual
      WHERE process_id = ?
        AND metric_key IN (${keyList})
        AND score_date BETWEEN ? AND ?
      GROUP BY metric_key`,
    params,
  );

  // DATE_FORMAT, not a JS-side slice of score_date: mysql2 hands back a bare
  // DATE column as a JS Date whose toString is "Fri Aug 01 2026 ...", which has
  // already produced one live bug in this module's sibling.
  const [trendRows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_key, DATE_FORMAT(score_date, '%Y-%m') AS period, ${agg} AS value
       FROM process_metric_actual
      WHERE process_id = ?
        AND metric_key IN (${keyList})
        AND score_date BETWEEN ? AND ?
      GROUP BY metric_key, period
      ORDER BY period ASC`,
    params,
  );

  const trendByKey = new Map<string, Array<{ period: string; value: number | null }>>();
  for (const r of trendRows) {
    const key = canonical(String(r.metric_key));
    const list = trendByKey.get(key) ?? [];
    list.push({ period: String(r.period), value: r.value == null ? null : Number(r.value) });
    trendByKey.set(key, list);
  }

  for (const r of rows) {
    const n = Number(r.n ?? 0);
    if (n === 0) continue;
    const key = canonical(String(r.metric_key));
    out.set(key, {
      value: r.value == null ? null : Number(r.value),
      count: n,
      trend: trendByKey.get(key) ?? [],
    });
  }
  return out;
}
