-- Migration 273: Add candidate_status column + widen profile_status ENUM on ats_candidate
-- Most interview/offer columns (final_decision, walkin_end_stage, round1_result, offer_salary, etc.)
-- already existed from prior migrations. Only candidate_status was missing.
-- This migration is idempotent — each block is guarded by an INFORMATION_SCHEMA check.
--
-- NOTE: Rewritten from stored-procedure / DELIMITER pattern to PREPARE/EXECUTE guards.
-- The original DELIMITER version triggered a splitSql bug where CASE...END inside a
-- BEGIN...END procedure body incorrectly decremented the BEGIN-depth counter, causing
-- the procedure body to be split prematurely.

-- 1. Add candidate_status if not present
SET @_273_col = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'candidate_status');
SET @_273_sql = IF(@_273_col = 0,
  'ALTER TABLE ats_candidate ADD COLUMN candidate_status VARCHAR(50) NULL',
  'SELECT 1 -- candidate_status already exists');
PREPARE _273_stmt FROM @_273_sql; EXECUTE _273_stmt; DEALLOCATE PREPARE _273_stmt;

-- 2. Widen profile_status ENUM only if employee_details_saved is missing
SET @_273_enum = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate'
    AND COLUMN_NAME = 'profile_status'
    AND COLUMN_TYPE LIKE '%employee_details_saved%');
SET @_273_sql = IF(@_273_enum = 0,
  "ALTER TABLE ats_candidate MODIFY COLUMN profile_status ENUM('registered','selected','onboarding_sent','profile_in_progress','employee_details_saved','profile_submitted','onboarded','closed') NOT NULL DEFAULT 'registered'",
  'SELECT 1 -- profile_status already wide enough');
PREPARE _273_stmt FROM @_273_sql; EXECUTE _273_stmt; DEALLOCATE PREPARE _273_stmt;

-- 3. Backfill candidate_status for existing rows (no-op on empty fresh DB)
UPDATE ats_candidate SET candidate_status = CASE
  WHEN LOWER(COALESCE(final_decision, current_stage, '')) = 'selected' THEN 'selected'
  WHEN LOWER(COALESCE(final_decision, current_stage, '')) IN ('rejected','no show','no_show') THEN 'rejected'
  WHEN LOWER(current_stage) IN ('converted','onboarded','active_employee') THEN 'onboarded'
  ELSE 'registered'
END
WHERE candidate_status IS NULL;

-- 4. Add index if not present
SET @_273_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate'
    AND INDEX_NAME = 'idx_ats_cand_candidate_status');
SET @_273_sql = IF(@_273_idx = 0,
  'CREATE INDEX idx_ats_cand_candidate_status ON ats_candidate (candidate_status)',
  'SELECT 1 -- index already exists');
PREPARE _273_stmt FROM @_273_sql; EXECUTE _273_stmt; DEALLOCATE PREPARE _273_stmt;
