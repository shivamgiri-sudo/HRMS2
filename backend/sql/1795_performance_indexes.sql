-- Performance indexes: composite indexes for the most common query patterns
-- identified in the 2026-09-17 perf audit. All created with IF NOT EXISTS guards
-- so re-running is safe.

-- attendance_daily_record: queries filter by employee_id + record_date together constantly
-- (payroll working-days calc, attendance engine batch, reporting)
ALTER TABLE attendance_daily_record
  ADD INDEX IF NOT EXISTS idx_adr_emp_date (employee_id, record_date);

-- wfm_roster_assignment: live tracker and roster queries filter employee_id + roster_date
ALTER TABLE wfm_roster_assignment
  ADD INDEX IF NOT EXISTS idx_wra_emp_date (employee_id, roster_date);

-- salary_prep_line_component: payroll run queries filter run_id + employee_id together
ALTER TABLE salary_prep_line_component
  ADD INDEX IF NOT EXISTS idx_splc_run_emp (run_id, employee_id);

-- payroll_employee_component_snapshot: getComponentBreakup filters employee_id + effective_from
ALTER TABLE payroll_employee_component_snapshot
  ADD INDEX IF NOT EXISTS idx_pecs_emp_eff (employee_id, effective_from);

-- payroll_compliance_issue: validateRun reads issues by run_id
ALTER TABLE payroll_compliance_issue
  ADD INDEX IF NOT EXISTS idx_pci_run (run_id);

-- ats_bgv_verification: listOnboardingBridges LEFT JOIN on candidate_id + MAX(created_at)
ALTER TABLE ats_bgv_verification
  ADD INDEX IF NOT EXISTS idx_bgv_cand_date (candidate_id, created_at);

-- ats_payroll_hr_validation: listOnboardingBridges LEFT JOIN on candidate_id
ALTER TABLE ats_payroll_hr_validation
  ADD INDEX IF NOT EXISTS idx_phrv_cand (candidate_id);

-- candidate_name_match_summary: listOnboardingBridges LEFT JOIN on candidate_id
ALTER TABLE candidate_name_match_summary
  ADD INDEX IF NOT EXISTS idx_cnms_cand (candidate_id);

-- bank_statement_line: reconciliation queries filter by import_id
ALTER TABLE bank_statement_line
  ADD INDEX IF NOT EXISTS idx_bsl_import (import_id);

-- attendance_regularization: engine queries by employee + date
ALTER TABLE attendance_regularization
  ADD INDEX IF NOT EXISTS idx_ar_emp_date (employee_id, regularization_date);
