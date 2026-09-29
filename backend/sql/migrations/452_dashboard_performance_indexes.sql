-- Migration 452: Add indexes for dashboard performance
--
-- /api/management/workforce-dashboard and /api/dashboards/*/summary run several
-- aggregation queries on `employees` filtered by active_status, branch_id, process_id
-- and date_of_joining. Without covering indexes each query scans the full table.
--
-- /api/management/system-dashboard and /api/dashboards/*/summary also touch
-- attendance_daily_record and wfm_shift_assignment filtered by date ranges.
--
-- These are all additive — no existing rows or constraints are changed.
-- Applied directly to production; this file records what was run.

-- employees: the hot filter combination used by every workforce dashboard aggregation
ALTER TABLE employees
  ADD INDEX idx_emp_active_branch_joining  (active_status, branch_id, date_of_joining),
  ADD INDEX idx_emp_active_process_joining (active_status, process_id, date_of_joining);

-- employees: attrition / exit queries filter on date_of_leaving + resignation_date + date_of_exit
ALTER TABLE employees
  ADD INDEX idx_emp_leaving_dates (date_of_leaving, resignation_date, date_of_exit);

-- employees: manager-completeness check (missing_manager tile on workforce dashboard)
ALTER TABLE employees
  ADD INDEX idx_emp_reporting_manager (active_status, reporting_manager_id);

-- attendance_daily_record: system dashboard and attendance summary filter on date + employee
ALTER TABLE attendance_daily_record
  ADD INDEX idx_adr_date_emp (attendance_date, employee_id);

-- ats_candidate: ATS stats and pipeline queries filter on current_stage and source
ALTER TABLE ats_candidate
  ADD INDEX idx_cand_stage_source (current_stage, source);
