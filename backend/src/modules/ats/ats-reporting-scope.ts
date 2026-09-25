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
export function excludeEmployeeShapedCandidatesSql(
  candidateAlias: string,
): string {
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

/**
 * IDC records, excluded from MAS recruitment reporting.
 *
 * `ats_candidate` holds 2,738 rows whose candidate_code begins `IDC` — a June-2026 bulk import
 * of registered profiles belonging to IDC, the sister entity. They are not MAS recruitment and
 * they are not in `mas_hrms.employees` at all (salary-voucher-bill.service.ts records the same
 * boundary from the payroll side: "mas_hrms holds zero IDC employees. IDC's monthly payroll
 * lives in db_bill.salary_data"). This codebase already splits MAS from IDC wherever the two
 * meet — db_bill voucher reconciliation keys on the `MAS/` vs `IDC/` VchNo prefix, and the
 * db_bill→HRMS employee migration excluded IDC outright. The ATS Command Center was the one
 * surface that did not.
 *
 * The evidence that these are a separate population rather than MAS rows with missing fields,
 * measured on production 2026-08-27:
 *
 *              rows    no branch   no source   no recruiter   no process   selected
 *   C2026…    3,569        0           0            0             15        1,241
 *   CND-      1,903        0           0           10              0          417
 *   MAS          37        0           0            0              0           19
 *   IDC       2,738    2,735       2,735        2,735          2,735            0
 *
 * Every unattributed row on the dashboard was an IDC row, and every MAS row is attributed. So
 * the "Unspecified" branch, the "Unspecified" process, the "Unspecified" source and the
 * "Unassigned" recruiter were never a data-quality gap to be filled — they were another
 * company's records being counted as MAS arrivals. They contributed 2,738 to the denominator of
 * every rate on the page (holding the selection rate at 20.9% instead of 31.2%), supplied all
 * 111 of the stale multi-week queue entries that made the average wait read 22 days, and were
 * the entirety of four "largest" table rows.
 *
 * Excluded by default and reported, never silently dropped: the count travels in the payload as
 * `summary.excludedOtherEntity` so the dashboard can state what it left out.
 */
export function excludeOtherEntityCandidatesSql(
  candidateAlias: string,
): string {
  return `${candidateAlias}.candidate_code NOT LIKE 'IDC%'`;
}

/** True when a candidate row belongs to a different legal entity than MAS. */
export function isOtherEntityCandidateCode(code: unknown): boolean {
  return /^IDC/i.test(String(code ?? "").trim());
}

const SUBMISSION_REOPEN_GRACE_MINUTES = 5;

/**
 * Excludes candidates the recruiter has already disposed of, from a "still pending" queue.
 *
 * `getMyPendingCandidates`/`getOtherRecruitersPendingCandidates` (recruiterInterview.service.ts)
 * decide "pending" from `ats_candidate.status`/`current_stage` staying in an open value
 * (Waiting/New/Applied/Screening/Registered). A candidate stays in the queue until their STATUS is
 * closed — Selected, Rejected, Client Round, Hold, No Show, anything — however many days ago they
 * walked in.
 *
 * The one thing that closes a candidate without touching those columns is the recruiter's own
 * interview-outcome form:
 *   `ats_interview_submission` — submitInterviewUpdate() normally sets ats_candidate.status too,
 *   but a submission row can exist from a prior attempt while a later data fix or retry left status
 *   behind. Any submission row for the candidate is proof the recruiter's form has been filled in.
 *
 * Queue-token states are deliberately NOT resolution signals:
 *   - 'completed': the walk-in desk marks the token Completed once the candidate has been seen at the
 *     desk — before the recruiter fills the interview form (walkin-sla.cron.ts treats exactly that
 *     state as "feedback pending"). Excluding it emptied recruiters' queues (live 2026-09-24).
 *   - 'no_show': the queue's Mark No-Show button (or its auto sweep) closes the TOKEN without
 *     updating ats_candidate at all. Excluding on it made ~25 still-Waiting candidates vanish from
 *     five recruiters' pages (live 2026-09-25) with nobody having recorded a decision. Owner ruling
 *     2026-09-25 (supersedes 2026-09-24): pendency ends only when the candidate's status is closed,
 *     including a recorded No Show.
 * This is a read-side rule — it does not change what either write path stores.
 *
 * A submission only resolves the candidate if it is not older than the candidate's last update.
 * When a candidate is re-opened after a submission (e.g. Rejected, then moved back to Waiting /
 * "Round 2- Op's"), ats_candidate.updated_at moves past the submission and the candidate must
 * reappear. Live 2026-09-25: PARIKSHIT KAUSHIK (RAKHI) was hidden by a 09-18 Rejected submission
 * after being re-opened; 11 re-opened candidates across 7 recruiters were hidden the same way.
 *
 * `candidateAlias` must be the ats_candidate alias in the calling query (pass the literal table
 * name, e.g. "ats_candidate", if the query has no alias).
 */
export function excludeResolvedInterviewCandidatesSql(
  candidateAlias: string,
): string {
  return `NOT EXISTS (
      SELECT 1 FROM ats_interview_submission ais
       WHERE ais.candidate_id = ${candidateAlias}.id
         AND ais.submitted_at >= DATE_SUB(${candidateAlias}.updated_at, INTERVAL ${SUBMISSION_REOPEN_GRACE_MINUTES} MINUTE)
    )`;
}

/**
 * Excludes Meta lead-ad candidates who have not registered yet.
 *
 * createCandidateFromLead() (meta-campaign.service.ts) inserts an ats_candidate at stage 'Applied'
 * with status 'Waiting' the moment a lead qualifies — before the person has ever come to a branch.
 * Owner ruling 2026-09-25: a Meta lead appears in the walk-in queue and on a recruiter's My
 * Candidates only once they have filled the candidate registration form. Registration is what stamps
 * profile_status = 'registered' and walk_in_date, and is what issues the queue token; none of those
 * exist on an unregistered lead (live: 19 Waiting leads, all profile_status NULL, no token, no walk-in
 * date). Only Social Media candidates are held back — every other source keeps today's behaviour.
 *
 * `candidateAlias` must be the ats_candidate alias in the calling query (pass the literal table
 * name, e.g. "ats_candidate", if the query has no alias).
 */
export function excludeUnregisteredLeadCandidatesSql(
  candidateAlias: string,
): string {
  return `NOT (
      ${candidateAlias}.sourcing_channel = 'Social Media'
      AND COALESCE(${candidateAlias}.profile_status, '') = ''
      AND ${candidateAlias}.walk_in_date IS NULL
      AND NOT EXISTS (SELECT 1 FROM ats_queue_token lqt WHERE lqt.candidate_id = ${candidateAlias}.id)
    )`;
}
