-- Migration 400: Branch Payroll Readiness tracking table
CREATE TABLE IF NOT EXISTS payroll_branch_readiness (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  process_month VARCHAR(7) NOT NULL,
  branch_id VARCHAR(36) NOT NULL,
  -- manual checklist items
  attendance_frozen TINYINT(1) NOT NULL DEFAULT 0,
  attendance_frozen_at DATETIME NULL,
  attendance_frozen_by VARCHAR(36) NULL,
  incentives_status ENUM('not_uploaded','uploaded','approved') NOT NULL DEFAULT 'not_uploaded',
  incentives_confirmed_at DATETIME NULL,
  incentives_confirmed_by VARCHAR(36) NULL,
  custom_deductions_uploaded TINYINT(1) NOT NULL DEFAULT 0,
  custom_deductions_confirmed_at DATETIME NULL,
  custom_deductions_confirmed_by VARCHAR(36) NULL,
  overtime_entered TINYINT(1) NOT NULL DEFAULT 0,
  overtime_confirmed_at DATETIME NULL,
  overtime_confirmed_by VARCHAR(36) NULL,
  -- computed metrics
  bank_details_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  uan_complete_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  noc_resolved TINYINT(1) NOT NULL DEFAULT 1,
  holiday_work_approved TINYINT(1) NOT NULL DEFAULT 1,
  -- score and status
  readiness_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  readiness_status ENUM('not_started','in_progress','ready','blocked') NOT NULL DEFAULT 'not_started',
  -- salary projection
  employee_count INT NOT NULL DEFAULT 0,
  projected_gross DECIMAL(14,2) NULL,
  projected_net DECIMAL(14,2) NULL,
  projection_computed_at DATETIME NULL,
  -- branch head sign-off
  branch_head_signoff TINYINT(1) NOT NULL DEFAULT 0,
  branch_head_signoff_at DATETIME NULL,
  branch_head_signoff_by VARCHAR(36) NULL,
  branch_head_remarks TEXT NULL,
  -- HO override
  ho_override_ready TINYINT(1) NOT NULL DEFAULT 0,
  ho_override_by VARCHAR(36) NULL,
  ho_override_at DATETIME NULL,
  ho_override_reason TEXT NULL,
  -- timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_readiness_month_branch (process_month, branch_id),
  KEY idx_readiness_month (process_month),
  KEY idx_readiness_branch (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
