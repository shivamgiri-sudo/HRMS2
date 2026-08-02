-- Migration 375: Add attendance_data_source column to salary_prep_line
-- Tracks whether payroll used attendance_daily_record (ADR primary engine)
-- or fell back to wfm_attendance_session (legacy session count).
-- Surfaces as a warning badge in the Payroll Validation UI.

ALTER TABLE salary_prep_line
  ADD COLUMN IF NOT EXISTS attendance_data_source ENUM('ADR','SESSION_FALLBACK','NO_DATA') NULL
    COMMENT 'ADR = attendance_daily_record used; SESSION_FALLBACK = legacy session fallback; NO_DATA = zeroed defaults';

-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_spl_att_source = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND INDEX_NAME = 'idx_spl_att_source'
);
SET @sql = IF(@idx_idx_spl_att_source = 0,
  'CREATE INDEX idx_spl_att_source ON salary_prep_line (attendance_data_source)',
  'SELECT ''idx_spl_att_source already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
