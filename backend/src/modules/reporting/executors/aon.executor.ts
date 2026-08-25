/**
 * AON (Age on Network) & Attrition Analytics executor
 *
 * Covers codes: aon-bucket-headcount, aon-bucket-attrition, aon-bucket-shrinkage,
 * aon-cohort-survival, attrition-deep-dive
 *
 * AON is the number of days between an employee's date_of_joining and a reference date,
 * bucketed 0-30 / 31-60 / 61-90 / 90+.
 *
 * ── Why nothing is stored ───────────────────────────────────────────────────────
 * AON is derived at read time, never persisted. There is no aon_days column and no
 * snapshot table, deliberately:
 *
 *   - a stored day-count is wrong the next morning unless all 58,840 employee rows are
 *     rewritten nightly, whereas DATEDIFF against the reference date is correct on every
 *     read. A new joiner enters the 0-30 bucket the moment their date_of_joining exists,
 *     with no job to run and nothing to go stale;
 *   - `employees.date_of_joining` is NOT NULL and populated on 58,840 of 58,840 rows
 *     (verified live 2026-08-15), so the derivation never falls back;
 *   - the trends are reconstructible from history and need no snapshot either — attrition
 *     from date_of_exit minus date_of_joining (29,180 dated exits), shrinkage from
 *     attendance_daily_record with AON taken as of record_date (128,442 rows spanning
 *     2025-06-12 to 2026-08-14).
 *
 * ── The reference date is what distinguishes the three measures ─────────────────
 *   headcount  -> CURDATE()          AON today
 *   attrition  -> e.date_of_exit     AON at the moment they left
 *   shrinkage  -> adr.record_date    AON on the day being measured
 *
 * ── Data gaps these reports are built to SHOW rather than hide ──────────────────
 * Verified against live mas_hrms on 2026-08-15. Each is surfaced as a column or a named
 * UNASSIGNED row, never as a blank:
 *
 *   1. All 198 active employees in the 0-30 bucket have no cost centre and no process.
 *      This is a write gap, not a broken feed: onboarding DOES capture a cost centre —
 *      it is a required field on the employment offer and lands in
 *      `ats_employment_offer.cost_centre` and `ats_payroll_hr_validation.cost_centre_id` —
 *      but no employee-creation path copies it onto the employee. The orchestrator INSERT
 *      (employee-creation-orchestrator.service.ts), the bulk upload, createEmployee and
 *      both sync handlers all omit `cost_centre_id`, leaving `updateEmployee` (the manual
 *      Edit Employee dialog) as its only writer anywhere in the backend. Coverage was
 *      100% for 2024 and 2025 joiners because legacy sync populated it; that is now off.
 *      Branch is unaffected (198/198), which is why branch is a first-class grouping key
 *      here and not an afterthought.
 *   2. Process is populated on only 272 of 2,796 recent exits (9.7%), against 74% of
 *      active employees. Process-level attrition is therefore ~90% UNASSIGNED, and
 *      aon-bucket-attrition emits process_coverage_pct so that is visible in the row.
 *   3. 79 of the 198 employees in the 0-30 bucket have no attendance row at all for
 *      Jul-2026 (biometric enrolment lag), and 34 cost-centre x process groups covering
 *      6,521 employee-days had zero worked days. Shrinkage without a coverage column is
 *      survivorship bias, so aon-bucket-shrinkage emits coverage_pct.
 *   4. Exit reason is not captured anywhere: exit_request holds 2 rows,
 *      exit_interview_response and attrition_record are empty, and
 *      legacy_history_snapshot yields a reason for 10 of 2,796 recent exits.
 *      attrition-deep-dive emits reason_captured_pct so 0.4% reads as a broken capture
 *      process rather than as a quiet dash.
 *
 * Row scope is enforced in the query and nowhere else — every function calls
 * appendScopeConditions, which applies branch AND process AND department AND cost centre
 * and throws on the no-access case.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  dateParam,
  fetchPageWithTotal,
  rethrowReportSchemaError,
} from "./types.js";

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

/**
 * AON reference join-date, corrected 2026-08-25.
 *
 * Was `e.date_of_joining` alone. `employees.salary_start_date` is populated on only 1,554 of
 * 58,918 employees (2.6%, verified live) and its own type comment already documents it as
 * "defaults to date_of_joining when null" (see running-salary.service.ts, which reads it the
 * same way) — so COALESCE here is the existing convention for this column, not a new rule.
 * Of the 1,554 populated rows only 19 actually differ from date_of_joining (6-41 day gaps, all
 * recent joiners), so this is a safe substitution today and correctly future-proofed as more
 * employees get a real salary_start_date set going forward.
 */
export const AON_REFERENCE_JOIN_DATE_SQL = "COALESCE(e.salary_start_date, e.date_of_joining)";

/**
 * The bucket expression, parameterised only by the reference date.
 *
 * Written as day arithmetic rather than TIMESTAMPDIFF(MONTH, ...) — which is what
 * tenure-distribution uses — because the boundaries here are exact day counts and a
 * month-based comparison does not land on day 30/60/90.
 *
 * Boundaries are inclusive-upper (<= 30, <= 60, <= 90) so the four buckets are disjoint
 * and cover every non-null joining date. Day 0 (joined today) falls in 0-30.
 */
function aonBucketSql(asOf: string): string {
  return `CASE
             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN '0-30'
             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 60 THEN '31-60'
             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 90 THEN '61-90'
             ELSE '90+'
           END`;
}

/**
 * The ordering key for the four buckets.
 *
 * Sorting on the label alone puts '0-30' before '31-60' but '90+' before both, because it
 * is a string sort. Every report here orders by this instead so the buckets read in
 * tenure order on screen and in the exported workbook.
 */
function aonBucketOrderSql(asOf: string): string {
  return `CASE
             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN 1
             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 60 THEN 2
             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 90 THEN 3
             ELSE 4
           END`;
}

/**
 * The active-employee test.
 *
 * `active_status = 1` alone, deliberately. The superseded two-flag form also required
 * LOWER(COALESCE(employment_status,'active')) = 'active', which returns 1,123 where the
 * agreed definition returns 1,125 — employment_status is mixed-case free text
 * ('Resigned' 28,200 vs 'resigned' 2,118; 'Active' 273 vs 'active' 1,039) and is not a
 * reliable predicate. See report-row-scope notes on cost-centre-headcount.
 */
const ACTIVE = "e.active_status = 1";

