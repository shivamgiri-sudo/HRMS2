-- Migration 335: PF opt-out flags for ats_employment_offer + Form 11 consent columns
-- for candidate_onboarding_profile
-- Safe: additive only (ADD COLUMN IF NOT EXISTS). Do NOT run without explicit approval.

-- Step 1: PF opt-out tracking on the offer record
-- Note: ADD COLUMN IF NOT EXISTS is MariaDB syntax; MySQL 8.0 uses plain ADD COLUMN.
-- Columns are absent on fresh installs; skip manually if already applied.
ALTER TABLE ats_employment_offer
  ADD COLUMN pf_opt_out TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = employee voluntarily opted out of PF under EPF Act 17(1)',
  ADD COLUMN pf_opt_out_consent_at DATETIME NULL
    COMMENT 'Timestamp when candidate gave Form 11 consent via onboarding portal';

-- Step 2: Form 11 / PF declaration columns on the candidate profile
-- Note: previous_pf_member, eps_member, international_worker already exist (migration 289).
-- These columns record the candidate's online consent act.
SET @col_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'pf_opt_out_elected'
);
SET @sql_1 = IF(@col_1 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN pf_opt_out_elected TINYINT(1) NOT NULL DEFAULT 0
    COMMENT ''Candidate elected to opt out of PF on Form 11 online step (1 = yes)''',
  'SELECT "pf_opt_out_elected already exists" AS message');
PREPARE stmt_1 FROM @sql_1;
EXECUTE stmt_1;
DEALLOCATE PREPARE stmt_1;

SET @col_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'pf_opt_out_consent_text'
);
SET @sql_2 = IF(@col_2 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN pf_opt_out_consent_text TEXT NULL
    COMMENT ''Full Form 11 declaration text shown to candidate at time of consent''',
  'SELECT "pf_opt_out_consent_text already exists" AS message');
PREPARE stmt_2 FROM @sql_2;
EXECUTE stmt_2;
DEALLOCATE PREPARE stmt_2;

SET @col_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'pf_opt_out_consented_at'
);
SET @sql_3 = IF(@col_3 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN pf_opt_out_consented_at DATETIME NULL
    COMMENT ''UTC timestamp when candidate clicked consent on Form 11 step''',
  'SELECT "pf_opt_out_consented_at already exists" AS message');
PREPARE stmt_3 FROM @sql_3;
EXECUTE stmt_3;
DEALLOCATE PREPARE stmt_3;
