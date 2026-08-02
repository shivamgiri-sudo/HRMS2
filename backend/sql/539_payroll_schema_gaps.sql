-- 539_payroll_schema_gaps.sql
-- Fixes confirmed schema gaps found by forensic audit of payroll module.
-- All changes are additive (IF NOT EXISTS / IF NOT EXISTS guard).

USE mas_hrms;

-- Fix 1: statutory_config missing is_active column
-- payrollCalculate.service.ts line 46 queries WHERE is_active = 1
ALTER TABLE statutory_config
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER config_value;
UPDATE statutory_config SET is_active = 1 WHERE is_active IS NULL OR is_active = 0;

-- Fix 2: salary_prep_run missing financial_year and payroll_model_version
-- payroll-compliance/payrollCalculate.service.ts line 352 writes these columns
ALTER TABLE salary_prep_run
  ADD COLUMN financial_year VARCHAR(9) NULL AFTER updated_at,
  ADD COLUMN payroll_model_version VARCHAR(50) NULL AFTER financial_year;

-- Fix 3: salary_prep_line missing 6 columns used by compliance engine
-- payroll-compliance/payrollCalculate.service.ts lines 291-328 writes these
ALTER TABLE salary_prep_line
  ADD COLUMN gross_before_lwp DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER gross_salary,
  ADD COLUMN employer_statutory_cost DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER pf_employer,
  ADD COLUMN manual_adjustment_total DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER other_deductions,
  ADD COLUMN calculation_status VARCHAR(30) NOT NULL DEFAULT 'pending' AFTER status,
  ADD COLUMN calculation_version VARCHAR(50) NULL AFTER calculation_status,
  ADD COLUMN calculation_notes TEXT NULL AFTER calculation_version;

-- Fix 4: Two tables referenced by compliance module but never created
CREATE TABLE IF NOT EXISTS payroll_compliance_issue (
  id           CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_id       CHAR(36) NOT NULL,
  employee_id  CHAR(36) NULL,
  issue_type   VARCHAR(100) NOT NULL,
  severity     ENUM('info','warning','error') NOT NULL DEFAULT 'warning',
  message      TEXT NOT NULL,
  resolved     TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pci_run (run_id),
  INDEX idx_pci_emp (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_employee_component_snapshot (
  id             CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_id         CHAR(36) NOT NULL,
  employee_id    CHAR(36) NOT NULL,
  component_code VARCHAR(50) NOT NULL,
  component_name VARCHAR(255) NOT NULL,
  component_type ENUM('earning','deduction','employer_cost') NOT NULL DEFAULT 'earning',
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  taxable        TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pecs (run_id, employee_id, component_code),
  INDEX idx_pecs_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fix 5: salary_structure_master missing updated_at
-- payroll.service.ts line 64 does SET updated_at = NOW()
ALTER TABLE salary_structure_master
  ADD COLUMN updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

SELECT 'Migration 539 applied: payroll schema gaps resolved' AS status;
