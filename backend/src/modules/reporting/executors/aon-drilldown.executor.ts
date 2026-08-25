/**
 * aon-drilldown-employees — the employee-level bottom of the AON Analytics drill-down chain.
 *
 * Every other AON/attrition report in this module is a pure aggregate (branch x cost-centre x
 * process x bucket) with no employee-level row output. This is the one executor that returns
 * named people, and only when a caller has already narrowed down to a specific slice via
 * branchId/costCentreId/processId/aonBucket -- it is not meant to be paged through unfiltered.
 *
 * Two response shapes depending on filters.metric, because "headcount"/"shrinkage" context means
 * "who is currently in this slice" (active employees, with the same risk-score fields
 * attrition-risk.executor.ts already computes) while "exits" context means "who left from this
 * slice" (exited employees, with their exit date and tenure at exit) -- these are genuinely
 * different populations and mixing them into one shape would blur what the drawer is showing.
 *
 * `employee_id` (the real UUID `employees.id`, not `employee_code`) is selected in both branches
 * so a later "Flag for Retention Review" action can address the record without a second lookup.
 *
 * This is a deliberately simplified subset of `attritionRiskScore`'s full weighting (tenure +
 * absence only, not missing-punch/half-day) for the first cut -- extending to the full weighted
 * score is a small follow-up, not required here.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  fetchPageWithTotal,
  rethrowReportSchemaError,
  dateParam,
} from "./types.js";
import { AON_REFERENCE_JOIN_DATE_SQL } from "./aon.executor.js";

async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

async function count(baseSql: string, params: unknown[]): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
    params
  );
  return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
}

const MIN_DAYS_FOR_RATE = 5;

function aonBucketClause(bucket: unknown): string | null {
  switch (bucket) {
    case "0-30": return `DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30`;
    case "31-60": return `DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) BETWEEN 31 AND 60`;
    case "61-90": return `DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) BETWEEN 61 AND 90`;
    case "90+": return `DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) > 90`;
    default: return null;
  }
}

function aonBucketAtExitClause(bucket: unknown): string | null {
  switch (bucket) {
    case "0-30": return `DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30`;
    case "31-60": return `DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) BETWEEN 31 AND 60`;
    case "61-90": return `DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) BETWEEN 61 AND 90`;
    case "90+": return `DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) > 90`;
    default: return null;
  }
}

export async function aonDrilldownEmployees(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const metric = String(filters.metric ?? "headcount");
  const isExitContext = metric === "exits";

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (isExitContext) {
    clauses.push("e.date_of_exit IS NOT NULL", "e.date_of_exit >= e.date_of_joining");
    const bucketClause = aonBucketAtExitClause(filters.aonBucket);
    if (bucketClause) clauses.push(bucketClause);

    // Same default window as aonBucketAttrition (aon.executor.ts): the twelve months ending
    // today when the caller didn't pass from/to. Without this the exits branch returned ALL
    // historical exits for the slice (capped only by the row limit), which never reconciled
    // against the heatmap cell's own date-windowed count.
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const twelveMonthsAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    const from = dateParam(filters.from, iso(twelveMonthsAgo));
    const to = dateParam(filters.to, iso(today));
    clauses.push("e.date_of_exit BETWEEN ? AND ?");
    params.push(from, to);
  } else {
    clauses.push("e.active_status = 1");
    const bucketClause = aonBucketClause(filters.aonBucket);
    if (bucketClause) clauses.push(bucketClause);

    // Independent, optional narrowing filter alongside aonBucket -- a caller drilling from
    // Cohort Survival passes cohortMonth (and no aonBucket); a caller drilling from the
    // Overview heatmap passes aonBucket (and no cohortMonth). Both may be present at once;
    // neither is mutually exclusive with the other in the SQL.
    const cohortMonth =
      typeof filters.cohortMonth === "string" && /^\d{4}-\d{2}$/.test(filters.cohortMonth)
        ? filters.cohortMonth
        : null;
    if (cohortMonth) {
      clauses.push(`DATE_FORMAT(${AON_REFERENCE_JOIN_DATE_SQL}, '%Y-%m') = ?`);
      params.push(cohortMonth);
    }
  }

  // Exit context: a plain LEFT JOIN straight to the manager's own employees row. An earlier
  // draft wrapped this in a derived table that re-joined employees to itself before joining
  // out to `e` — same row count, extra work, and it was doing so with an unqualified
  // `reporting_manager_name` reference that would have thrown ER_BAD_FIELD_ERROR at the outer
  // SELECT. Measured live against mas_hrms (cost_centre_id with 5,054 exit rows, 0-30 bucket,
  // 2,000-row probe): the derived-table form took ~5.1s, this direct join ~2.4-3.2s.
  //
  // Headcount/shrinkage context: the attendance aggregate is computed in a CTE-scoped subquery
  // restricted to the already-filtered employee set (`employee_id IN (SELECT employee_id FROM
  // filtered)`), not aggregated across the whole table first. Timed live against mas_hrms on a
  // realistic filtered call (cost_centre_id with 27 active employees in the 31-60 bucket): the
  // naive "aggregate attendance_daily_record for everyone, then join down" form -- which is
  // what a straight port of attrition-risk.executor.ts's derived table would have been --
  // took 51.3s (full scan of ~125k attendance rows before the join ever narrows anything, the
  // same unscoped-aggregate shape flagged for aon-bucket-shrinkage). Restricting the derived
  // table's WHERE to the filtered id set first drops that to ~1-1.6s, because it then drives
  // off `idx_adr_emp_date` per employee instead of scanning the whole table.
  const base = isExitContext
    ? `
    SELECT e.id AS employee_id,
           e.employee_code,
           COALESCE(NULLIF(TRIM(e.full_name),''),
                    TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED')       AS branch_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(p.process_name, 'UNASSIGNED')      AS process_name,
           DATE_FORMAT(${AON_REFERENCE_JOIN_DATE_SQL}, '%Y-%m-%d') AS join_date,
           DATE_FORMAT(e.date_of_exit, '%Y-%m-%d')     AS date_of_exit,
           DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) AS tenure_at_exit_days,
           COALESCE(NULLIF(TRIM(m.full_name),''),
                    TRIM(CONCAT(m.first_name,' ',COALESCE(m.last_name,'')))) AS reporting_manager_name
      FROM employees e
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN process_master p      ON p.id  = e.process_id
      LEFT JOIN employees m           ON m.id  = e.reporting_manager_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.date_of_exit DESC`
    : `
    WITH filtered AS (
      SELECT e.id AS employee_id,
             e.employee_code,
             COALESCE(NULLIF(TRIM(e.full_name),''),
                      TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
             COALESCE(b.branch_name, 'UNASSIGNED')       AS branch_name,
             COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
             COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
             COALESCE(p.process_name, 'UNASSIGNED')      AS process_name,
             DATE_FORMAT(${AON_REFERENCE_JOIN_DATE_SQL}, '%Y-%m-%d') AS join_date,
             DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) AS aon_days
        FROM employees e
        LEFT JOIN branch_master b       ON b.id  = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        LEFT JOIN process_master p      ON p.id  = e.process_id
       WHERE ${clauses.join(" AND ")}
    )
    SELECT f.*,
           COALESCE(a.attendance_days, 0) AS attendance_days,
           CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                THEN ROUND(a.absent_days * 100.0 / a.attendance_days, 1) END AS absence_rate_pct,
           LEAST(100,
             CASE
               WHEN f.aon_days <= 30 THEN 45
               WHEN f.aon_days <= 60 THEN 30
               WHEN f.aon_days <= 90 THEN 18
               ELSE 6
             END
             + CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                    THEN LEAST(25, a.absent_days * 25.0 / a.attendance_days) ELSE 0 END
           ) AS risk_score
      FROM filtered f
      LEFT JOIN (
        SELECT adr.employee_id,
               COUNT(*) AS attendance_days,
               SUM(adr.attendance_status = 'absent') AS absent_days
          FROM attendance_daily_record adr
         WHERE adr.record_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
           AND adr.employee_id IN (SELECT employee_id FROM filtered)
         GROUP BY adr.employee_id
      ) a ON a.employee_id = f.employee_id
     ORDER BY risk_score DESC, f.aon_days ASC`;

  try {
    const paged = await fetchPageWithTotal(base, params, options, query, count);
    const total = paged.total;
    const rows = paged.rows as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err) {
    rethrowReportSchemaError("aon-drilldown-employees", err, base);
  }
}