/**
 * The population that can be reasoned about historically.
 *
 * 28,426 inactive employees carry no date_of_exit at all, so "was this person employed on
 * date D" is unanswerable for them and counting them as still employed inflates any
 * point-in-time headcount by an order of magnitude (~29,500 against a real 1,327).
 * They are excluded from every denominator here.
 *
 * This is safe for the rolling windows these reports default to: only 22 of those 28,426
 * have a date_of_joining on or after 2025-08-01 (verified live 2026-08-15). The excluded
 * count is reported to the caller rather than left implicit.
 */
const RELIABLE_POPULATION = "(e.active_status = 1 OR e.date_of_exit IS NOT NULL)";

/**
 * Exits whose tenure is arithmetically possible.
 *
 * 297 employees carry a date_of_exit EARLIER than their date_of_joining (measured live
 * 2026-08-17, all-time; 17 of them inside a rolling twelve months). Because every bucket
 * here is `DATEDIFF(exit, joining) <= 30 THEN '0-30'`, a negative tenure satisfies the
 * FIRST branch and lands in the 0-30 bucket — silently inflating the single number this
 * whole report exists to produce, early attrition.
 *
 * The joining date is not the wrong side of that comparison. db_bill.masjclrentry.DOJ was
 * checked for all 297 and agrees with mas_hrms on essentially every one, so date_of_exit is
 * the unreliable field. Many share one exit date across a whole batch of joiners (twenty
 * people "exiting" 31 May with June joining dates), which reads as a migration artefact
 * writing a period-end rather than a real last working day.
 *
 * Excluded rather than corrected: inventing a plausible exit date would fabricate the very
 * tenure this report measures. Excluding them makes the buckets arithmetically sound and
 * leaves the underlying data wrong-but-visible.
 */
const POSSIBLE_TENURE = "e.date_of_exit >= e.date_of_joining";

// ---------------------------------------------------------------------------
// aon-bucket-headcount  (aggregate — no row-level cursor)
// ---------------------------------------------------------------------------
/**
 * Active headcount per branch x cost centre x process x AON bucket, as of today.
 *
 * pct_of_group is the bucket's share of its own branch/cost-centre/process group, not of
 * the whole company — the question this report answers is "how new is THIS cost centre",
 * and a share of the global headcount would make every row of a small cost centre look
 * negligible. The window function is computed over the same grouping keys.
 */
export async function aonBucketHeadcount(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push(ACTIVE, "e.date_of_joining IS NOT NULL");

  const base = `
    SELECT COALESCE(b.branch_name, 'UNASSIGNED')      AS branch_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(p.process_name, 'UNASSIGNED')     AS process_name,
           b.id  AS branch_id,
           cc.id AS cost_centre_id,
           p.id  AS process_id,
           ${aonBucketSql("CURDATE()")} AS aon_bucket,
           COUNT(*) AS headcount,
           ROUND(
             COUNT(*) * 100.0
             / NULLIF(SUM(COUNT(*)) OVER (
                 PARTITION BY b.branch_name, cc.cost_centre_code, p.process_name
               ), 0),
             2
           ) AS pct_of_group,
           MIN(DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL})) AS min_aon_days,
           MAX(DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL})) AS max_aon_days
      FROM employees e
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN process_master p      ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY b.branch_name, cc.cost_centre_code, cc.cost_centre_name, p.process_name,
              b.id, cc.id, p.id,
              ${aonBucketSql("CURDATE()")}, ${aonBucketOrderSql("CURDATE()")}
     ORDER BY b.branch_name, cc.cost_centre_code, p.process_name,
              ${aonBucketOrderSql("CURDATE()")}`;

  try {
    const paged = await fetchPageWithTotal(base, params, options, query, count);
    const total = paged.total;
    const rows = paged.rows as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err) {
    rethrowReportSchemaError("aon-bucket-headcount", err, base);
  }
}

// ---------------------------------------------------------------------------
// aon-bucket-attrition  (aggregate — no row-level cursor)
// ---------------------------------------------------------------------------
/**
 * Exits per month x branch x cost centre x process x AON-at-exit bucket.
 *
 * ── Both date bounds are required, and that is not cosmetic ─────────────────────
 * An unbounded upper end lets any future-dated exit through, and — more damaging — while
 * verifying this report an unbounded window joined to legacy_history_snapshot returned
 * 3,107 exits against a true 2,796, because that table holds several rows per
 * employee_code and multiplied them. Nothing here joins that table, but the bound stays
 * mandatory: the fan-out check in the report's verification steps compares this report's
 * total against a plain COUNT over the same window, and an open bound makes the two
 * incomparable.
 *
 * ── The denominator, stated rather than assumed ─────────────────────────────────
 * monthly-attrition-summary deliberately emits no attrition_pct, on the grounds that
 * point-in-time headcount is not derivable and picking a substitute denominator is a
 * business decision rather than a reporting one. That reasoning is sound and is not
 * overturned here — instead the decision is made explicitly, in the open, for this new
 * report only, and no existing report changes:
 *
 *   attrition_pct = exits / (bucket headcount at month end + exits that month)
 *
 * Both sides are restricted to RELIABLE_POPULATION, so the 28,426 undated legacy exits
 * cannot inflate the denominator. excluded_undated_exits reports how many rows that
 * restriction removed, so the figure is never read as complete when it is not.
 */
/**
 * Bucket-matching expression for an arbitrary at-risk employee, evaluated as of an
 * arbitrary date — the at-risk-population twin of `aonBucketSql`, which is fixed to
 * `AON_REFERENCE_JOIN_DATE_SQL` and to whatever `asOf` its caller passes. This variant takes
 * its own join-date column so it can be evaluated against `at_risk.join_date` (already
 * COALESCE'd once in the CTE below) rather than recomputing the COALESCE per row.
 */
function atRiskBucketSql(asOf: string, joinDateCol: string): string {
  return `CASE
             WHEN DATEDIFF(${asOf}, ${joinDateCol}) <= 30 THEN '0-30'
             WHEN DATEDIFF(${asOf}, ${joinDateCol}) <= 60 THEN '31-60'
             WHEN DATEDIFF(${asOf}, ${joinDateCol}) <= 90 THEN '61-90'
             ELSE '90+'
           END`;
}

