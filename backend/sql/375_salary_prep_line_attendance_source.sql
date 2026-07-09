-- Migration 375: Add attendance_data_source column to salary_prep_line
-- Tracks whether payroll used attendance_daily_record (ADR primary engine)
-- or fell back to wfm_attendance_session (legacy session count).
-- Surfaces as a warning badge in the Payroll Validation UI.

ALTER TABLE salary_prep_line
  ADD COLUMN IF NOT EXISTS attendance_data_source ENUM('ADR','SESSION_FALLBACK','NO_DATA') NULL
    COMMENT 'ADR = attendance_daily_record used; SESSION_FALLBACK = legacy session fallback; NO_DATA = zeroed defaults';

CREATE INDEX IF NOT EXISTS idx_spl_att_source ON salary_prep_line(attendance_data_source);
