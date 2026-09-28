-- Performance indexes: composite indexes for the most common query patterns
-- identified in the 2026-09-17 perf audit. All guarded with CREATE INDEX IF NOT EXISTS
-- (MySQL 8.0.29+ syntax) so re-running is safe.

-- attendance_daily_record: queries filter by employee_id + record_date together constantly
CREATE INDEX IF NOT EXISTS idx_adr_emp_date ON attendance_daily_record (employee_id, record_date);

-- wfm_roster_assignment: live tracker and roster queries filter employee_id + roster_date
CREATE INDEX IF NOT EXISTS idx_wra_emp_date ON wfm_roster_assignment (employee_id, roster_date);

-- salary_prep_line_component: payroll run queries filter run_id + employee_id together
CREATE INDEX IF NOT EXISTS idx_splc_run_emp ON salary_prep_line_component (run_id, employee_id);

-- payroll_employee_component_snapshot: getComponentBreakup filters employee_id + effective_from
CREATE INDEX IF NOT EXISTS idx_pecs_emp_eff ON payroll_employee_component_snapshot (employee_id, effective_from);

-- payroll_compliance_issue: validateRun reads issues by run_id
CREATE INDEX IF NOT EXISTS idx_pci_run ON payroll_compliance_issue (run_id);

-- ats_bgv_verification: listOnboardingBridges LEFT JOIN on candidate_id + MAX(created_at)
CREATE INDEX IF NOT EXISTS idx_bgv_cand_date ON ats_bgv_verification (candidate_id, created_at);

-- ats_payroll_hr_validation: listOnboardingBridges LEFT JOIN on candidate_id
CREATE INDEX IF NOT EXISTS idx_phrv_cand ON ats_payroll_hr_validation (candidate_id);

-- candidate_name_match_summary: listOnboardingBridges LEFT JOIN on candidate_id
CREATE INDEX IF NOT EXISTS idx_cnms_cand ON candidate_name_match_summary (candidate_id);

-- bank_statement_line: reconciliation queries filter by import_id
CREATE INDEX IF NOT EXISTS idx_bsl_import ON bank_statement_line (import_id);

-- attendance_regularization: engine queries by employee + date
CREATE INDEX IF NOT EXISTS idx_ar_emp_date ON attendance_regularization (employee_id, regularization_date);
