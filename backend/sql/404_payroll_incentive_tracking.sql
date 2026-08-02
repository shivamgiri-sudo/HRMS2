-- Migration 404: Track when incentives are applied to a payroll run
-- Additive only — safe to run on existing schema.

ALTER TABLE salary_prep_run
  ADD COLUMN IF NOT EXISTS incentives_applied_at DATETIME NULL COMMENT 'Timestamp when incentives were applied to this run';

-- Index for efficient queries on whether incentives have been applied
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_spr_incentives_applied = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND INDEX_NAME = 'idx_spr_incentives_applied'
);
SET @sql = IF(@idx_idx_spr_incentives_applied = 0,
  'CREATE INDEX idx_spr_incentives_applied ON salary_prep_run (incentives_applied_at)',
  'SELECT ''idx_spr_incentives_applied already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
