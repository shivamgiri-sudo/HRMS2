-- Migration 375: Add attendance_data_source column to salary_prep_line
-- Tracks whether payroll used attendance_daily_record (ADR primary engine)
-- or fell back to wfm_attendance_session (legacy session count).
-- Surfaces as a warning badge in the Payroll Validation UI.
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` are MariaDB
-- syntax, rejected by this production MySQL 8.0.42 build with ER_PARSE_ERROR. Both the column
-- and the index already exist on production (confirmed via information_schema before this
-- fix), so this is a no-op guard rewrite.
SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'attendance_data_source');
SET @sql = IF(@c1 = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN attendance_data_source ENUM(''ADR'',''SESSION_FALLBACK'',''NO_DATA'') NULL COMMENT ''ADR = attendance_daily_record used; SESSION_FALLBACK = legacy session fallback; NO_DATA = zeroed defaults''',
  'SELECT "attendance_data_source already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @i1 = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND INDEX_NAME = 'idx_spl_att_source');
SET @sql = IF(@i1 = 0,
  'ALTER TABLE salary_prep_line ADD INDEX idx_spl_att_source (attendance_data_source)',
  'SELECT "idx_spl_att_source already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
