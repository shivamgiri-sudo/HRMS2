-- Migration 404: Track when incentives are applied to a payroll run
-- Additive only — safe to run on existing schema.

ALTER TABLE salary_prep_run
  ADD COLUMN incentives_applied_at DATETIME NULL COMMENT 'Timestamp when incentives were applied to this run';

-- Index for efficient queries on whether incentives have been applied
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
-- The COLUMN is checked as well as the index: on a fresh database the two are different
-- questions, and 138 indexed ats_candidate(branch_name) on a table that has no such column.
SET @idx_idx_spr_incentives_applied = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND INDEX_NAME = 'idx_spr_incentives_applied'
);
SET @col_idx_spr_incentives_applied = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME IN ('incentives_applied_at')
);
SET @sql = IF(@idx_idx_spr_incentives_applied = 0 AND @col_idx_spr_incentives_applied = 1,
  'CREATE INDEX idx_spr_incentives_applied ON salary_prep_run (incentives_applied_at)',
  'SELECT ''idx_spr_incentives_applied skipped: already present, or a column it indexes does not exist'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
