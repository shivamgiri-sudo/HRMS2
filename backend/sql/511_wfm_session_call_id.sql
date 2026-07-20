-- Add call_id column to wfm_attendance_session for operations live status
ALTER TABLE wfm_attendance_session
  ADD COLUMN IF NOT EXISTS call_id VARCHAR(100) NULL AFTER current_status;
