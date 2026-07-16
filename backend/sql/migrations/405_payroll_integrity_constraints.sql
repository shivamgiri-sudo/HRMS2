-- Migration: Add integrity constraints for payroll tables
-- Ensures referential consistency and prevents orphan records

-- Ensure salary_prep_line references valid runs
ALTER TABLE salary_prep_line
  ADD CONSTRAINT fk_spl_run_id
  FOREIGN KEY (run_id) REFERENCES salary_prep_run(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ensure salary_prep_line_component references valid lines
ALTER TABLE salary_prep_line_component
  ADD CONSTRAINT fk_splc_line_id
  FOREIGN KEY (line_id) REFERENCES salary_prep_line(id)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Ensure salary_prep_line references valid employees
ALTER TABLE salary_prep_line
  ADD CONSTRAINT fk_spl_employee_id
  FOREIGN KEY (employee_id) REFERENCES employees(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prevent negative net salary
ALTER TABLE salary_prep_line
  ADD CONSTRAINT chk_net_salary_non_negative
  CHECK (net_salary >= 0);

-- Ensure run status is one of the allowed values
ALTER TABLE salary_prep_run
  ADD CONSTRAINT chk_run_status
  CHECK (status IN ('draft', 'calculating', 'calculated', 'under_review', 'approved', 'locked', 'disbursed', 'cancelled'));

-- Index for common filter: employee + run (fast per-employee history)
CREATE INDEX IF NOT EXISTS idx_spl_employee_run
  ON salary_prep_line (employee_id, run_id);

-- Index for run_month lookups
CREATE INDEX IF NOT EXISTS idx_spr_run_month
  ON salary_prep_run (run_month);
