-- Migration 1002: Fix salary_register_audit_log schema conflict
-- Problem: Migration 306 defined different columns than what JCR service writes
-- Solution: Add missing columns expected by joining-control-room.service.ts lockSalaryRegister()

ALTER TABLE salary_register_audit_log
  ADD COLUMN candidate_id   INT          NULL AFTER salary_register_id,
  ADD COLUMN actor_id       INT          NULL AFTER candidate_id,
  ADD COLUMN action         VARCHAR(100) NULL AFTER actor_id,
  ADD COLUMN payload_json   LONGTEXT     NULL AFTER action;

-- Add index for candidate lookups
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
-- The COLUMN is checked as well as the index: on a fresh database the two are different
-- questions, and 138 indexed ats_candidate(branch_name) on a table that has no such column.
SET @idx_idx_sral_candidate = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_register_audit_log' AND INDEX_NAME = 'idx_sral_candidate'
);
SET @col_idx_sral_candidate = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_register_audit_log' AND COLUMN_NAME IN ('candidate_id')
);
SET @sql = IF(@idx_idx_sral_candidate = 0 AND @col_idx_sral_candidate = 1,
  'CREATE INDEX idx_sral_candidate ON salary_register_audit_log (candidate_id)',
  'SELECT ''idx_sral_candidate skipped: already present, or a column it indexes does not exist'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
