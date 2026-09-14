-- COLLATION: utf8mb4_unicode_ci, matching the database default and employees.
-- These tables were originally created utf8mb4_0900_ai_ci (MySQL 8's server default),
-- while mas_hrms and employees are utf8mb4_unicode_ci. Both tables carry employee_code
-- and deduction-snapshot.routes.ts joins them with
--   LEFT JOIN employees e ON e.employee_code = q.employee_code
-- which raised ER_CANT_AGGREGATE_2COLLATIONS ("Illegal mix of collations") and 500'd both
-- endpoints against real data. Fixed here for fresh builds; migration 1617 converts the
-- already-created tables in environments where this file has already run.

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
