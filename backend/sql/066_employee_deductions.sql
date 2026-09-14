-- Migration: Create employee_deductions_log for legacy deduction tracking
-- Purpose: Track one-time/ad-hoc deductions from legacy system

CREATE TABLE IF NOT EXISTS employee_deductions_log (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  employee_id CHAR(36) NOT NULL,
  employee_code VARCHAR(50) NOT NULL,

  -- Salary month/period
  salary_month VARCHAR(10) NOT NULL COMMENT 'Format: YYYY-MM',
  salary_year INT GENERATED ALWAYS AS (CAST(SUBSTRING(salary_month, 1, 4) AS UNSIGNED)) STORED,
  salary_month_num INT GENERATED ALWAYS AS (CAST(SUBSTRING(salary_month, 6, 2) AS UNSIGNED)) STORED,

  -- Deduction breakdown
  mobile_deduction DECIMAL(10,2) DEFAULT 0.00,
  short_collection DECIMAL(10,2) DEFAULT 0.00,
  asset_recovery DECIMAL(10,2) DEFAULT 0.00,
  insurance DECIMAL(10,2) DEFAULT 0.00,
  professional_tax DECIMAL(10,2) DEFAULT 0.00,
  leave_deduction DECIMAL(10,2) DEFAULT 0.00,
  others_deduction DECIMAL(10,2) DEFAULT 0.00,
  total_deduction DECIMAL(10,2) GENERATED ALWAYS AS (
    COALESCE(mobile_deduction, 0) +
    COALESCE(short_collection, 0) +
    COALESCE(asset_recovery, 0) +
    COALESCE(insurance, 0) +
    COALESCE(professional_tax, 0) +
    COALESCE(leave_deduction, 0) +
    COALESCE(others_deduction, 0)
  ) STORED,

  -- Additional info
  remarks VARCHAR(500) NULL,
  deduction_remarks VARCHAR(500) NULL,
  process_status VARCHAR(50) NULL COMMENT 'Processed, Pending, etc',

  -- Organization details
  branch_name VARCHAR(255) NULL,
  cost_center VARCHAR(255) NULL,

  -- Legacy tracking
  legacy_deduction_id INT NULL UNIQUE,
  legacy_import_date DATETIME NULL,
  legacy_update_date DATETIME NULL,

  -- Timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_employee (employee_id),
  INDEX idx_employee_code (employee_code),
  INDEX idx_salary_month (salary_month),
  INDEX idx_salary_year_month (salary_year, salary_month_num),
  INDEX idx_legacy_deduction (legacy_deduction_id),
  INDEX idx_process_status (process_status),
  UNIQUE KEY uq_emp_month (employee_id, salary_month),

  -- Foreign key
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create summary view
CREATE OR REPLACE VIEW v_employee_deductions_summary AS
SELECT
  ed.id,
  ed.employee_code,
  e.first_name,
  e.last_name,
  CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
  ed.salary_month,
  ed.salary_year,
  ed.salary_month_num,
  ed.mobile_deduction,
  ed.short_collection,
  ed.asset_recovery,
  ed.insurance,
  ed.professional_tax,
  ed.leave_deduction,
  ed.others_deduction,
  ed.total_deduction,
  ed.remarks,
  ed.deduction_remarks,
  ed.process_status,
  ed.branch_name,
  ed.cost_center,
  ed.legacy_deduction_id,
  ed.created_at
FROM employee_deductions_log ed
JOIN employees e ON e.id = ed.employee_id
ORDER BY ed.salary_year DESC, ed.salary_month_num DESC, ed.employee_code;

-- Create monthly summary view
CREATE OR REPLACE VIEW v_monthly_deductions_summary AS
SELECT
  salary_year,
  salary_month_num,
  salary_month,
  COUNT(DISTINCT employee_id) as employee_count,
  SUM(mobile_deduction) as total_mobile,
  SUM(short_collection) as total_short_collection,
  SUM(asset_recovery) as total_asset_recovery,
  SUM(insurance) as total_insurance,
  SUM(professional_tax) as total_professional_tax,
  SUM(leave_deduction) as total_leave_deduction,
  SUM(others_deduction) as total_others,
  SUM(total_deduction) as grand_total
FROM employee_deductions_log
GROUP BY salary_year, salary_month_num, salary_month
ORDER BY salary_year DESC, salary_month_num DESC;

-- Migration complete
