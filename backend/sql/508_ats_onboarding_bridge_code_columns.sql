-- 508_ats_onboarding_bridge_code_columns.sql
-- Adds employee_code and bridge_status columns to ats_onboarding_bridge.
-- These columns are written by employee-code-gate.routes.ts at code-generation time
-- but were never defined in any migration file, causing silent UPDATE failures on
-- fresh schema installs. This migration makes the schema match the runtime code.
-- Additive only — no existing columns altered, no data deleted.

ALTER TABLE ats_onboarding_bridge
  ADD COLUMN IF NOT EXISTS employee_code  VARCHAR(30)  NULL          COMMENT 'Denormalized copy of generated employee code for quick gate queries',
  ADD COLUMN IF NOT EXISTS bridge_status  VARCHAR(50)  NOT NULL DEFAULT 'pending' COMMENT 'Lifecycle: pending | code_generated | employee_created | activated',
  ADD COLUMN IF NOT EXISTS updated_at     DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last updated timestamp';

-- Index for gate-check queries that filter by bridge_status
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_aob_bridge_status = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_onboarding_bridge' AND INDEX_NAME = 'idx_aob_bridge_status'
);
SET @sql = IF(@idx_idx_aob_bridge_status = 0,
  'CREATE INDEX idx_aob_bridge_status ON ats_onboarding_bridge (bridge_status)',
  'SELECT ''idx_aob_bridge_status already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- Index for reverse-lookup by employee_code
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_aob_employee_code = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_onboarding_bridge' AND INDEX_NAME = 'idx_aob_employee_code'
);
SET @sql = IF(@idx_idx_aob_employee_code = 0,
  'CREATE INDEX idx_aob_employee_code ON ats_onboarding_bridge (employee_code)',
  'SELECT ''idx_aob_employee_code already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