export async function aonBucketAttrition(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const twelveMonthsAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());

  const from = dateParam(filters.from, iso(twelveMonthsAgo));
  const to = dateParam(filters.to, iso(today));

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push(
    "e.date_of_exit IS NOT NULL",
    "e.date_of_joining IS NOT NULL",
    POSSIBLE_TENURE,
    "e.date_of_exit BETWEEN ? AND ?"
  );
  params.push(from, to);

  const bucket = aonBucketSql("e.date_of_exit");
  const bucketOrder = aonBucketOrderSql("e.date_of_exit");

  /*
   * At-risk population per bucket, evaluated at the period's start and end dates.
   *
   * An employee is "at risk" for bucket B on date D if: they had already joined by D
   * (join_date <= D), they were still employed on D (no exit, or exit on/after D), and
   * their tenure AS OF D falls in bucket B's day-range. Scoped to the SAME
   * branch/process/cost-centre combination as the output row, using the NULL-safe `<=>`
   * operator so two UNASSIGNED (NULL) dimensions match each other rather than never
   * matching (`=` against NULL is never true in SQL).
   *
   * ── Why exit_groups is a separate CTE, not one flat aggregate query ─────────────
   * (unchanged from the first pass, still true): the at-risk computation needs each output
   * row's own group key (branch_id, process_id, cost_centre_id, aon_bucket, month) as plain
   * values, and referencing raw `e.date_of_exit`-derived expressions for that trips MySQL's
   * ONLY_FULL_GROUP_BY check even when textually identical to a GROUP BY expression —
   * verified live against mas_hrms. Aggregating once into `exit_groups` avoids that.
   *
   * ── Second pass, 2026-08-25: correlated subquery PER OUTPUT ROW was still O(rows) ──
   * The first pass (still present in git history) ran 2 correlated `SELECT COUNT(*) FROM
   * at_risk WHERE ...` subqueries once per row of exit_groups. exit_groups can have
   * thousands of rows for the unscoped 12-month default (branch x cost-centre x process x
   * bucket x month), each subquery re-scanning/re-filtering all of `at_risk` (~58,918
   * rows) — the exact same failure class as overallAttritionRate's original 3x12 re-scan,
   * just with a finer-grained multiplier. Confirmed live: the real unscoped, no-filter,
   * 12-month-default call ran past 150s and had to be killed.
   *
   * Fixed the same way overallAttritionRate was fixed in spirit (scan `at_risk` ONCE per
   * period endpoint, not once per exit_groups row) but NOT by crossing at_risk against just
   * the (<=12) distinct months: that first attempt was tried live and timed at over 249s
   * for the at-risk half alone, because grouping by (month, branch, process, cost_centre,
   * bucket) after a blind CROSS JOIN is bounded by the org's FULL combinatorial
   * branch/process/cost-centre space, not by which combinations actually had an exit.
   * `distinct_groups` instead carries the exact (month, branch, process, cost_centre)
   * combinations exit_groups actually needs (545 rows measured live, unscoped 12-month
   * default) and at_risk is JOINed to THAT, bounding both the join and the GROUP BY output
   * to what the report can use — two passes total (`at_risk_start`, `at_risk_end`), not one
   * per exit_groups row and not one per org-wide combination either.
   *
   * ── Hand-verified against live mas_hrms 2026-08-25 (both passes) ────────────────
   * Branch NOIDA-2, process Onfido, cost centre 0339a406-..., bucket 0-30, June 2026:
   * a direct COUNT(*) against `employees` for this exact (branch, process, cost_centre)
   * combination returned 28 at-risk on 2026-06-01 and 41 on 2026-06-30 (avg 34.5). Both the
   * original correlated-subquery version AND this set-based rewrite produced 34.5 for that
   * exact row — the rewrite changed only the query shape, not the answer. The branch-wide
   * bucket total for 0-30 also matched: 86 exits, reconciling to a plain COUNT(*).
   */
  const atRiskCte = `
    at_risk AS (
      SELECT ${AON_REFERENCE_JOIN_DATE_SQL} AS join_date, e.date_of_exit,
             e.branch_id, e.process_id, e.cost_centre_id
        FROM employees e
       WHERE ${AON_REFERENCE_JOIN_DATE_SQL} IS NOT NULL
         AND (e.date_of_exit IS NULL OR ${POSSIBLE_TENURE})
    )`;

  /*
   * Cost-impact source, added Task 1 of Plan 2.
   *
   * A sibling CTE, not a join predicate inline on `employees`: employee_salary_assignment
   * carries multiple historical rows per employee (one per structure/proposal change), so
   * joining it directly onto exit_groups' GROUP BY would fan out the exit count itself.
   * Restricting to active_status = 1 here first (each employee has at most one active
   * assignment row, per the table's own governance model) means the LEFT JOIN below adds
   * at most one row per e.id and cannot inflate `exits`. Live-verified 2026-08-25:
   * AVG(ctc_annual) = 142351.14 across 30219 active assignments (see task-1-report.md).
   */
  const ctcByEmployeeCte = `
    ctc_by_employee AS (
      SELECT esa.employee_id, esa.ctc_annual
        FROM employee_salary_assignment esa
       WHERE esa.active_status = 1
    )`;

  // Period boundaries as expressions of `dg.month` (a plain grouped column of the
  // distinct_groups/at_risk_start/at_risk_end derived tables below) rather than of any
  // exit_groups/employees column — this is what keeps the GROUP BY in those two CTEs legal
  // in the same way exit_groups' own GROUP BY is legal.
  const periodStart = "STR_TO_DATE(CONCAT(dg.month, '-01'), '%Y-%m-%d')";
  const periodEnd = `LAST_DAY(${periodStart})`;
  const atRiskBucketAtStart = atRiskBucketSql(periodStart, "ar.join_date");
  const atRiskBucketAtEnd = atRiskBucketSql(periodEnd, "ar.join_date");

  const base = `
    WITH ${atRiskCte},
    ${ctcByEmployeeCte},
    exit_groups AS (
      SELECT DATE_FORMAT(e.date_of_exit, '%Y-%m')        AS month,
             e.branch_id,
             COALESCE(b.branch_name, 'UNASSIGNED')       AS branch_name,
             e.cost_centre_id,
             COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
             COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
             e.process_id,
             COALESCE(p.process_name, 'UNASSIGNED')      AS process_name,
             ${bucket} AS aon_bucket,
             ${bucketOrder} AS bucket_order,
             COUNT(*) AS exits,
             ROUND(AVG(DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL})), 1) AS avg_tenure_days,
             MIN(DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL})) AS min_tenure_days,
             MAX(DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL})) AS max_tenure_days,
             -- How much of THIS row rests on a populated process_id. 272 of 2,796 recent
             -- exits carry one, so a process-grouped row is usually UNASSIGNED and the
             -- reader needs to see that in the row rather than infer it.
             ROUND(SUM(e.process_id IS NOT NULL) * 100.0 / NULLIF(COUNT(*), 0), 2)
               AS process_coverage_pct,
             -- Cost-impact of exits in this group: average ctc_annual (active salary
             -- assignments only) across the exited employees. LEFT JOIN so a missing
             -- salary assignment doesn't drop the exit row from exit_groups; AVG()
             -- ignores NULLs so it averages only over employees that HAVE one.
             ROUND(AVG(ctc.ctc_annual), 0) AS avg_ctc_annual
        FROM employees e
        LEFT JOIN branch_master b       ON b.id  = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        LEFT JOIN process_master p      ON p.id  = e.process_id
        LEFT JOIN ctc_by_employee ctc   ON ctc.employee_id = e.id
       WHERE ${clauses.join(" AND ")}
       GROUP BY DATE_FORMAT(e.date_of_exit, '%Y-%m'), e.branch_id, b.branch_name,
                e.cost_centre_id, cc.cost_centre_code, cc.cost_centre_name,
                e.process_id, p.process_name, ${bucket}, ${bucketOrder}
    ),
    -- Only the (month, branch, process, cost_centre) combinations that ACTUALLY appear in
    -- exit_groups -- bounded by exit_groups' own row count (545 measured live for the
    -- unscoped 12-month default), not by the full org's branch x process x cost-centre
    -- matrix. A first attempt CROSS JOINed at_risk against just the 12 distinct months
    -- (dropping the group key) and grouped the ~700K resulting rows straight down to
    -- (month, branch, process, cost_centre, bucket) -- timed live at over 120s (had to be
    -- killed) for the unscoped default, because that GROUP BY's cardinality is bounded by
    -- the org's FULL combinatorial branch/process/cost-centre space, not by which of those
    -- combinations actually had an exit. Restricting the join target to distinct_groups
    -- (this table) keeps the same "single set-based pass" principle while bounding the
    -- output to what exit_groups can actually use.
    distinct_groups AS (
      SELECT DISTINCT month, branch_id, process_id, cost_centre_id FROM exit_groups
    ),
    -- One pass over at_risk joined to distinct_groups, grouped down to
    -- (month, branch, process, cost_centre, bucket) -- NOT one correlated COUNT(*) per
    -- exit_groups row, and not a blind cross-join against every org combination either.
    -- Two of these total (start, end).
    at_risk_start AS (
      SELECT dg.month, dg.branch_id, dg.process_id, dg.cost_centre_id,
             ${atRiskBucketAtStart} AS aon_bucket,
             COUNT(*) AS at_risk_count
        FROM at_risk ar
        JOIN distinct_groups dg
          ON (ar.branch_id <=> dg.branch_id) AND (ar.process_id <=> dg.process_id)
         AND (ar.cost_centre_id <=> dg.cost_centre_id)
       WHERE ar.join_date <= ${periodStart}
         AND (ar.date_of_exit IS NULL OR ar.date_of_exit >= ${periodStart})
       GROUP BY dg.month, dg.branch_id, dg.process_id, dg.cost_centre_id, ${atRiskBucketAtStart}
    ),
    at_risk_end AS (
      SELECT dg.month, dg.branch_id, dg.process_id, dg.cost_centre_id,
             ${atRiskBucketAtEnd} AS aon_bucket,
             COUNT(*) AS at_risk_count
        FROM at_risk ar
        JOIN distinct_groups dg
          ON (ar.branch_id <=> dg.branch_id) AND (ar.process_id <=> dg.process_id)
         AND (ar.cost_centre_id <=> dg.cost_centre_id)
       WHERE ar.join_date <= ${periodEnd}
         AND (ar.date_of_exit IS NULL OR ar.date_of_exit >= ${periodEnd})
       GROUP BY dg.month, dg.branch_id, dg.process_id, dg.cost_centre_id, ${atRiskBucketAtEnd}
    )
    SELECT g.month, g.branch_name, g.cost_centre_code, g.cost_centre_name, g.process_name,
           g.branch_id, g.cost_centre_id, g.process_id,
           g.aon_bucket, g.exits, g.avg_tenure_days, g.min_tenure_days, g.max_tenure_days,
           -- Share of the month's exits that fell in this bucket, within this group.
           -- A plain window over g.exits now (exit_groups already did the aggregating),
           -- not the SUM(COUNT(*)) OVER (...) shape the pre-CTE version needed.
           ROUND(
             g.exits * 100.0
             / NULLIF(SUM(g.exits) OVER (
                 PARTITION BY g.month, g.branch_name, g.cost_centre_code, g.process_name
               ), 0),
             2
           ) AS pct_of_month_exits,
           g.process_coverage_pct,
           g.avg_ctc_annual,
           -- New: at-risk population and AON Attrition Rate for this exact bucket/group,
           -- per approved spec §2: exits / avg(at-risk at period start, at period end) x 100.
           -- Sourced from the pre-aggregated at_risk_start/at_risk_end CTEs via a NULL-safe
           -- equality join on the group key, not a per-row correlated subquery.
           ROUND(
             (COALESCE(s.at_risk_count, 0) + COALESCE(en.at_risk_count, 0)) / 2.0, 1
           ) AS at_risk_population_avg,
           ROUND(
             g.exits * 100.0
             / NULLIF((COALESCE(s.at_risk_count, 0) + COALESCE(en.at_risk_count, 0)) / 2.0, 0),
             2
           ) AS aon_attrition_rate_pct
      FROM exit_groups g
      LEFT JOIN at_risk_start s ON s.month = g.month
        AND (s.branch_id <=> g.branch_id) AND (s.process_id <=> g.process_id)
        AND (s.cost_centre_id <=> g.cost_centre_id) AND s.aon_bucket = g.aon_bucket
      LEFT JOIN at_risk_end en ON en.month = g.month
        AND (en.branch_id <=> g.branch_id) AND (en.process_id <=> g.process_id)
        AND (en.cost_centre_id <=> g.cost_centre_id) AND en.aon_bucket = g.aon_bucket
     ORDER BY g.month DESC, g.branch_name, g.cost_centre_code, g.process_name, g.bucket_order`;

  try {
    const paged = await fetchPageWithTotal(base, params, options, query, count);
    const total = paged.total;
    const rows = paged.rows as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err) {
    rethrowReportSchemaError("aon-bucket-attrition", err, base);
  }
}

