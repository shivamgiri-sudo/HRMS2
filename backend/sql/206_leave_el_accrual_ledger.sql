-- 206_leave_el_accrual_ledger.sql
-- Tracks monthly EL accumulation per employee per year (NOT spendable during accumulation year).
-- On Jan 1 of year N+1, this total is transferred to leave_balance_ledger as spendable EL.

CREATE TABLE IF NOT EXISTS leave_el_accrual_ledger (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()),
  employee_id     CHAR(36)       NOT NULL,
  accrual_year    INT            NOT NULL,
  accrued_days    DECIMAL(6,2)   NOT NULL DEFAULT 0.00 COMMENT 'Running total of EL accumulated this year',
  last_credited_month INT        NOT NULL DEFAULT 0    COMMENT 'Last month (1-12) that was credited; 0 = none yet',
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_el_accrual (employee_id, accrual_year),
  KEY idx_el_accrual_year (accrual_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
