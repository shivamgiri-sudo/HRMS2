/**
 * Excludes legacy-imported employee rows from ats_candidate aggregate counts.
 *
 * ats_candidate (37,562 rows) contains 29,926 rows whose candidate_code exactly
 * matches a real employees.employee_code — confirmed live via
 * `SELECT COUNT(*) FROM ats_candidate c JOIN employees e ON e.employee_code = c.candidate_code`.
 * The whole employee roster was bulk-imported into this table at some point in the
 * past; no current INSERT path sources ats_candidate from employees. Every
 * dashboard/funnel/conversion/source-effectiveness query that counts ats_candidate
 * rows without this exclusion overstates its numbers by roughly 4x.
 *
 * Do NOT use this in candidate dedup/fraud-matching (ats.service.ts's mobile/email
 * duplicate checks, duplicate-identity.ts's PAN/Aadhaar/bank matching) — that code
 * deliberately includes employee-linked rows so a re-applying ex-employee is still
 * caught as a duplicate/fraud signal. This fragment is for aggregate reporting only.
 *
 * `candidateAlias` must be the ats_candidate alias in the calling query (pass the
 * literal table name, e.g. "ats_candidate", if the query has no alias). Uses a fixed
 * `e2` alias for the employees side so it is safe to append to a query that already
 * joins `employees e` for an unrelated purpose.
 */
export function excludeEmployeeShapedCandidatesSql(candidateAlias: string): string {
  return `NOT EXISTS (SELECT 1 FROM employees e2 WHERE e2.employee_code = ${candidateAlias}.candidate_code)`;
}
