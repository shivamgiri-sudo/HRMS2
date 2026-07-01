-- Migration 337: Employee deduction entries for per-employee fixed/pro-rated deductions
-- Covers: loan EMIs, court attachments, canteen recoveries, uniform charges, etc.
-- is_prorated=1 → amount is scaled by (finalPayableDays / activeCalDays) during payroll run
-- is_prorated=0 → full fixed amount deducted regardless of attendance
-- run_month NULL → applies every month until status set to 'inactive'

CREATE TABLE IF NOT EXISTS employee_deduction_entries (
  id               VARCHAR(36)      NOT NULL DEFAULT (UUID()),
  employee_id      VARCHAR(36)      NOT NULL,
  description      VARCHAR(200)     NOT NULL,
  amount           DECIMAL(10,2)    NOT NULL,
  is_prorated      TINYINT(1)       NOT NULL DEFAULT 0,
  run_month        VARCHAR(7)       NULL     COMMENT 'YYYY-MM; NULL = every month',
  status           ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_by       VARCHAR(36)      NULL,
  created_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_ede_employee   (employee_id),
  INDEX idx_ede_run_month  (run_month),
  INDEX idx_ede_status     (status),
  CONSTRAINT fk_ede_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
