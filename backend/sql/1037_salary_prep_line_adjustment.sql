-- Migration 1037: Create salary_prep_line_adjustment table
-- Referenced by payrollCompliance.service.ts but had no CREATE TABLE migration.

CREATE TABLE IF NOT EXISTS salary_prep_line_adjustment (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  run_id            INT NOT NULL,
  line_id           INT NOT NULL,
  employee_id       INT NOT NULL,
  adjustment_type   ENUM('earning','deduction','lwp_override','attendance_override','statutory_override') NOT NULL,
  component_code    VARCHAR(50)  NOT NULL,
  component_name    VARCHAR(100) NOT NULL,
  amount            DECIMAL(12,2) NOT NULL DEFAULT 0,
  reason            VARCHAR(500) NULL,
  created_by        INT NULL,
  approved_by       INT NULL,
  approved_at       DATETIME NULL,
  approval_status   ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_run_employee  (run_id, employee_id),
  INDEX idx_line_id       (line_id),
  INDEX idx_approval      (approval_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
