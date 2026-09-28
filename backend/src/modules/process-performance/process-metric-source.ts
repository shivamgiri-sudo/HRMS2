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
  /**
   * True when `value` is the period's own ratio — SUM(numerator)/SUM(denominator)
   * across every counted day — rather than the mean of the daily rates. False
   * when any day lacked its parts, which is when the two numbers differ and the
   * caller should say which one it is showing.
   */
  exactRatio?: boolean;
  /**
   * The two numbers the period's ratio was built from, so a reader can be shown
   * "356 of 363" rather than a bare "98.1%" and judge whether the rate rests on
   * enough volume to mean anything.
   *
   * Both are SUMmed across the period, and BOTH ARE SCALED INTO THE METRIC UNIT
   * exactly as process_metric_actual stores them: for a percentage metric the
   * numerator is already multiplied by 100, so numerator/denominator reproduces
   * `value` directly. A caller wanting the underlying count must divide the
   * numerator by 100 for a percentage metric — printing it raw shows 35,600
   * answered calls out of 363 offered.
   *
   * Null when any counted day lacked its parts, which is the same condition that
   * makes exactRatio false: a partial sum belongs to neither method.
   */
  ratioNumerator?: number | null;
  ratioDenominator?: number | null;
}

/**
 * How a group of days becomes one figure.
 *
 * SUM for the volume family, because a month of a count is the month's total.
 * For everything else the default is AVG — but where a day recorded the two
 * numbers its ratio was built from, SUM(numerator)/SUM(denominator) is used
 * instead, which is the period's real rate rather than the mean of the daily
 * ones. Those differ whenever daily volumes differ, and the mean is the wrong
 * one: 864 answered of 882 offered is 97.96%, while the mean of the six daily
 * rates behind it is 98.20%.
 *
 * The COALESCE ordering matters. SUM over a group where some days have parts and
 * some do not would divide a partial numerator by a partial denominator and
 * produce a number belonging to neither method, so the exact form applies only
 * when EVERY counted day in the group carries both — that is what the
 * COUNT comparison enforces.
 */
function aggregateExpr(sumKeys: string[], exactRatio: boolean): string {
  const hasParts =
    "COUNT(rollup_denominator) = COUNT(actual_value) AND SUM(rollup_denominator) <> 0";
  const ratio = "SUM(rollup_numerator) / SUM(rollup_denominator)";

  if (!sumKeys.length) {
    return exactRatio ? `CASE WHEN ${hasParts} THEN ${ratio} ELSE AVG(actual_value) END` : "AVG(actual_value)";
  }

  const list = sumKeys.map(() => "?").join(",");
  if (!exactRatio) {
    return `CASE WHEN metric_key IN (${list}) THEN SUM(actual_value) ELSE AVG(actual_value) END`;
  }

  // A ratio is checked BEFORE the volume list, and the order is the whole point.
  // A metric's unit says what its number MEANS, not how it was derived: "average
  // minutes on shift" is a duration carrying the unit `count`, and summing it
  // reported 1,223 minutes — two days' averages added together, which is 20 hours
  // in a shift and obviously wrong. Anything that recorded a numerator and a
  // denominator is a ratio, whatever its unit claims, and a ratio is never a sum.
  return (
    `CASE WHEN ${hasParts} THEN ${ratio} ` +
    `WHEN metric_key IN (${list}) THEN SUM(actual_value) ` +
    `ELSE AVG(actual_value) END`
  );
}

/**
 * Whether 1685 has landed, so the exact form can be asked for at all. Cached,
 * like every other capability probe here: this file ships before its migration
 * is guaranteed to be applied, and naming a missing column turns a working
 * dashboard into a 500.
 */
let rollupColumnsPresent: boolean | null = null;
async function exactRatioSupported(): Promise<boolean> {
  if (rollupColumnsPresent !== null) return rollupColumnsPresent;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_metric_actual'
          AND COLUMN_NAME IN ('rollup_numerator', 'rollup_denominator')`,
    );
    rollupColumnsPresent = Number((rows as any[])[0]?.n ?? 0) === 2;
  } catch {
    rollupColumnsPresent = false;
  }
  return rollupColumnsPresent;
}

/** Exposed so a test, or a process that has just run 1685, can re-probe. */
export function resetExactRatioProbe(): void {
  rollupColumnsPresent = null;
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
  const agg = aggregateExpr(sumKeys, await exactRatioSupported());
  // sumKeys are bound first because the CASE expression appears in the SELECT
  // list, ahead of the WHERE clause's own placeholders.
  const params = [...sumKeys, processId, ...queryKeys, from, to];

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_key, ${agg} AS value, COUNT(actual_value) AS n${
      (await exactRatioSupported())
        // Whether every counted day carried its parts, which is exactly the
        // condition the exact form above requires. Reported so a caller can say
        // which of the two numbers it is showing instead of guessing.
        ? `, CASE WHEN COUNT(rollup_denominator) = COUNT(actual_value) AND SUM(rollup_denominator) <> 0
                  THEN 1 ELSE 0 END AS exact_ratio,
             CASE WHEN COUNT(rollup_denominator) = COUNT(actual_value) AND SUM(rollup_denominator) <> 0
                  THEN SUM(rollup_numerator) END AS ratio_numerator,
             CASE WHEN COUNT(rollup_denominator) = COUNT(actual_value) AND SUM(rollup_denominator) <> 0
                  THEN SUM(rollup_denominator) END AS ratio_denominator`
        : ", 0 AS exact_ratio, NULL AS ratio_numerator, NULL AS ratio_denominator"
    }
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
      exactRatio: Number(r.exact_ratio ?? 0) === 1,
      ratioNumerator: r.ratio_numerator == null ? null : Number(r.ratio_numerator),
      ratioDenominator: r.ratio_denominator == null ? null : Number(r.ratio_denominator),
    });
  }
  return out;
}
