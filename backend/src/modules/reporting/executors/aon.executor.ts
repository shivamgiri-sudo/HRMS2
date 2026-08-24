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

  const base = `
    SELECT DATE_FORMAT(e.date_of_exit, '%Y-%m')        AS month,
           COALESCE(b.branch_name, 'UNASSIGNED')       AS branch_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(p.process_name, 'UNASSIGNED')      AS process_name,
           ${bucket} AS aon_bucket,
           COUNT(*) AS exits,
           ROUND(AVG(DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL})), 1) AS avg_tenure_days,
           MIN(DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL})) AS min_tenure_days,
           MAX(DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL})) AS max_tenure_days,
           -- Share of the month's exits that fell in this bucket, within this group.
           ROUND(
             COUNT(*) * 100.0
             / NULLIF(SUM(COUNT(*)) OVER (
                 PARTITION BY DATE_FORMAT(e.date_of_exit, '%Y-%m'),
                              b.branch_name, cc.cost_centre_code, p.process_name
               ), 0),
             2
           ) AS pct_of_month_exits,
           -- How much of THIS row rests on a populated process_id. 272 of 2,796 recent
           -- exits carry one, so a process-grouped row is usually UNASSIGNED and the
           -- reader needs to see that in the row rather than infer it.
           ROUND(SUM(e.process_id IS NOT NULL) * 100.0 / NULLIF(COUNT(*), 0), 2)
             AS process_coverage_pct
      FROM employees e
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN process_master p      ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY DATE_FORMAT(e.date_of_exit, '%Y-%m'),
              b.branch_name, cc.cost_centre_code, cc.cost_centre_name, p.process_name,
              ${bucket}, ${bucketOrder}
     ORDER BY month DESC, b.branch_name, cc.cost_centre_code, p.process_name, ${bucketOrder}`;

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
              b.branch_name, cc.cost_centre_code, cc.cost_centre_name, p.process_name
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
const DEEP_DIVE_DIMENSIONS: Record<string, { label: string; expr: string; join?: string }> = {
  source: { label: "Source of Hire", expr: SOURCE_NORMALISED },
  branch: {
    label: "Branch",
    expr: "COALESCE(b.branch_name, 'UNASSIGNED')",
    join: "LEFT JOIN branch_master b ON b.id = e.branch_id",
  },
  cost_centre: {
    label: "Cost Centre",
    expr: "COALESCE(cc.cost_centre_name, 'UNASSIGNED')",
    join: "LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id",
  },
  process: {
    label: "Process",
    expr: "COALESCE(p.process_name, 'UNASSIGNED')",
    join: "LEFT JOIN process_master p ON p.id = e.process_id",
  },
  department: {
    label: "Department",
    expr: "COALESCE(d.dept_name, 'UNASSIGNED')",
    join: "LEFT JOIN department_master d ON d.id = e.department_id",
  },
  designation: {
    label: "Designation",
    expr: "COALESCE(des.designation_name, 'UNASSIGNED')",
    join: "LEFT JOIN designation_master des ON des.id = e.designation_id",
  },
  reporting_manager: {
    label: "Reporting Manager",
    expr: `COALESCE(NULLIF(mgr.full_name, ''), mgr.employee_code, 'UNASSIGNED')`,
    join: "LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id",
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
           ${bucket} AS aon_bucket,
           COUNT(*) AS exits,
           ROUND(AVG(DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL})), 1) AS avg_tenure_days,
           -- This bucket's share of all exits for this dimension value.
           ROUND(
             COUNT(*) * 100.0
             / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY ${dim.expr}), 0),
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
               OVER (PARTITION BY ${dim.expr}) * 100.0
             / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY ${dim.expr}), 0),
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
     GROUP BY ${dim.expr}, ${bucket}, ${bucketOrder}
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
