-- Migration 1547: Snapshot tables for upload_deduction and qual_incentive from db_bill
-- Additive only — no existing tables modified

CREATE TABLE IF NOT EXISTS upload_deduction_snapshot (
  id              INT UNSIGNED    NOT NULL,          -- mirrors db_bill.upload_deduction.Id
  branch_name     VARCHAR(255)    DEFAULT NULL,
  cost_center     VARCHAR(255)    DEFAULT NULL,
  employee_code   VARCHAR(50)     DEFAULT NULL,
  employee_name   VARCHAR(255)    DEFAULT NULL,
  salary_month    VARCHAR(20)     DEFAULT NULL,      -- YYYY-MM format
  mobile_deduction      DECIMAL(12,2)  DEFAULT 0,
  short_collection      DECIMAL(12,2)  DEFAULT 0,
  asset_recovery        DECIMAL(12,2)  DEFAULT 0,
  insurance             DECIMAL(12,2)  DEFAULT 0,
  professional_tax      DECIMAL(12,2)  DEFAULT 0,
  leave_deduction       DECIMAL(12,2)  DEFAULT 0,
  others_deduction      DECIMAL(12,2)  DEFAULT 0,
  remarks               VARCHAR(500)   DEFAULT NULL,
  deduction_remarks     VARCHAR(500)   DEFAULT NULL,
  process_status        VARCHAR(50)    DEFAULT NULL,
  import_date           DATETIME       DEFAULT NULL,
  synced_at             DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_emp_code    (employee_code),
  KEY idx_salary_month (salary_month),
  KEY idx_branch      (branch_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS qual_incentive_snapshot (
  id          INT UNSIGNED   NOT NULL,               -- mirrors db_bill.qual_incentive.id
  employee_code VARCHAR(50)  DEFAULT NULL,
  sal_year    VARCHAR(10)    DEFAULT NULL,            -- e.g. "2019"
  sal_month   VARCHAR(10)    DEFAULT NULL,            -- e.g. "Jul"
  amount      DECIMAL(12,2)  DEFAULT 0,
  remarks     VARCHAR(500)   DEFAULT NULL,
  import_date DATETIME       DEFAULT NULL,
  synced_at   DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_emp_code  (employee_code),
  KEY idx_sal_year  (sal_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
