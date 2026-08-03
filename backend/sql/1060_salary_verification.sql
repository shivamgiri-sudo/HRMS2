-- 1060: Salary verification tables for WFM pre-sign-off review
-- salary_verification_flag: discrepancies raised by WFM to Payroll Head
-- salary_employee_verification: per-employee verified status per run
-- payroll_branch_readiness columns: track overall salary verification completion

USE mas_hrms;

CREATE TABLE IF NOT EXISTS salary_verification_flag (
  id              VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  run_id          VARCHAR(36),                             -- salary_prep_run.id; NULL = pre-run estimate
  run_month       VARCHAR(7)   NOT NULL,                   -- YYYY-MM
  employee_id     VARCHAR(36)  NOT NULL,
  employee_code   VARCHAR(50),
  process_id      VARCHAR(36),
  branch_id       VARCHAR(36),
  category        ENUM('attendance','incentive','deduction','net_pay','other') NOT NULL,
  description     TEXT         NOT NULL,
  expected_value  DECIMAL(12,2),
  raised_by       VARCHAR(36)  NOT NULL,
  raised_at       DATETIME     NOT NULL DEFAULT NOW(),
  status          ENUM('open','resolved','rejected','acknowledged') NOT NULL DEFAULT 'open',
  resolved_by     VARCHAR(36),
  resolved_at     DATETIME,
  resolution_note TEXT,
  PRIMARY KEY (id),
  INDEX idx_svf_run_process (run_month, process_id, status),
  INDEX idx_svf_employee (employee_id, run_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salary_employee_verification (
  id           VARCHAR(36) NOT NULL DEFAULT (UUID()),
  run_month    VARCHAR(7)  NOT NULL,
  run_id       VARCHAR(36),
  employee_id  VARCHAR(36) NOT NULL,
  process_id   VARCHAR(36),
  verified_by  VARCHAR(36) NOT NULL,
  verified_at  DATETIME    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sev_emp_month_process (employee_id, run_month, process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add salary verification completion tracking to the readiness table
-- MySQL 8.0 does not support ADD COLUMN IF NOT EXISTS; use conditional procedure
DROP PROCEDURE IF EXISTS _add_salary_verify_cols;
DELIMITER $$
CREATE PROCEDURE _add_salary_verify_cols()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'payroll_branch_readiness'
       AND COLUMN_NAME = 'salary_verification_done'
  ) THEN
    ALTER TABLE payroll_branch_readiness
      ADD COLUMN salary_verification_done TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN salary_verification_at   DATETIME,
      ADD COLUMN salary_verification_by   VARCHAR(36);
  END IF;
END$$
DELIMITER ;
CALL _add_salary_verify_cols();
DROP PROCEDURE IF EXISTS _add_salary_verify_cols;
