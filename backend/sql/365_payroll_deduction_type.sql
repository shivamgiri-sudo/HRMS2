-- Migration 365: Payroll Deduction Type Master
-- Creates payroll_deduction_type table for configurable deduction categories
-- Adds deduction_type_code, branch_id, cost_centre_id to employee_deduction_entries
-- Adds other_deductions column to salary_prep_line
-- Safe to re-run: CREATE TABLE IF NOT EXISTS + INFORMATION_SCHEMA guards

-- 1. Deduction type master
CREATE TABLE IF NOT EXISTS payroll_deduction_type (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  deduction_code   VARCHAR(50)  NOT NULL UNIQUE,
  deduction_name   VARCHAR(255) NOT NULL,
  description      TEXT,
  is_prorated      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1=scale by payable days, 0=flat amount',
  active_status    TINYINT(1)   NOT NULL DEFAULT 1,
  created_by       CHAR(36)     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed common deduction types
INSERT INTO payroll_deduction_type (deduction_code, deduction_name, is_prorated) VALUES
  ('CANTEEN',        'Canteen Recovery',       1),
  ('UNIFORM',        'Uniform Charges',        0),
  ('LOAN_EMI',       'Loan EMI Recovery',      0),
  ('COURT_ATT',      'Court Attachment',       0),
  ('MOBILE',         'Mobile Deduction',       0),
  ('ASSET_RECOVERY', 'Asset Recovery',         0),
  ('OTHER',          'Other Deduction',        0)
ON DUPLICATE KEY UPDATE deduction_name = VALUES(deduction_name);

-- 2. Add deduction_type_code to employee_deduction_entries
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_deduction_entries' AND COLUMN_NAME = 'deduction_type_code') = 0,
  'ALTER TABLE employee_deduction_entries ADD COLUMN deduction_type_code VARCHAR(50) NULL AFTER description',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Add branch_id to employee_deduction_entries
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_deduction_entries' AND COLUMN_NAME = 'branch_id') = 0,
  'ALTER TABLE employee_deduction_entries ADD COLUMN branch_id CHAR(36) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. Add cost_centre_id to employee_deduction_entries
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_deduction_entries' AND COLUMN_NAME = 'cost_centre_id') = 0,
  'ALTER TABLE employee_deduction_entries ADD COLUMN cost_centre_id CHAR(36) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. Add other_deductions to salary_prep_line
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'other_deductions') = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN other_deductions DECIMAL(10,2) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
