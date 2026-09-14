/**
 * Safe LIMIT/OFFSET for prepared statements.
 *
 * `db.execute()` prepares the statement, and MySQL refuses a bound parameter in LIMIT there:
 * `LIMIT ? OFFSET ?` fails with "Incorrect arguments to mysqld_stmt_execute" on every call,
 * regardless of whether the bound values are numbers. The endpoint does not degrade - it throws,
 * so the page behind it has never worked. That defect was found and fixed three separate times
 * (cost-centre-management.service.ts, report-request.service.ts, reimbursements.routes.ts) before
 * a repo-wide scan showed 26 more live instances.
 *
 * Interpolating the clause is the remedy, but interpolating user input into SQL is only safe if
 * the values cannot be anything other than integers. That is this function's whole job: it is the
 * single place that guarantee is made, so 26 call sites do not each have to re-derive it.
 *
 * Anything that is not a finite number - NaN, Infinity, null, undefined, "", {}, or
 * "12; DROP TABLE employees" - collapses to the fallback rather than reaching the query, and
 * `Math.trunc` removes any fractional part before the value is stringified. The `Number.isFinite`
 * check is load-bearing and not decoration: `Math.max(0, Infinity)` is `Infinity`, which would
 * have emitted the literal `OFFSET Infinity`. The test suite pins the invariant that the output
 * always matches /^LIMIT \d+ OFFSET \d+$/.
 *
 * Use inside a template literal, and drop limit/offset from the params array:
 *
 *     `SELECT ... ${where} ORDER BY x DESC ${sqlLimitOffset(limit, offset)}`, params
 */
export function sqlLimitOffset(
  limit: unknown,
  offset: unknown,
  options: { defaultLimit?: number; maxLimit?: number } = {},
): string {
  const { defaultLimit = 50, maxLimit = 500 } = options;

  const rawLimit = Math.trunc(Number(limit));
  const usableLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit;
  const safeLimit = Math.max(1, Math.min(usableLimit, maxLimit));

  const rawOffset = Math.trunc(Number(offset));
  const safeOffset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  return `LIMIT ${safeLimit} OFFSET ${safeOffset}`;
}

/**
 * The same guarantee for a query that limits without an offset.
 *
 * A bare `LIMIT ?` is not automatically safe just because it has no OFFSET. Probing both live
 * servers showed the tolerance differs by version, and in the direction most people assume
 * backwards:
 *
 *   mas_hrms   (MySQL 8.0.42)  LIMIT ? bound to a NUMBER -> ER_WRONG_ARGUMENTS
 *                              LIMIT ? bound to a STRING -> works
 *   db_bill    (MySQL 5.5.44)  both work
 *
 * So on mas_hrms the query breaks precisely where the code was careful enough to call Number()
 * or clamp with Math.min, and appears to work where a raw query-string value was passed straight
 * through. Interpolating removes the version- and type-dependence entirely.
 */
export function sqlLimit(
  limit: unknown,
  options: { defaultLimit?: number; maxLimit?: number } = {},
): string {
  const { defaultLimit = 50, maxLimit = 500 } = options;
  const raw = Math.trunc(Number(limit));
  const usable = Number.isFinite(raw) && raw > 0 ? raw : defaultLimit;
  return `LIMIT ${Math.max(1, Math.min(usable, maxLimit))}`;
}
