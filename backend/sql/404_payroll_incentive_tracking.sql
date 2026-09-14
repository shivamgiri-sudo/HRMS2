-- Migration 404: Track when incentives are applied to a payroll run
-- Additive only — safe to run on existing schema.
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` are MariaDB
-- syntax, rejected by this production MySQL 8.0.42 build with ER_PARSE_ERROR. Recorded as
-- `success=1` since 2026-07-20 despite never actually running — see 398_run_incentive_tracking.sql,
-- which targets the identical column (salary_prep_run.incentives_applied_at) and carries the
-- fuller explanation. Both are guarded here; whichever runs first adds the column, the other
-- is then a no-op.
SET @c_incentives_applied_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'incentives_applied_at'
);
SET @sql = IF(@c_incentives_applied_at = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN incentives_applied_at DATETIME NULL COMMENT ''Timestamp when incentives were applied to this run''',
  'SELECT "incentives_applied_at already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index for efficient queries on whether incentives have been applied
SET @i_incentives_applied = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND INDEX_NAME = 'idx_spr_incentives_applied'
);
SET @sql = IF(@i_incentives_applied = 0,
  'ALTER TABLE salary_prep_run ADD INDEX idx_spr_incentives_applied (incentives_applied_at)',
  'SELECT "idx_spr_incentives_applied already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
