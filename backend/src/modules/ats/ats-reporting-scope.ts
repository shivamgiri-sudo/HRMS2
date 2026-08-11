/**
 * Excludes legacy-imported employee rows from ats_candidate aggregate counts.
 *
 * ats_candidate (37,696 rows) contains 29,926 rows whose candidate_code exactly matches a real
 * employees.employee_code. The whole employee roster was bulk-imported into this table at some
 * point; no current INSERT path sources ats_candidate from employees. Only 7,770 rows are
 * genuine candidates. Every dashboard/funnel/conversion/source-effectiveness query that counts
 * ats_candidate rows without this exclusion overstates its numbers by roughly 4x.
 *
 * Do NOT use this in candidate dedup/fraud-matching (ats.service.ts's mobile/email duplicate
 * checks, duplicate-identity.ts's PAN/Aadhaar/bank matching) — that code deliberately includes
 * employee-linked rows so a re-applying ex-employee is still caught as a duplicate/fraud
 * signal. This fragment is for aggregate reporting only.
 *
 * `candidateAlias` must be the ats_candidate alias in the calling query (pass the literal table
 * name, e.g. "ats_candidate", if the query has no alias).
 *
 * ── WHY THIS IS NOW A COLUMN AND NOT A JOIN ──────────────────────────────────
 * This used to emit a correlated
 *   NOT EXISTS (SELECT 1 FROM employees e2 WHERE e2.employee_code = <alias>.candidate_code)
 * which ~20 call sites each re-ran over 30k rows. Migration 1130 added ats_candidate.record_type
 * and scripts/ats-candidate-record-type-backfill.mjs populated it (29,926 legacy_employee /
 * 7,770 candidate, applied 2026-08-11).
 *
 * Equivalence was measured on production before the switch, not assumed:
 *   rows included            7,770 under both predicates
 *   row-by-row disagreements 0
 *   funnel output            byte-identical
 *   count latency            18,783ms -> 4,428ms
 *
 * ── THE ONE THING TO WATCH ───────────────────────────────────────────────────
 * record_type is a SNAPSHOT of a join, so it can drift where the join could not. New rows
 * default to 'candidate', which is correct for everything the registration and import paths
 * write today — but another bulk load of employee-shaped rows would arrive labelled
 * 'candidate' and silently rejoin the counts.
 *
 * The column is derived and never a source of truth, so drift is always detectable and always
 * repairable by re-running the backfill:
 *
 *   SELECT SUM(e.id IS NOT NULL AND ac.record_type <> 'legacy_employee') AS legacy_mislabelled,
 *          SUM(e.id IS NULL     AND ac.record_type <> 'candidate')       AS genuine_mislabelled
 *     FROM ats_candidate ac LEFT JOIN employees e ON e.employee_code = ac.candidate_code;
 *
 * Both must be 0. That is exactly what the backfill prints as its own verification, and
 * re-running it is idempotent.
 */
export function excludeEmployeeShapedCandidatesSql(candidateAlias: string): string {
  return `${candidateAlias}.record_type = 'candidate'`;
}

/**
 * The drift check above, as SQL, so a health probe or a scheduled job can assert it rather than
 * relying on someone remembering the query. Returns one row with two counts; both must be 0.
 */
export function recordTypeDriftSql(): string {
  return `SELECT SUM(e.id IS NOT NULL AND ac.record_type <> 'legacy_employee') AS legacy_mislabelled,
                 SUM(e.id IS NULL     AND ac.record_type <> 'candidate')       AS genuine_mislabelled
            FROM ats_candidate ac
            LEFT JOIN employees e ON e.employee_code = ac.candidate_code`;
}
