-- Migration: Create employee_loans table for legacy loan sync
-- Purpose: Track employee loans and advances from legacy system

CREATE TABLE IF NOT EXISTS employee_loans (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  employee_id CHAR(36) NOT NULL,
  employee_code VARCHAR(50) NOT NULL COMMENT 'For validation and reporting',

  -- Loan details
  loan_type VARCHAR(50) NOT NULL COMMENT 'Loan, Advance, etc',
  amount DECIMAL(12,2) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  installments INT NOT NULL DEFAULT 1,
  deduction_per_month DECIMAL(12,2) NOT NULL,

  -- Repayment tracking
  deducted_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  pending_amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active, completed, cancelled',

  -- Guarantor information
  guarantor_name VARCHAR(255) NULL,
  guarantor_emp_code VARCHAR(50) NULL,
  guarantor_emp_id CHAR(36) NULL,

  -- Approval tracking
  reason TEXT NULL,
  approved_by VARCHAR(100) NULL,
  approved_at DATETIME NULL,

  -- Payment details
  cheque_number VARCHAR(50) NULL,
  cheque_bank VARCHAR(100) NULL,
  cheque_date DATE NULL,
  rtgs_number VARCHAR(50) NULL,
  rtgs_date DATE NULL,

  -- Organization details
  branch_name VARCHAR(100) NULL,
  cost_center VARCHAR(100) NULL,

  -- Legacy tracking
  legacy_loan_id INT NULL UNIQUE COMMENT 'ID from LoanMaster table',
  legacy_created_at DATETIME NULL,
  legacy_updated_at DATETIME NULL,

  -- Timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_employee (employee_id),
  INDEX idx_employee_code (employee_code),
  INDEX idx_status (status),
  INDEX idx_legacy_loan (legacy_loan_id),
  INDEX idx_guarantor (guarantor_emp_id),

  -- Foreign keys
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (guarantor_emp_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add columns to salary_advance_log for legacy tracking (ignore errors if already exists)
ALTER TABLE salary_advance_log ADD COLUMN legacy_loan_id INT NULL COMMENT 'Link to legacy LoanMaster';
ALTER TABLE salary_advance_log ADD COLUMN loan_type VARCHAR(50) NULL COMMENT 'Loan or Advance';
ALTER TABLE salary_advance_log ADD INDEX idx_legacy_loan_adv (legacy_loan_id);

-- Create view for loan reporting
CREATE OR REPLACE VIEW v_employee_loans_summary AS
SELECT
  el.id,
  el.employee_code,
  e.first_name,
  e.last_name,
  CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
  el.loan_type,
  el.amount,
  el.start_date,
  el.end_date,
  el.installments,
  el.deduction_per_month,
  el.deducted_amount,
  el.pending_amount,
  ROUND((el.deducted_amount / el.amount) * 100, 2) AS repayment_percentage,
  el.status,
  el.guarantor_name,
  el.guarantor_emp_code,
  el.reason,
  el.branch_name,
  el.cost_center,
  el.legacy_loan_id,
  el.created_at
FROM employee_loans el
JOIN employees e ON e.id = el.employee_id
ORDER BY el.created_at DESC;

-- Migration complete
