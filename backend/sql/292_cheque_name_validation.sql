-- 292_cheque_name_validation.sql
-- Cheque name vs account-holder-name mismatch queue routed to Payroll HO.
-- Onboarding is NEVER blocked — mismatches are queued for manual review.
-- Additive migration.

-- ── Validation queue ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cheque_name_validation (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id       CHAR(36)     NOT NULL,
  bank_detail_id     CHAR(36)     NULL,          -- candidate_onboarding_bank_detail.id
  cheque_document_id CHAR(36)     NULL,          -- candidate_onboarding_document.id
  name_on_cheque     VARCHAR(255) NULL,           -- Name typed by candidate from cheque image
  name_in_profile    VARCHAR(255) NULL,           -- account_holder_name at time of submission
  match_status       ENUM('matched','mismatch','manual_validated','rejected')
                     NOT NULL DEFAULT 'mismatch',
  validated_by       CHAR(36)     NULL,           -- Payroll HO user_id
  validated_at       DATETIME     NULL,
  validator_note     TEXT         NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cnv_candidate (candidate_id),
  INDEX idx_cnv_status    (match_status)
);

-- ── Extend candidate_onboarding_bank_detail ───────────────────────────────────
ALTER TABLE candidate_onboarding_bank_detail
  ADD COLUMN IF NOT EXISTS cheque_validation_id    CHAR(36)     NULL
    COMMENT 'FK to cheque_name_validation.id',
  ADD COLUMN IF NOT EXISTS name_validation_status
    ENUM('not_required','matched','pending_review','validated','rejected')
    NOT NULL DEFAULT 'not_required'
    COMMENT 'Result of cheque name vs account holder name check';
