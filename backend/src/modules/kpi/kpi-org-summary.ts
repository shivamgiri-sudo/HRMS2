import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSourceFailure } from "../../shared/apiResponse.js";
import { buildScopeWhere } from "../../shared/dashboardScope.js";
import type { DashboardScope } from "../../shared/dashboardScope.js";
import { TtlCache } from "../../shared/ttlCache.js";

/**
 * Swallow a KPI query failure into an empty row set, but always log it.
 * These reads previously discarded ER_BAD_FIELD_ERROR silently, so a query against
 * nonexistent columns returned HTTP 200 with empty data indefinitely.
 */
export function emptyOnError(
  context: string,
  detail: Record<string, unknown> = {},
  failures?: string[],
) {
  return (err: unknown) => {
    logSourceFailure("kpi", err, { query: context, ...detail });
    // Record the miss for the caller as well as the log. Logging alone told
    // operators something broke but still handed the UI an empty result that
    // reads as "nothing happened this period" — the two are not the same
    // answer, and only one of them means someone should look at it.
    failures?.push(context);
    return [[]] as any;
  };
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * `DATE_FORMAT(a.score_date, '%Y-%m') = ?` formats every row of kpi_daily_actual (~82k) before it
 * can compare, so no index on score_date can be used. For a well-formed YYYY-MM it is exactly the
 * half-open range [first of month, first of next month), which is index-friendly. Anything that is
 * not a valid YYYY-MM keeps the original predicate, so a malformed `period` still matches nothing
 * exactly as before.
 */
export function scoreDateMonthPredicate(period: string, column = "a.score_date"): { sql: string; params: string[] } {
  const m = MONTH_RE.exec(period);
  if (!m) return { sql: `DATE_FORMAT(${column}, '%Y-%m') = ?`, params: [period] };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return {
    sql: `(${column} >= ? AND ${column} < ?)`,
    params: [`${pad(year, 4)}-${pad(month)}-01`, `${pad(nextYear, 4)}-${pad(nextMonth)}-01`],
  };
}

// The rollup is identical for every viewer with the same effective scope, and each computation
// runs four aggregates over kpi_daily_actual. Concurrent viewers share one in-flight computation
// and the result is reused for 30s (same window as the dashboards /summary metrics cache). Keyed on
// the resolved scope columns buildScopeWhere actually reads — never the user.
const KPI_ORG_SUMMARY_TTL_MS = 30_000;
const orgSummaryCache = new TtlCache<Record<string, unknown>>({ maxEntries: 100, defaultTtlMs: KPI_ORG_SUMMARY_TTL_MS });

/** Test seam. */
export function resetKpiOrgSummaryCacheForTest(): void {
  orgSummaryCache.clear();
}

export async function getKpiOrgSummary(period: string, scope: DashboardScope): Promise<Record<string, unknown>> {
  const key = `kpi-org:${period}:${scope.level}:${scope.branchIds.join(",")}:${scope.processIds.join(",")}`;
  const { value } = await orgSummaryCache.getOrCompute(key, () => computeKpiOrgSummary(period, scope));
  // A partial result (some source query failed) must not be pinned for the whole window.
  if (value.unavailableSources && Array.isArray((value.unavailableSources as any).failedQueries)) {
    orgSummaryCache.delete(key);
  }
  return value;
}

async function computeKpiOrgSummary(period: string, scope: DashboardScope): Promise<Record<string, unknown>> {
  const empScope = buildScopeWhere(scope, "e.branch_id", "e.process_id");
  const month = scoreDateMonthPredicate(period);

  // Any guarded query that fails pushes its name here, so the response can say
  // "the source failed" rather than "there is no data".
  const sourceFailures: string[] = [];

  const [metricRows] = await db.execute<RowDataPacket[]>(
    `SELECT m.metric_code, m.metric_name, m.unit, m.direction,
            ROUND(AVG(a.actual_value), 2) AS avg_value,
            COUNT(DISTINCT a.employee_id) AS employees,
            COUNT(*) AS samples
       FROM kpi_daily_actual a
       JOIN kpi_metric_master m ON m.id = a.metric_id
       LEFT JOIN employees e ON e.id = a.employee_id
      WHERE ${month.sql} AND ${empScope.sql}
      GROUP BY m.id
      ORDER BY samples DESC`,
    [...month.params, ...empScope.params],
  ).catch(emptyOnError("kpi org-summary by_metric", { period }, sourceFailures));

  const byMetric = (metricRows as any[]) ?? [];

  // ATTENDANCE_PCT has by far the widest coverage and would otherwise win headline
  // selection, but attendance has a single system of record: attendance_daily_record,
  // the processed attendance engine that payroll is computed from. The KPI copy is a
  // derived nightly roll-up from the dialer feed and disagrees materially with it
  // (~45% vs ~75% present for the same population). Attendance is therefore reported
  // only from attendance_daily_record via the ATTENDANCE metric; the KPI duplicate is
  // excluded from the headline so the two can never appear as competing figures.
  const HEADLINE_EXCLUDED = new Set(["ATTENDANCE_PCT"]);

  const headline =
    byMetric.find((row) =>
      String(row.unit) === "percent" &&
      String(row.direction) === "higher_is_better" &&
      !HEADLINE_EXCLUDED.has(String(row.metric_code))) ?? null;

  let summary: Record<string, unknown> = {};
  let processRows: RowDataPacket[] = [];
  let trendRows: RowDataPacket[] = [];

  if (headline) {
    // The three headline queries depend only on `headline`, not on each other, so they run
    // together instead of one after another. Each keeps its own failure isolation.
    const [[summaryRows], [processResult], [trendResult]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT ROUND(AVG(a.actual_value), 2) AS org_avg_score,
                COUNT(DISTINCT a.employee_id) AS employees_scored,
                COUNT(DISTINCT e.process_id) AS processes_covered,
                ROUND(MAX(a.actual_value), 2) AS best_score,
                ROUND(MIN(a.actual_value), 2) AS lowest_score,
                SUM(CASE WHEN a.actual_value >= 90 THEN 1 ELSE 0 END) AS high_performers,
                SUM(CASE WHEN a.actual_value < 60 THEN 1 ELSE 0 END) AS needs_attention,
                COUNT(*) AS sample_count
           FROM kpi_daily_actual a
           JOIN kpi_metric_master m ON m.id = a.metric_id AND m.metric_code = ?
           LEFT JOIN employees e ON e.id = a.employee_id
          WHERE ${month.sql} AND ${empScope.sql}`,
        [headline.metric_code, ...month.params, ...empScope.params],
      ).catch(emptyOnError("kpi org-summary rollup", { period }, sourceFailures)),
      // process_id_at_event is present on kpi_daily_actual but 0% populated, so the
      // per-process split must come from the employee's current process.
      db.execute<RowDataPacket[]>(
        `SELECT pm.process_name AS label,
                ROUND(AVG(a.actual_value), 2) AS avg_score,
                COUNT(DISTINCT a.employee_id) AS agents
           FROM kpi_daily_actual a
           JOIN kpi_metric_master m ON m.id = a.metric_id AND m.metric_code = ?
           JOIN employees e ON e.id = a.employee_id
           JOIN process_master pm ON pm.id = e.process_id
          WHERE ${month.sql} AND ${empScope.sql}
          GROUP BY e.process_id, pm.process_name
          ORDER BY avg_score DESC
          LIMIT 10`,
        [headline.metric_code, ...month.params, ...empScope.params],
      ).catch(emptyOnError("kpi org-summary by_process", { period }, sourceFailures)),
      db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(a.score_date, '%Y-%m') AS period,
                ROUND(AVG(a.actual_value), 2) AS avg_score
           FROM kpi_daily_actual a
           JOIN kpi_metric_master m ON m.id = a.metric_id AND m.metric_code = ?
           LEFT JOIN employees e ON e.id = a.employee_id
          WHERE a.score_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) AND ${empScope.sql}
          GROUP BY DATE_FORMAT(a.score_date, '%Y-%m')
          ORDER BY period ASC`,
        [headline.metric_code, ...empScope.params],
      ).catch(emptyOnError("kpi org-summary trend", { period }, sourceFailures)),
    ]);

    summary = {
      ...((summaryRows as any[])[0] ?? {}),
      metric_code: headline.metric_code,
      metric_name: headline.metric_name,
      metric_unit: headline.unit,
    };
    processRows = processResult;
    trendRows = trendResult;
  }

  return {
    period,
    summary,
    by_process: processRows,
    by_metric: byMetric,
    trend: trendRows,
    // A failed query and an empty period are different answers. Saying "no
    // actuals were recorded" when the query actually errored is what makes
    // real breakage look like a quiet month.
    ...(sourceFailures.length
      ? {
          unavailableSources: {
            kpi: `${sourceFailures.length} KPI source quer${sourceFailures.length === 1 ? "y" : "ies"} ` +
              `failed for ${period} — the figures below are incomplete, not zero`,
            failedQueries: sourceFailures,
          },
        }
      : headline
        ? {}
        : {
            unavailableSources: {
              kpi: byMetric.length
                ? `No higher-is-better percent KPI is available as a headline for ${period}`
                : `No KPI actuals were recorded for ${period}`,
            },
          }),
  };
}
