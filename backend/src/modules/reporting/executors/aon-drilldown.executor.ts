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
import { ACTIVE_EMPLOYEE_SQL, AON_DAYS_SQL, IN_TRAINING_SQL } from "../workforce-population.js";

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
    // Joined and on the floor but not yet on payroll. Must come first -- these rows would
    // otherwise fall into 0-30 and the drawer would disagree with the cell that was clicked.
    case "In Training": return IN_TRAINING_SQL("e", "CURDATE()");
    // AON_DAYS_SQL clamps a future reference date to 0, and 0 <= 30 -- so every tenure case
    // below must explicitly exclude In Training or its people leak into 0-30 as well as their
    // own bucket. Live-verified: the aggregate's 0-30 cell showed 153 while this predicate
    // (before the NOT-guard) returned 165, the same 12 In Training employees counted twice.
    case "0-30": return `NOT (${IN_TRAINING_SQL("e", "CURDATE()")}) AND ${AON_DAYS_SQL("e", "CURDATE()")} <= 30`;
    case "31-60": return `NOT (${IN_TRAINING_SQL("e", "CURDATE()")}) AND ${AON_DAYS_SQL("e", "CURDATE()")} BETWEEN 31 AND 60`;
    case "61-90": return `NOT (${IN_TRAINING_SQL("e", "CURDATE()")}) AND ${AON_DAYS_SQL("e", "CURDATE()")} BETWEEN 61 AND 90`;
    case "90+": return `NOT (${IN_TRAINING_SQL("e", "CURDATE()")}) AND ${AON_DAYS_SQL("e", "CURDATE()")} > 90`;
    default: return null;
  }
}

function aonBucketAtExitClause(bucket: unknown): string | null {
  switch (bucket) {
    // Left before payroll started -- quit during training.
    case "In Training": return IN_TRAINING_SQL("e", "e.date_of_exit");
    // Same NOT-guard as aonBucketClause above, mirrored onto the at-exit reference date.
    case "0-30": return `NOT (${IN_TRAINING_SQL("e", "e.date_of_exit")}) AND ${AON_DAYS_SQL("e", "e.date_of_exit")} <= 30`;
    case "31-60": return `NOT (${IN_TRAINING_SQL("e", "e.date_of_exit")}) AND ${AON_DAYS_SQL("e", "e.date_of_exit")} BETWEEN 31 AND 60`;
    case "61-90": return `NOT (${IN_TRAINING_SQL("e", "e.date_of_exit")}) AND ${AON_DAYS_SQL("e", "e.date_of_exit")} BETWEEN 61 AND 90`;
    case "90+": return `NOT (${IN_TRAINING_SQL("e", "e.date_of_exit")}) AND ${AON_DAYS_SQL("e", "e.date_of_exit")} > 90`;
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

  // managerId here comes from a click on a `reporting_manager` dimension row in
  // attritionDeepDive (or Overview's manager-mapping heatmap), which groups exclusively by
  // `e.reporting_manager_id` (see DEEP_DIVE_DIMENSIONS.reporting_manager in aon.executor.ts).
  // appendFilterConditions' generic managerId clause is an OR-union of TWO different manager
  // columns (`reporting_manager_id OR manager_id`), because other reports elsewhere in the
  // suite intentionally treat those as interchangeable. Applying that same OR-union here
  // makes the drill-down a SUPERSET of the aggregate row it was clicked from -- live-verified
  // against mas_hrms: a manager row showing 46 exits returned 123 drill-down rows (KAMAL
  // SINGH), because the extra 77 have a matching `manager_id` but a DIFFERENT
  // `reporting_manager_id`, so the aggregate never counted them.
  //
  // Filter on `reporting_manager_id` alone instead, so this drill-down's population matches
  // attritionDeepDive's own join exactly. appendFilterConditions itself is left untouched --
  // its OR-union may be exactly what other reports need.
  if (filters.managerId) {
    clauses.push("e.reporting_manager_id = ?");
    params.push(String(filters.managerId));
  }
  appendFilterConditions(
    { ...filters, managerId: undefined },
    clauses,
    params
  );

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
    // Independent, optional narrowing filter alongside aonBucket -- a caller drilling from
    // Cohort Survival passes cohortMonth (and no aonBucket); a caller drilling from the
    // Overview heatmap passes aonBucket (and no cohortMonth). Both may be present at once;
    // neither is mutually exclusive with the other in the SQL.
    const cohortMonth =
      typeof filters.cohortMonth === "string" && /^\d{4}-\d{2}$/.test(filters.cohortMonth)
        ? filters.cohortMonth
        : null;

    // A cohort-month drill is "everyone who joined that month, INCLUDING those who have
    // since left" -- that is the documented meaning of a cohort (see aonCohortSurvival's own
    // doc comment and AonAnalyticsView.tsx's CohortRow/CohortSurvival doc comment), and the
    // cohort-detail table's own joined/left-by-30d counts have no active_status restriction
    // either. Applying active_status = 1 here would silently drop every since-left employee
    // and the drawer would never reconcile against the cohort row that opened it.
    //
    // The Overview-heatmap headcount call (no cohortMonth, aonBucket instead) is genuinely
    // "who is currently active in this AON bucket" and keeps the active_status filter exactly
    // as before -- this branch does not change that call's behaviour or row count.
    if (!cohortMonth) {
      clauses.push(ACTIVE_EMPLOYEE_SQL("e"));
    }
    const bucketClause = aonBucketClause(filters.aonBucket);
    if (bucketClause) clauses.push(bucketClause);

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
           -- Clamped: an In Training leaver has date_of_exit before salary_start_date, so a raw
           -- DATEDIFF here goes negative, and a negative "tenure at exit" is nonsensical.
           ${AON_DAYS_SQL("e", "e.date_of_exit")} AS tenure_at_exit_days,
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
             -- Clamped: for an In Training employee the reference date (salary_start_date) is
             -- still in the future, so a raw DATEDIFF here goes negative -- and a negative value
             -- satisfies aon_days <= 30 below, which would silently assign the HIGHEST risk
             -- tier (45) to someone who hasn't even started payroll yet.
             ${AON_DAYS_SQL("e", "CURDATE()")} AS aon_days,
             -- IMPORTANT-3 (final whole-branch review): a cohort-month drill deliberately
             -- includes since-left employees alongside active ones (see the cohortMonth
             -- comment block above), but this shape had no column telling the caller which
             -- is which -- so EmployeeListPanel offered "Flag for Retention Review" on an
             -- already-exited employee, which is nonsensical. e.active_status is already
             -- available on every row here regardless of whether the active_status = 1
             -- clause above was applied, so this costs nothing to add.
             (${ACTIVE_EMPLOYEE_SQL("e")}) AS is_active
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
