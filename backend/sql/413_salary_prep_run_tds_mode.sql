-- Migration 413: Add tds_mode column to salary_prep_run
-- Enables per-run selection of auto (DB-driven tax engine) vs manual TDS entry.
-- Default 'manual' preserves all existing run behaviour — no data change.
-- DO NOT execute against production without explicit approval.
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` is MariaDB syntax, rejected by this production
-- MySQL 8.0.42 build with ER_PARSE_ERROR — same class as the 1006 outage. The column already
-- exists on production (confirmed via information_schema before this fix, added independently
-- of this gated file), so this is a no-op guard rewrite. The "DO NOT execute without approval"
-- note above is preserved as-is — this fix does not change that gate, only the syntax.

USE mas_hrms;

SET @c_tds_mode = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run' AND COLUMN_NAME = 'tds_mode'
);
SET @sql = IF(@c_tds_mode = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN tds_mode ENUM(''auto'',''manual'') NOT NULL DEFAULT ''manual'' COMMENT ''auto = taxEngineService calculates TDS; manual = salary_run_manual_tds overrides''',
  'SELECT "tds_mode already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