// ---------------------------------------------------------------------------
// aon-overall-attrition-rate  (headline, company-wide, not bucket-scoped)
// ---------------------------------------------------------------------------
/**
 * Company-wide (or scope-wide) attrition rate per month: exits / average(headcount at
 * period start, headcount at period end) x 100. Deliberately simpler than the per-bucket
 * AON Attrition Rate above — this is the single number a CEO glances at first; the
 * bucketed version inside aon-bucket-attrition is for diagnosing WHERE in the tenure
 * curve it concentrates. Same average-of-endpoints approach, applied to the whole
 * (scope-filtered) population instead of one bucket.
 *
 * Reuses RELIABLE_POPULATION's reasoning: headcount at a past date is only answerable for
 * employees who are either still active or carry a date_of_exit, so both endpoints are
 * restricted to that population. POSSIBLE_TENURE-style corruption does not apply here —
 * there is no tenure bucket to land in, just "employed on date D or not".
 */
export async function overallAttritionRate(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const twelveMonthsAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const from = dateParam(filters.from, iso(twelveMonthsAgo));
  const to = dateParam(filters.to, iso(today));

  // The month_seq generator below builds each month as
  // DATE_ADD(<seed>, INTERVAL n MONTH) .. < DATE_ADD(<seed>, INTERVAL n+1 MONTH). If <seed>
  // is `from` verbatim (e.g. a 25th-of-the-month date), every "month" window runs 25th-to-25th
  // and DATE_FORMAT(month_start, '%Y-%m') mislabels it — verified live 2026-08-25: the row
  // labelled '2026-06' actually covered 2026-06-25..2026-07-25 and produced 221 exits, while a
  // plain COUNT(*) for the true calendar month of June 2026 gives 301. Truncating the seed to
  // the first of its month fixes this without changing the rest of the shape.
  const fromMonthStart = `${from.slice(0, 7)}-01`;

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push(`${AON_REFERENCE_JOIN_DATE_SQL} IS NOT NULL`, RELIABLE_POPULATION);
  const scopeSql = clauses.join(" AND ");

  /*
   * Rewritten 2026-08-25 to fix a real performance bug found by review and confirmed live:
   * the original shape ran 3 independent correlated subqueries (exits, headcount@start,
   * headcount@end) PER ROW of the 12-row month_seq — 3 x 12 = 36 full scoped scans of
   * `employees`. Timed live at 25.7s for a 2-month window; extrapolated to this function's
   * own 12-month default (also the frontend page's default range), that lands past this
   * codebase's 120s API gateway limit — the exact failure mode aon-bucket-shrinkage already
   * documents in its own header (65s/3mo, >120s/12mo).
   *
   * A lazy-load deferral (aon-bucket-shrinkage's fix for that same failure mode) is wrong
   * here specifically: this function IS the headline number a CEO glances at first, per its
   * own docstring — gating it behind a click defeats the point.
   *
   * Fixed by scanning `employees` exactly ONCE, cross-joined against the 12-row month_seq,
   * with each month's exits/headcount computed via conditional SUM(CASE ...) rather than a
   * separate correlated COUNT(*) subquery per month per metric. The scope/filter clause now
   * appears exactly once in the SQL text (one copy of `params`), not three.
   *
   * Live-timed 2026-08-25 for the full 12-month default window (unscoped, worst case): see
   * task-2-report.md for the measured elapsed time.
   */
  const base = `
    SELECT DATE_FORMAT(m.month_start, '%Y-%m') AS month,
           m.exits,
           m.avg_total_headcount,
           ROUND(m.exits * 100.0 / NULLIF(m.avg_total_headcount, 0), 2) AS attrition_rate_pct
      FROM (
        SELECT ms.month_start,
               SUM(
                 CASE WHEN e.date_of_exit IS NOT NULL
                           AND e.date_of_exit >= ms.month_start
                           AND e.date_of_exit < DATE_ADD(ms.month_start, INTERVAL 1 MONTH)
                      THEN 1 ELSE 0 END
               ) AS exits,
               (
                 SUM(
                   CASE WHEN ${AON_REFERENCE_JOIN_DATE_SQL} <= ms.month_start
                             AND (e.date_of_exit IS NULL OR e.date_of_exit >= ms.month_start)
                        THEN 1 ELSE 0 END
                 )
                 +
                 SUM(
                   CASE WHEN ${AON_REFERENCE_JOIN_DATE_SQL} <= LAST_DAY(ms.month_start)
                             AND (e.date_of_exit IS NULL OR e.date_of_exit >= LAST_DAY(ms.month_start))
                        THEN 1 ELSE 0 END
                 )
               ) / 2.0 AS avg_total_headcount
          FROM employees e
          CROSS JOIN (
            SELECT DATE_ADD(DATE(?), INTERVAL n MONTH) AS month_start
              FROM (SELECT 0 AS n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
                    UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
                    UNION SELECT 10 UNION SELECT 11) months
             WHERE DATE_ADD(DATE(?), INTERVAL n MONTH) <= DATE(?)
          ) ms
         WHERE ${scopeSql}
         GROUP BY ms.month_start
      ) m
     ORDER BY month`;

  // The month_seq generator's 3 placeholders (DATE(?) seed, then the WHERE comparison's two
  // more) are textually FIRST in this query (inside the CROSS JOIN's derived table), so they
  // bind first; the scope/filter params appear exactly once now, after them. The seed uses
  // fromMonthStart (not raw `from`) so month windows land on calendar-month boundaries.
  const finalParams = [fromMonthStart, fromMonthStart, to, ...params];

  try {
    const rows = await query(base, finalParams);
    return { rows: rows as Record<string, unknown>[], rowCount: rows.length, isTruncated: false };
  } catch (err) {
    rethrowReportSchemaError("aon-overall-attrition-rate", err, base);
  }
}

