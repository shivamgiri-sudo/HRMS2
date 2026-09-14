-- Migration 273: Add candidate_status column + widen profile_status ENUM on ats_candidate
-- Most interview/offer columns (final_decision, walkin_end_stage, round1_result, offer_salary, etc.)
-- already existed from prior migrations. Only candidate_status was missing.
-- This migration is idempotent — the ALTER is skipped if the column already exists.

-- Use a stored procedure so we can check before altering (MySQL 8.0 doesn't support IF NOT EXISTS on ADD COLUMN)
DROP PROCEDURE IF EXISTS _migration_273;
DELIMITER ;;
CREATE PROCEDURE _migration_273()
BEGIN
  -- Add candidate_status if not present
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'candidate_status'
  ) THEN
    ALTER TABLE ats_candidate ADD COLUMN candidate_status VARCHAR(50) NULL;
  END IF;

  -- Widen profile_status ENUM only if employee_details_saved is missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate'
      AND COLUMN_NAME = 'profile_status'
      AND COLUMN_TYPE LIKE '%employee_details_saved%'
  ) THEN
    ALTER TABLE ats_candidate
      MODIFY COLUMN profile_status
        ENUM('registered','selected','onboarding_sent','profile_in_progress',
             'employee_details_saved','profile_submitted','onboarded','closed')
        NOT NULL DEFAULT 'registered';
  END IF;

  -- Backfill candidate_status for existing rows
  UPDATE ats_candidate SET candidate_status = CASE
    WHEN LOWER(COALESCE(final_decision, current_stage, '')) = 'selected' THEN 'selected'
    WHEN LOWER(COALESCE(final_decision, current_stage, '')) IN ('rejected','no show','no_show') THEN 'rejected'
    WHEN LOWER(current_stage) IN ('converted','onboarded','active_employee') THEN 'onboarded'
    ELSE 'registered'
  END
  WHERE candidate_status IS NULL;

  -- Add index if not present
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate'
      AND INDEX_NAME = 'idx_ats_cand_candidate_status'
  ) THEN
    CREATE INDEX idx_ats_cand_candidate_status ON ats_candidate (candidate_status);
  END IF;
END;;
DELIMITER ;
CALL _migration_273();
DROP PROCEDURE IF EXISTS _migration_273;
