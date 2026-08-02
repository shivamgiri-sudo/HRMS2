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
SET @idx_idx_sral_candidate = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_register_audit_log' AND INDEX_NAME = 'idx_sral_candidate'
);
SET @sql = IF(@idx_idx_sral_candidate = 0,
  'CREATE INDEX idx_sral_candidate ON salary_register_audit_log (candidate_id)',
  'SELECT ''idx_sral_candidate already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