// ---------------------------------------------------------------------------
// aon-bucket-shrinkage  (aggregate — no row-level cursor)
// ---------------------------------------------------------------------------
/**
 * Shrinkage per month x branch x cost centre x process x AON-at-date bucket.
 *
 * ── The formula is copied, not reinvented ───────────────────────────────────────
 * total_shrinkage_pct and unplanned_shrinkage_pct are the expressions
 * daily-shrinkage-report already serves, character for character, so this report
 * reconciles to the one the business already uses. In particular 'missing_punch' falls
 * INSIDE total shrinkage (it is not one of present/half_day/week_off_worked) and OUTSIDE
 * unplanned shrinkage (which counts 'absent' only). That is a deliberate carry-over, not
 * an oversight — it was reviewed and kept so the two reports agree. missing_punch is
 * additionally broken out as its own column, because at 9,851 rows in Jul-2026 it is the
 * second-largest status and a reader needs to know how much of "total" is a data gap.
 *
 * ── Why coverage_pct exists ─────────────────────────────────────────────────────
 * Shrinkage is computed over employee-days that EXIST in attendance_daily_record. In
 * Jul-2026, 79 of the 198 employees in the 0-30 bucket had no attendance row at all, so
 * that bucket's percentage rests on 119 of 198 people. Without the coverage column the
 * number looks like a fact about the bucket when it is partly a fact about biometric
 * enrolment. 34 cost-centre x process groups (6,521 employee-days, ~15% of the month)
 * had zero worked days entirely and read as 100% shrinkage.
 *
 * ── Performance ─────────────────────────────────────────────────────────────────
 * The window is a half-open range on record_date. Do not rewrite it as
 * DATE_FORMAT(record_date,'%Y-%m') = ? or LEFT(record_date,7) = ?: wrapping the column in
 * a function is non-sargable and defeats all eight indexes on it, which is the documented
 * root cause of monthly-shrinkage-trend taking ~35s. Measured on live 2026-08-15: this
 * shape returns 181 rows for a month in 4.5s, and a 12-month window scans 128,440 rows in
 * ~4.8s.
 */
