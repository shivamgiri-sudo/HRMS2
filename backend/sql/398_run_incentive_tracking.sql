-- Migration 398: Track when incentives were applied to a payroll run
-- Used to protect against silent incentive wipe on recalculate
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` is MariaDB syntax, rejected by this production
-- MySQL 8.0.42 build with ER_PARSE_ERROR. Recorded as `success=1` in schema_migrations since
-- 2026-07-20 (the parse error was classified at file level at the time, not per-statement —
-- see runPendingMigrations.ts Gate 3), but information_schema confirms the column was never
-- actually added — the incentive-wipe-on-recalculate guard this column exists for has been
-- silently inactive since 2026-07-20. This rewrite both fixes the syntax and, once run, adds
-- the column for real. See also 404_payroll_incentive_tracking.sql, which targets the exact
-- same column under a different migration number — both are guarded, so whichever runs first
-- adds it and the other becomes a no-op.
SET @c_incentives_applied_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'incentives_applied_at'
);
SET @sql = IF(@c_incentives_applied_at = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN incentives_applied_at DATETIME NULL AFTER status',
  'SELECT "incentives_applied_at already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
