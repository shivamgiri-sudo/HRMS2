-- 1070: Correct the residue of the BGV auto-approve, and backfill the bridge.
--
-- Two data corrections, both evidence-restricted. Companion to commit c591bfdc,
-- which removed the code that caused the first and fixed the code that caused
-- the second.
--
-- PART A — the falsely-cleared BGV records.
--
-- `triggerBgvAfterOnboardingSubmit` (now removed) wrote seven checks per
-- candidate as provider_key='system', status='verified', and stamped the report
-- overall_status='clear', bgv_score=100 — without running a single
-- verification. Submitting the onboarding form was the whole of the check.
--
-- Affected: 6 candidates, 42 check rows, 6 reports. Verified before writing
-- that none of the 6 carries ANY real provider check (provider_key not in
-- system/mock/mock_bgv) — so nothing genuine is being discarded — and that
-- none of the 6 reports is locked.
--
-- Checks go to 'not_started', which is what they always were: nobody ran them.
-- Reports go to 'pending' with score 0. Both keep an explicit remark so the
-- correction is visible rather than looking like the data was always this way.
--
-- PART B — the onboarding bridge backfill.
--
-- ats_onboarding_bridge.digilocker_status and .penny_drop_status were never
-- written by anything; all 304 rows read 'not_started' while real verifications
-- had happened. The code now writes them going forward. This catches up the
-- rows that already have evidence.
--
-- Strictly evidence-gated, and this is the part that is easy to get wrong:
-- eleven bridge rows have a bank check reading 'verified', but only four of
-- those came from a provider. The other seven are Part A's fakes. Crediting
-- them would assert a penny drop that never happened, in the very column meant
-- to prove one — so the penny-drop backfill requires a non-system provider AND
-- a non-empty provider_reference_id.
--
-- Idempotent: re-running changes nothing. Both parts are guarded by the state
-- they are moving away from.

-- ── PART A ────────────────────────────────────────────────────────────────────

-- Keep the pre-correction state so this is reversible.
CREATE TABLE IF NOT EXISTS bgv_auto_approve_correction_backup (
  id            CHAR(36)     NOT NULL,
  row_kind      VARCHAR(16)  NOT NULL,   -- 'check' | 'report'
  candidate_id  CHAR(36)     NOT NULL,
  old_status    VARCHAR(32)      NULL,
  old_score     INT              NULL,
  old_summary   TEXT             NULL,
  backed_up_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, row_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO bgv_auto_approve_correction_backup
  (id, row_kind, candidate_id, old_status, old_score, old_summary)
SELECT k.id, 'check', k.candidate_id, k.status, NULL, k.result_summary
  FROM candidate_bgv_check k
 WHERE k.provider_key = 'system'
   AND k.status = 'verified'
   AND k.result_summary LIKE 'Auto-approved%';

INSERT IGNORE INTO bgv_auto_approve_correction_backup
  (id, row_kind, candidate_id, old_status, old_score, old_summary)
SELECT r.id, 'report', r.candidate_id, r.overall_status, r.bgv_score, r.hr_remarks
  FROM candidate_bgv_report r
 WHERE r.hr_remarks LIKE 'Auto-approved%';

-- The checks were never run. 'not_started' is the truth.
UPDATE candidate_bgv_check
   SET status = 'not_started',
       verified_at = NULL,
       result_summary = CONCAT(
         'Reset: was auto-marked verified on onboarding submit without any ',
         'verification being performed. Requires a real check.'),
       updated_at = NOW()
 WHERE provider_key = 'system'
   AND status = 'verified'
   AND result_summary LIKE 'Auto-approved%';

-- A signed-off (locked) report is never touched. None currently are.
UPDATE candidate_bgv_report
   SET overall_status = 'pending',
       bgv_score = 0,
       hr_remarks = CONCAT(
         'Corrected: this report was auto-marked clear with a score of 100 on ',
         'onboarding submit, with no verification performed. Reset to pending ',
         'so the checks can be run properly.'),
       updated_at = NOW()
 WHERE hr_remarks LIKE 'Auto-approved%'
   AND locked = 0;

-- ── PART B ────────────────────────────────────────────────────────────────────

-- ats_onboarding_bridge has NO updated_at column. It carries created_at and a
-- purpose-built timestamp per milestone: digilocker_completed_at and
-- penny_drop_verified_at. An earlier run of this migration set updated_at and
-- failed with ER_BAD_FIELD_ERROR here at Part B — which is how the identical
-- bug was found in the application code, where it had been failing silently
-- because that call is intentionally swallowed.

-- DigiLocker: only where a session genuinely reached 'completed'.
-- Note the bridge's vocabulary is 'documents_received' — 'passed' belongs to
-- candidate_bgv_report and would throw here under STRICT mode.
UPDATE ats_onboarding_bridge b
   SET b.digilocker_status = 'documents_received',
       b.digilocker_completed_at = COALESCE(b.digilocker_completed_at, NOW())
 WHERE b.digilocker_status <> 'documents_received'
   AND EXISTS (
     SELECT 1 FROM candidate_digilocker_session s
      WHERE s.candidate_id = b.candidate_id
        AND s.session_status = 'completed');

-- Penny drop: real provider results ONLY. See the note at the top about the
-- seven 'system' rows that must not be credited.
UPDATE ats_onboarding_bridge b
   SET b.penny_drop_status = 'verified',
       b.penny_drop_verified_at = COALESCE(b.penny_drop_verified_at, NOW())
 WHERE b.penny_drop_status <> 'verified'
   AND EXISTS (
     SELECT 1 FROM candidate_bgv_check k
      WHERE k.candidate_id = b.candidate_id
        AND k.check_type = 'bank'
        AND k.status = 'verified'
        AND k.provider_key NOT IN ('system', 'mock', 'mock_bgv')
        AND k.provider_reference_id IS NOT NULL
        AND k.provider_reference_id <> '');
