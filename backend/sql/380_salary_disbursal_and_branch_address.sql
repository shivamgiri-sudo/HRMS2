-- Migration 380: Salary disbursal upload table + branch address field
-- Additive only — safe to run on existing schema.

-- Add address field to branch_master (guarded — MySQL 8.0 compatible)
-- Uses a SELECT…INTO to check and a prepared statement to conditionally ALTER.
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'branch_master'
     AND COLUMN_NAME  = 'address'
);
SET @ddl = IF(@col_exists = 0,
  'ALTER TABLE branch_master ADD COLUMN address VARCHAR(500) NULL AFTER state',
  'SELECT 1'
);
PREPARE _stmt FROM @ddl;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Table for payroll head to upload disbursal payment details post-salary disbursement
CREATE TABLE IF NOT EXISTS salary_run_disbursal (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_id        CHAR(36)     NOT NULL,
  employee_id   CHAR(36)     NOT NULL,
  employee_code VARCHAR(50)  NOT NULL,
  cheque_no     VARCHAR(100) NULL COMMENT 'Cheque number or UTR/NEFT reference',
  payment_mode  VARCHAR(30)  NULL COMMENT 'NEFT, IMPS, Cheque, Cash',
  payment_date  DATE         NULL,
  bank_ref      VARCHAR(100) NULL COMMENT 'Bank transaction reference',
  uploaded_by   CHAR(36)     NULL,
  uploaded_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes         TEXT         NULL,
  UNIQUE KEY uq_run_emp (run_id, employee_id),
  INDEX idx_run  (run_id),
  INDEX idx_emp  (employee_id),
  INDEX idx_code (employee_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Post-disbursal payment details uploaded by Payroll Head per payroll run';
