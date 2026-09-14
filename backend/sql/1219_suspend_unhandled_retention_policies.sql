-- 1217_suspend_unhandled_retention_policies.sql
--
-- HRMS2 delta-audit, 2026-08-14 (P1, DPDP): data_retention_policy carries 7
-- active (is_active=1) rows, but privacy-retention.worker.ts can only ever
-- act on ONE of them end-to-end (ats_candidate — has both an ENTITY_QUERIES
-- candidate-identification query AND an ANONYMIZE_HANDLERS execution
-- handler). is_active=1 on the other 6 is a false compliance signal: anyone
-- reading this table sees "7 retention policies configured" when only 1
-- actually does anything.
--
-- Verified live before writing this migration (read-only, 2026-08-14):
--   privacy_retention_candidate is completely empty across every entity_type,
--   including ats_candidate — confirming this isn't a case of "it's working,
--   just no candidates exist yet" for the other 6; they cannot produce a
--   candidate row at all in 5 of 6 cases (no query exists), and the 6th
--   (employees) can identify candidates in dry-run but has no handler to
--   ever act on them.
--
-- Breakdown of the 6 rows suspended here:
--   data_breach_log, leave_request, portal_otp, salary_prep_run,
--   wfm_attendance_session — no ENTITY_QUERIES entry at all. The worker's
--     `if (!queryTemplate) continue;` skips these silently before a single
--     candidate row is ever written — completely invisible, not even in a
--     dry run.
--   employees — HAS a working ENTITY_QUERIES entry (correctly identifies
--     exited employees past the 8-year/2920-day retention window in
--     dry-run), but has no ANONYMIZE_HANDLERS entry, so approved_actions
--     mode would silently do nothing if ever triggered. Its declared
--     action_on_expiry is 'archive', which — separately — the worker does
--     not implement as a distinct operation anywhere (only anonymize-style
--     handlers exist); building real archival is new engineering, not a
--     reconnection, and is explicitly deferred (Section K item 5, Option A,
--     scheduled follow-up — this migration is Option B only).
--
-- This is a data-visibility fix, not a policy retraction: retention_days,
-- action_on_expiry and every other column are left untouched. Per the
-- approved recommendation (Option B: stop the false signal now; Option A —
-- build the missing handlers — is separate, scheduled follow-up work), only
-- is_active flips to 0.
--
-- Reactivation: once a genuine ENTITY_QUERIES + ANONYMIZE_HANDLERS pair (or,
-- for employees, a real 'archive' implementation) exists for a given
-- entity_type, set is_active = 1 back for that specific row — do not
-- reactivate all 6 at once just because one became real.
--
-- Idempotent: safe to re-run: a second execution updates 0 rows.

UPDATE data_retention_policy
   SET is_active = 0,
       updated_at = NOW()
 WHERE entity_type IN (
         'data_breach_log',
         'leave_request',
         'portal_otp',
         'salary_prep_run',
         'wfm_attendance_session',
         'employees'
       )
   AND is_active = 1;
