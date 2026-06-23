-- Performance indexes for high-query tables
-- Safe to apply multiple times (IF NOT EXISTS)

-- Composite covering index for attendance status + date range queries
-- (record_date, attendance_status) enables the revenue-risk batch attendance queries
ALTER TABLE attendance_daily_record
  ADD INDEX IF NOT EXISTS idx_adr_record_date_status (record_date, attendance_status);

-- cosec_punch_sync: (user_id, punch_time) already present as idx_user_date — skip duplicate

-- ats_candidate: composite for list queries filtered by date + status
ALTER TABLE ats_candidate
  ADD INDEX IF NOT EXISTS idx_ats_candidate_created_status (created_at, status);

-- leave_request: composite for employee-scoped leave queries (status + from_date)
-- (employee_id, status) exists as idx_lr_emp_status but without from_date
ALTER TABLE leave_request
  ADD INDEX IF NOT EXISTS idx_lr_employee_status_from (employee_id, status, from_date);

-- workforce_mandate: composite for revenue-risk batch query filtering
ALTER TABLE workforce_mandate
  ADD INDEX IF NOT EXISTS idx_wm_process_active (process_id, active_status, effective_from, effective_to);

-- roster_assignment: process_id is missing from existing indexes — needed for revenue-risk batch query
ALTER TABLE roster_assignment
  ADD INDEX IF NOT EXISTS idx_ra_process_date (process_id, roster_date);
