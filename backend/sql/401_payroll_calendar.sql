-- Migration 401: Payroll processing calendar
CREATE TABLE IF NOT EXISTS payroll_calendar (
  calendar_month VARCHAR(7) NOT NULL,
  attendance_cutoff_date DATE NULL,
  incentive_upload_deadline DATE NULL,
  deductions_upload_deadline DATE NULL,
  branch_readiness_deadline DATE NULL,
  payroll_run_date DATE NULL,
  validation_date DATE NULL,
  disbursement_date DATE NULL,
  notes TEXT NULL,
  created_by VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (calendar_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