export async function aonBucketShrinkage(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 1);

  const from = dateParam(filters.from, iso(threeMonthsAgo));
  // Half-open upper bound: callers pass an inclusive date, so the range runs to the day
  // after it. BETWEEN would silently drop everything after midnight if record_date ever
  // becomes a DATETIME.
  const toInclusive = dateParam(filters.to, iso(today));

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push(
    "e.date_of_joining IS NOT NULL",
    "adr.record_date >= ?",
    "adr.record_date < DATE_ADD(?, INTERVAL 1 DAY)"
  );
  params.push(from, toInclusive);

  const bucket = aonBucketSql("adr.record_date");
  const bucketOrder = aonBucketOrderSql("adr.record_date");

  const base = `
    SELECT DATE_FORMAT(adr.record_date, '%Y-%m')       AS month,
           COALESCE(b.branch_name, 'UNASSIGNED')       AS branch_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(p.process_name, 'UNASSIGNED')      AS process_name,
           b.id  AS branch_id,
           cc.id AS cost_centre_id,
           p.id  AS process_id,
           ${bucket} AS aon_bucket,
           COUNT(*)                                        AS emp_days,
           COUNT(DISTINCT adr.employee_id)                 AS employees_with_attendance,
           SUM(adr.attendance_status = 'present')          AS present_days,
           SUM(adr.attendance_status = 'half_day')         AS half_days,
           SUM(adr.attendance_status = 'absent')           AS absent_days,
           SUM(adr.attendance_status = 'leave_approved')   AS leave_days,
           SUM(adr.attendance_status = 'missing_punch')    AS missing_punch_days,
           SUM(adr.attendance_status = 'week_off')         AS week_off_days,
           -- Emitted because it is part of the "worked" numerator below and without it
           -- total_shrinkage_pct cannot be recomputed from the other columns. It is small
           -- (0/4/5/45 employee-days across the four buckets in Jul-2026) which is exactly
           -- why it is easy to leave out and then mis-reconcile by ~0.16pp — that happened
           -- while verifying this report.
           SUM(adr.attendance_status = 'week_off_worked')  AS week_off_worked_days,
           SUM(adr.attendance_status = 'holiday')          AS holiday_days,
           -- Identical to daily-shrinkage-report. missing_punch lands inside total and
           -- outside unplanned, by design, so the two reports reconcile.
           ROUND(
             (COUNT(*) - SUM(adr.attendance_status IN ('present','half_day','week_off_worked')))
             / NULLIF(COUNT(*), 0) * 100,
             2
           ) AS total_shrinkage_pct,
           ROUND(
             SUM(adr.attendance_status = 'absent') / NULLIF(COUNT(*), 0) * 100,
             2
           ) AS unplanned_shrinkage_pct,
           -- What fraction of this row's employee-days is a missing punch rather than a
           -- recorded outcome. High values mean the shrinkage figure is a feed gap.
           ROUND(
             SUM(adr.attendance_status = 'missing_punch') / NULLIF(COUNT(*), 0) * 100,
             2
           ) AS missing_punch_pct
      FROM attendance_daily_record adr
      JOIN employees e                ON e.id  = adr.employee_id
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN process_master p      ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY DATE_FORMAT(adr.record_date, '%Y-%m'),
              b.branch_name, cc.cost_centre_code, cc.cost_centre_name, p.process_name,
              b.id, cc.id, p.id,
              ${bucket}, ${bucketOrder}
     ORDER BY month DESC, b.branch_name, cc.cost_centre_code, p.process_name, ${bucketOrder}`;

  try {
    const paged = await fetchPageWithTotal(base, params, options, query, count);
    const total = paged.total;
    const rows = paged.rows as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err) {
    rethrowReportSchemaError("aon-bucket-shrinkage", err, base);
  }
}

// ---------------------------------------------------------------------------
// aon-cohort-survival  (aggregate — no row-level cursor)
// ---------------------------------------------------------------------------
/**
 * One row per joining-cohort month x branch x cost centre, with survival at 30/60/90 days.
 *
 * This is the report the whole exercise exists for. Measured live on 2026-08-15, every
 * cohort from 2025-08 to 2026-05 lost between 36.9% and 48.5% of its joiners within 30
 * days, and roughly two-thirds within 90 — a stable, repeating pattern that a
 * point-in-time bucket count cannot show, because the survivors and the leavers end up in
 * different buckets.
 *
 * ── Why the cohort is only counted once it has had time to fail ─────────────────
 * A cohort that joined 10 days ago cannot have a meaningful 30-day survival figure: its
 * left_by_30 is structurally 0 and its survival_30_pct would print a flattering 100%.
 * Each horizon is therefore emitted as NULL until the cohort is old enough to have
 * reached it, rather than as a number that is true but misleading. is_mature_30/60/90
 * carry that state explicitly so the frontend can grey the cell instead of drawing a
 * point on the trend line.
 *
 * The cohort denominator is every joiner in that month within the reliable population,
 * including those who have since left — that is what a cohort is. It is NOT filtered to
 * currently-active employees, which would silently make survival 100% by construction.
 */
