-- Performance indexes for slow tables identified 2026-10-15.
-- All are additive (CREATE INDEX IF NOT EXISTS). Safe to re-run.

-- salary_prep_line_component: 892K rows, no index on employee_id filter
CREATE INDEX IF NOT EXISTS idx_spl_component_employee_id ON salary_prep_line_component(employee_id);

-- wfm_roster_assignment: 451K rows, range scans on created_at
CREATE INDEX IF NOT EXISTS idx_wfm_roster_assignment_created_at ON wfm_roster_assignment(created_at);

-- attendance_regularization: 130K rows, branch-scope queries slow
CREATE INDEX IF NOT EXISTS idx_att_reg_branch_id ON attendance_regularization(branch_id);

-- employee_salary_history: 453K rows, date-range list queries
CREATE INDEX IF NOT EXISTS idx_emp_salary_history_created_at ON employee_salary_history(created_at);

-- ats_recruiter_hiring_activity: 55K rows, per-employee lookups
CREATE INDEX IF NOT EXISTS idx_ats_hiring_activity_employee_id ON ats_recruiter_hiring_activity(employee_id);

-- he_ex_employee: 41K rows, per-employee lookups from exit module
CREATE INDEX IF NOT EXISTS idx_he_ex_employee_employee_id ON he_ex_employee(employee_id);

-- wfm_roster_import_row: 200K rows, date-range queries
CREATE INDEX IF NOT EXISTS idx_wfm_roster_import_row_created_at ON wfm_roster_import_row(created_at);
