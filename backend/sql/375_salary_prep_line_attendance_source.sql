-- Migration 375: Add attendance_data_source column to salary_prep_line
-- Tracks whether payroll used attendance_daily_record (ADR primary engine)
-- or fell back to wfm_attendance_session (legacy session count).
-- Surfaces as a warning badge in the Payroll Validation UI.

ALTER TABLE salary_prep_line
  ADD COLUMN attendance_data_source ENUM('ADR','SESSION_FALLBACK','NO_DATA') NULL
    COMMENT 'ADR = attendance_daily_record used; SESSION_FALLBACK = legacy session fallback; NO_DATA = zeroed defaults';

-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
-- The COLUMN is checked as well as the index: on a fresh database the two are different
-- questions, and 138 indexed ats_candidate(branch_name) on a table that has no such column.
SET @idx_idx_spl_att_source = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND INDEX_NAME = 'idx_spl_att_source'
);
SET @col_idx_spl_att_source = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME IN ('attendance_data_source')
);
SET @sql = IF(@idx_idx_spl_att_source = 0 AND @col_idx_spl_att_source = 1,
  'CREATE INDEX idx_spl_att_source ON salary_prep_line (attendance_data_source)',
  'SELECT ''idx_spl_att_source skipped: already present, or a column it indexes does not exist'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
