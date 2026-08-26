/**
 * One definition of the reporting workforce population.
 *
 * Every executor used to spell out its own rule, and they diverged: the AON page counted
 * `active_status = 1` alone and reported 1,121 where every other page reported 1,091. The
 * extra 30 were people who resigned or were terminated in June/July 2026 and whose
 * active_status flag was never cleared — verified live 2026-08-26, all 30 carry a
 * date_of_exit, and the inverse case (employment_status active, active_status not 1)
 * returns zero rows.
 *
 * These are SQL fragments rather than query builders so callers keep control of their joins.
 */

/** Default table alias used across the reporting executors. */
const A = "e";

/**
 * The active-employee test.
 *
 * LOWER() is mandatory, not stylistic. Reactivation writes employment_status = 'Active'
 * with a capital A, and the column already holds 'Active' 273 against 'active' 1,039.
 *
 * `date_of_exit IS NULL` is deliberately NOT part of this: 28,426 inactive employees carry
 * no exit date at all and would every one be counted as active.
 */
export const ACTIVE_EMPLOYEE_SQL = (alias: string = A): string =>
  `${alias}.active_status = 1 AND LOWER(COALESCE(${alias}.employment_status, 'active')) = 'active'`;

/**
 * The date AON is measured from. salary_start_date wins when present; 1,063 of 1,091 active
 * employees have it equal to date_of_joining anyway.
 */
export const AON_REFERENCE_DATE_SQL = (alias: string = A): string =>
  `COALESCE(${alias}.salary_start_date, ${alias}.date_of_joining)`;

export const IN_TRAINING_LABEL = "In Training" as const;

/**
 * Joined and on the floor, but not yet on payroll.
 *
 * Validated live: 1,063 of 1,091 active employees have salary_start_date = date_of_joining,
 * 28 have a later salary date (most commonly by exactly 6 days — a training week), and none
 * has a salary date before joining. 13 were in this state on 2026-08-26.
 *
 * Used with asOf = date_of_exit this reads "left before payroll started", i.e. quit during
 * training, which is a real category rather than an artefact.
 */
export const IN_TRAINING_SQL = (alias: string = A, asOf: string = "CURDATE()"): string =>
  `${alias}.date_of_joining <= ${asOf} AND ${alias}.salary_start_date > ${asOf}`;

export const AON_BUCKETS = ["In Training", "0-30", "31-60", "61-90", "90+"] as const;
export type AonBucket = (typeof AON_BUCKETS)[number];

/**
 * Tenure in days, floored at zero.
 *
 * The clamp is load-bearing. The previous bucket test was `DATEDIFF(...) <= 30 THEN '0-30'`,
 * and a NEGATIVE DATEDIFF satisfies `<= 30` — which is how employees whose reference date had
 * not arrived were silently counted as the newest joiners.
 */
const AON_DAYS = (alias: string, asOf: string): string =>
  `GREATEST(DATEDIFF(${asOf}, ${AON_REFERENCE_DATE_SQL(alias)}), 0)`;

export const AON_BUCKET_SQL = (alias: string = A, asOf: string = "CURDATE()"): string => `CASE
             WHEN ${IN_TRAINING_SQL(alias, asOf)} THEN '${IN_TRAINING_LABEL}'
             WHEN ${AON_DAYS(alias, asOf)} <= 30 THEN '0-30'
             WHEN ${AON_DAYS(alias, asOf)} <= 60 THEN '31-60'
             WHEN ${AON_DAYS(alias, asOf)} <= 90 THEN '61-90'
             ELSE '90+'
           END`;

/** Sort key. A string sort puts '90+' ahead of '0-30'; every report orders by this instead. */
export const AON_BUCKET_ORDER_SQL = (alias: string = A, asOf: string = "CURDATE()"): string => `CASE
             WHEN ${IN_TRAINING_SQL(alias, asOf)} THEN 0
             WHEN ${AON_DAYS(alias, asOf)} <= 30 THEN 1
             WHEN ${AON_DAYS(alias, asOf)} <= 60 THEN 2
             WHEN ${AON_DAYS(alias, asOf)} <= 90 THEN 3
             ELSE 4
           END`;