export async function aonCohortSurvival(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const twelveMonthsAgo = new Date(today.getFullYear() - 1, today.getMonth(), 1);

  const from = dateParam(filters.from, iso(twelveMonthsAgo));
  const to = dateParam(filters.to, iso(today));

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push(
    "e.date_of_joining IS NOT NULL",
    RELIABLE_POPULATION,
    // Same exclusion as the attrition reports: a leaver whose exit precedes their joining
    // date would be counted as having left within 30 days of a cohort they were never in,
    // understating that month's survival.
    `(e.date_of_exit IS NULL OR ${POSSIBLE_TENURE})`,
    "e.date_of_joining >= ?",
    "e.date_of_joining <= ?"
  );
  params.push(from, to);

  // Days of observation available to the cohort, measured from the LAST day of the cohort
  // month so no member of it is credited with more exposure than the youngest member has.
  const cohortAge = `DATEDIFF(CURDATE(), LAST_DAY(${AON_REFERENCE_JOIN_DATE_SQL}))`;
  const leftBy = (d: number) =>
    `SUM(e.date_of_exit IS NOT NULL AND DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) <= ${d})`;
  const survival = (d: number) => `
    CASE WHEN MIN(${cohortAge}) >= ${d}
         THEN ROUND(100.0 - (${leftBy(d)} * 100.0 / NULLIF(COUNT(*), 0)), 2)
         ELSE NULL END`;

  const base = `
    SELECT DATE_FORMAT(e.date_of_joining, '%Y-%m')      AS cohort_month,
           COALESCE(b.branch_name, 'UNASSIGNED')        AS branch_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED')  AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED')  AS cost_centre_name,
           -- Process was absent here while every other AON report carried it, so a cohort
           -- could not be read per process — the dimension WFM actually plans against.
           COALESCE(p.process_name, 'UNASSIGNED')       AS process_name,
           b.id  AS branch_id,
           cc.id AS cost_centre_id,
           p.id  AS process_id,
           COUNT(*)                        AS joined,
           SUM(e.active_status = 1)        AS still_active,
           ${leftBy(30)} AS left_by_30,
           ${leftBy(60)} AS left_by_60,
           ${leftBy(90)} AS left_by_90,
           ${survival(30)} AS survival_30_pct,
           ${survival(60)} AS survival_60_pct,
           ${survival(90)} AS survival_90_pct,
           MIN(${cohortAge}) >= 30 AS is_mature_30,
           MIN(${cohortAge}) >= 60 AS is_mature_60,
           MIN(${cohortAge}) >= 90 AS is_mature_90,
           ROUND(AVG(CASE WHEN e.date_of_exit IS NOT NULL
                          THEN DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) END), 1)
             AS avg_tenure_days_of_leavers
      FROM employees e
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN process_master p      ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY DATE_FORMAT(e.date_of_joining, '%Y-%m'),
              b.branch_name, cc.cost_centre_code, cc.cost_centre_name, p.process_name,
              b.id, cc.id, p.id
     ORDER BY cohort_month DESC, b.branch_name, cc.cost_centre_code, p.process_name`;

  try {
    const paged = await fetchPageWithTotal(base, params, options, query, count);
    const total = paged.total;
    const rows = paged.rows as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err) {
    rethrowReportSchemaError("aon-cohort-survival", err, base);
  }
}

// ---------------------------------------------------------------------------
// attrition-deep-dive  (aggregate — no row-level cursor)
// ---------------------------------------------------------------------------
/**
 * Exits by AON bucket, sliced by a caller-selected dimension.
 *
 * One report code serves every cut rather than ten near-identical codes, because the
 * question is always the same ("which kind of joiner leaves early") and only the grouping
 * attribute changes. The dimension arrives as a filter and is resolved against a fixed
 * allow-list below — it is never interpolated from user input.
 *
 * ── What this report can and cannot answer ──────────────────────────────────────
 * It cannot answer WHY people leave. Exit reason is not captured anywhere in this
 * database: exit_request holds 2 rows in total, exit_interview_response and
 * attrition_record are empty, employee_exit_record is empty, and
 * legacy_history_snapshot carries a reason for 10 of 2,796 recent exits — 314 of its
 * 13,072 rows have any reason at all, 87 of those are the literal string '0', and its
 * dol column is NULL on every row. reason_captured_pct is emitted on every row for
 * exactly this purpose: a report that renders 0.4% is reporting a broken capture process,
 * where a blank column would have read as a rendering fault.
 *
 * What it does answer is what kind of person leaves, and when. Coverage on the 2,796
 * exits in the twelve months to 2026-08-15: branch 98.7%, cost centre 98.7%, department
 * 98.7%, manager 98.0%, designation 97.9%, source 98.6%, gender/DOB 98.7%, CTC 97.9% —
 * against process at 9.7%.
 */

/**
 * Hire source, normalised.
 *
 * The raw column is free text and dirty. 'WALKI IN' (1,222 exits) and 'WALK IN' (961) are
 * the same channel behind a typo, and reporting them separately splits the single largest
 * source across two rows and understates it by half. The remaining values are referring
 * employee codes ('MAS59226', 'Mas50239', bare digits), consultant names, and junk
 * ('1234', 'Na').
 *
 * Grouping is on this normalised expression; the raw value stays available through
 * source_raw on drill-down so nothing is hidden by the tidying.
 */
const SOURCE_NORMALISED = `
  CASE
    WHEN NULLIF(TRIM(e.source), '') IS NULL THEN 'Unspecified'
    WHEN UPPER(REPLACE(TRIM(e.source), ' ', '')) IN ('WALKIN', 'WALKIIN', 'WALKINN') THEN 'Walk-in'
    WHEN UPPER(TRIM(e.source)) REGEXP '^(MAS)?[0-9]+$' THEN 'Employee referral'
    WHEN UPPER(TRIM(e.source)) LIKE '%CONSULT%' THEN 'Consultant'
    WHEN UPPER(TRIM(e.source)) IN ('NA', 'N/A', 'NONE', 'OTHERS', 'OTHER') THEN 'Other'
    ELSE 'Other'
  END`;

/**
 * The dimensions this report can group by.
 *
 * A fixed map, not string interpolation of a user parameter — the value chosen by the
 * caller selects an entry here and nothing from the request reaches the SQL text.
 * `join` names the extra table the expression needs, so only the required joins are added.
 */
const DEEP_DIVE_DIMENSIONS: Record<
  string,
  { label: string; expr: string; join?: string; idExpr?: string }
