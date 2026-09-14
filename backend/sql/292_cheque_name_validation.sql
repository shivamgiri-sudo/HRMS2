-- 292_cheque_name_validation.sql
-- Cheque name vs account-holder-name mismatch queue routed to Payroll HO.
-- Compatible with MySQL 5.7+ (no ADD COLUMN IF NOT EXISTS).

-- ── Validation queue ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cheque_name_validation (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id       CHAR(36)     NOT NULL,
  bank_detail_id     CHAR(36)     NULL,
  cheque_document_id CHAR(36)     NULL,
  name_on_cheque     VARCHAR(255) NULL,
  name_in_profile    VARCHAR(255) NULL,
  match_status       ENUM('matched','mismatch','manual_validated','rejected') NOT NULL DEFAULT 'mismatch',
  validated_by       CHAR(36)     NULL,
  validated_at       DATETIME     NULL,
  validator_note     TEXT         NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cnv_candidate (candidate_id),
  INDEX idx_cnv_status    (match_status)
);

-- ── candidate_onboarding_bank_detail: cheque_validation_id ───────────────────
SET @col1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_bank_detail'
    AND COLUMN_NAME = 'cheque_validation_id'
);
SET @sql1 = IF(@col1 = 0,
  'ALTER TABLE candidate_onboarding_bank_detail ADD COLUMN cheque_validation_id CHAR(36) NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1; EXECUTE s1; DEALLOCATE PREPARE s1;

-- ── candidate_onboarding_bank_detail: name_validation_status ─────────────────
SET @col2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_bank_detail'
    AND COLUMN_NAME = 'name_validation_status'
);
SET @sql2 = IF(@col2 = 0,
  "ALTER TABLE candidate_onboarding_bank_detail ADD COLUMN name_validation_status ENUM('not_required','matched','pending_review','validated','rejected') NOT NULL DEFAULT 'not_required'",
  'SELECT 1'
);
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;
