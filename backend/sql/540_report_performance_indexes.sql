-- Migration 540: Report query performance indexes
-- Additive only — all guarded by IF NOT EXISTS / schema checks.
-- Required for attendance reports to complete within acceptable time on large datasets.

-- attendance_daily_record: composite indexes for date-range + scope filters used by all attendance reports
ALTER TABLE attendance_daily_record
  ADD INDEX IF NOT EXISTS idx_adr_date_branch  (record_date, branch_id),
  ADD INDEX IF NOT EXISTS idx_adr_date_process (record_date, process_id),
  ADD INDEX IF NOT EXISTS idx_adr_late_mark    (late_mark, record_date);

-- wfm_attendance_session: composite index for the pre-aggregation subquery (shift-adherence, attendance-daily)
ALTER TABLE wfm_attendance_session
  ADD INDEX IF NOT EXISTS idx_was_date_emp (session_date, employee_id);

-- integration_biometric_daily: date index for punch-raw-export and biometric-reconciliation
ALTER TABLE integration_biometric_daily
  ADD INDEX IF NOT EXISTS idx_ibd_activity_date (activity_date);