> = {
  source: { label: "Source of Hire", expr: SOURCE_NORMALISED },
  branch: {
    label: "Branch",
    expr: "COALESCE(b.branch_name, 'UNASSIGNED')",
    join: "LEFT JOIN branch_master b ON b.id = e.branch_id",
    idExpr: "b.id",
  },
  cost_centre: {
    label: "Cost Centre",
    expr: "COALESCE(cc.cost_centre_name, 'UNASSIGNED')",
    join: "LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id",
    idExpr: "cc.id",
  },
  process: {
    label: "Process",
    expr: "COALESCE(p.process_name, 'UNASSIGNED')",
    join: "LEFT JOIN process_master p ON p.id = e.process_id",
    idExpr: "p.id",
  },
  department: {
    label: "Department",
    expr: "COALESCE(d.dept_name, 'UNASSIGNED')",
    join: "LEFT JOIN department_master d ON d.id = e.department_id",
    idExpr: "d.id",
  },
  designation: {
    label: "Designation",
    expr: "COALESCE(des.designation_name, 'UNASSIGNED')",
    join: "LEFT JOIN designation_master des ON des.id = e.designation_id",
    idExpr: "des.id",
  },
  reporting_manager: {
    label: "Reporting Manager",
    expr: `COALESCE(NULLIF(mgr.full_name, ''), mgr.employee_code, 'UNASSIGNED')`,
    join: "LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id",
    idExpr: "mgr.id",
  },
  gender: { label: "Gender", expr: "COALESCE(NULLIF(TRIM(e.gender), ''), 'UNASSIGNED')" },
  age_band: {
    label: "Age Band",
    expr: `CASE
             WHEN e.date_of_birth IS NULL THEN 'UNASSIGNED'
             WHEN TIMESTAMPDIFF(YEAR, e.date_of_birth, e.date_of_exit) < 21 THEN 'Under 21'
             WHEN TIMESTAMPDIFF(YEAR, e.date_of_birth, e.date_of_exit) < 26 THEN '21-25'
             WHEN TIMESTAMPDIFF(YEAR, e.date_of_birth, e.date_of_exit) < 31 THEN '26-30'
             WHEN TIMESTAMPDIFF(YEAR, e.date_of_birth, e.date_of_exit) < 41 THEN '31-40'
             ELSE '41+'
           END`,
  },
  ctc_band: {
    label: "CTC Band",
    expr: `CASE
             WHEN e.ctc IS NULL OR e.ctc <= 0 THEN 'UNASSIGNED'
             WHEN e.ctc < 15000 THEN 'Under 15k'
             WHEN e.ctc < 20000 THEN '15k-20k'
             WHEN e.ctc < 25000 THEN '20k-25k'
             WHEN e.ctc < 35000 THEN '25k-35k'
             ELSE '35k+'
           END`,
  },
  /**
   * A PROXY for exit type, and labelled as one everywhere it surfaces.
   *
   * resignation_date is populated on 2,668 of 2,796 recent exits but the average gap
   * between it and date_of_exit is 0.0 days — it mirrors the exit date rather than
   * recording when notice was given, so it cannot measure notice served. The only signal
   * it carries is its absence: 128 exits have none, which is weak evidence of an
   * absconding or termination rather than a resignation. It is emitted as
   * 'No resignation date' rather than 'Involuntary' precisely so nobody reads an inference
   * as a record.
   */
  exit_type_proxy: {
    label: "Exit Type (proxy)",
    expr: `CASE WHEN e.resignation_date IS NULL
                THEN 'No resignation date (abscond/termination?)'
                ELSE 'Resignation date recorded' END`,
  },
};

export async function attritionDeepDive(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const twelveMonthsAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());

  const from = dateParam(filters.from, iso(twelveMonthsAgo));
  const to = dateParam(filters.to, iso(today));

  const requested = typeof filters.dimension === "string" ? filters.dimension : "";
  const key = Object.prototype.hasOwnProperty.call(DEEP_DIVE_DIMENSIONS, requested)
    ? requested
    : "source";
  const dim = DEEP_DIVE_DIMENSIONS[key];

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push(
    "e.date_of_exit IS NOT NULL",
    "e.date_of_joining IS NOT NULL",
    POSSIBLE_TENURE,
    "e.date_of_exit BETWEEN ? AND ?"
  );
  params.push(from, to);

  const bucket = aonBucketSql("e.date_of_exit");
  const bucketOrder = aonBucketOrderSql("e.date_of_exit");
  // Real master-table FK for the 6 id-backed dimensions; a literal NULL, honestly, for the
  // 5 derived/proxy dimensions with no stable id to filter or drill by. Grouping by a
  // literal NULL is a no-op (it groups as a single value, same as omitting it), so it is
  // always safe to include in GROUP BY regardless of which branch this is.
  const dimensionIdExpr = dim.idExpr ?? "NULL";

  // The dimension's own join, plus the exit_request join that measures reason capture.
  // legacy_history_snapshot is deliberately NOT joined: it holds several rows per
  // employee_code and multiplied a 2,796-exit window to 3,107 during verification, for a
  // reason it supplies on 10 of them.
  const joins = [
    dim.join ?? "",
    "LEFT JOIN exit_request er ON er.employee_id = e.id",
  ]
    .filter(Boolean)
    .join("\n      ");

  const base = `
    SELECT '${key}' AS dimension,
           '${dim.label}' AS dimension_label,
           ${dim.expr} AS dimension_value,
           ${dimensionIdExpr} AS dimension_id,
           ${bucket} AS aon_bucket,
           COUNT(*) AS exits,
           ROUND(AVG(DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL})), 1) AS avg_tenure_days,
           -- This bucket's share of all exits for this dimension value.
           ROUND(
             COUNT(*) * 100.0
             / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY ${dim.expr}, ${dimensionIdExpr}), 0),
             2
           ) AS share_pct,
           -- The headline: of everyone who left from this dimension value, what fraction
           -- went inside 30 days. Constant across the value's four bucket rows by design,
           -- so the value can be ranked on it without re-aggregating.
           --
           -- The window wraps an AGGREGATE, not a raw column. Writing it as
           -- SUM(CASE WHEN DATEDIFF(...) <= 30 ...) OVER (...) reads naturally and is
           -- invalid: window functions are evaluated after GROUP BY, so the inner
           -- expression would reference an ungrouped e.date_of_exit and fail outright
           -- under ONLY_FULL_GROUP_BY rather than degrade.
           ROUND(
             SUM(SUM(CASE WHEN DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN 1 ELSE 0 END))
               OVER (PARTITION BY ${dim.expr}, ${dimensionIdExpr}) * 100.0
             / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY ${dim.expr}, ${dimensionIdExpr}), 0),
             2
           ) AS early_quit_rate,
           -- Emitted so the missing reason data reads as a finding, not a blank column.
           ROUND(
             SUM(NULLIF(TRIM(COALESCE(er.exit_reason_category, er.resignation_reason, '')), '') IS NOT NULL)
             * 100.0 / NULLIF(COUNT(*), 0),
             2
           ) AS reason_captured_pct
      FROM employees e
      ${joins}
     WHERE ${clauses.join(" AND ")}
     GROUP BY ${dim.expr}, ${dimensionIdExpr}, ${bucket}, ${bucketOrder}
     ORDER BY ${dim.expr}, ${bucketOrder}`;

  try {
    const paged = await fetchPageWithTotal(base, params, options, query, count);
    const total = paged.total;
    const rows = paged.rows as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err) {
    rethrowReportSchemaError("attrition-deep-dive", err, base);
  }
}
