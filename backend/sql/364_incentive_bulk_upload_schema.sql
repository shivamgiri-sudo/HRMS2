-- Migration 364: Incentive Bulk Upload Schema
-- Fixes incentive_upload_batch to have the columns the service expects (incentive_id, pay_month)
-- Adds cost_centre_id/branch_id to incentive_upload_line
-- Adds register_ref to incentive_payroll_register
-- Creates incentive_upload_line if migration 136 was never run
-- Safe to re-run: all ALTERs use INFORMATION_SCHEMA guards

-- 1. Ensure incentive_master exists
CREATE TABLE IF NOT EXISTS incentive_master (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  incentive_code   VARCHAR(50)  NOT NULL UNIQUE,
  incentive_name   VARCHAR(255) NOT NULL,
  description      TEXT,
  gl_code          VARCHAR(50)  NULL,
  taxable          TINYINT(1)   NOT NULL DEFAULT 1,
  pf_applicable    TINYINT(1)   NOT NULL DEFAULT 0,
  esic_applicable  TINYINT(1)   NOT NULL DEFAULT 0,
  active_status    TINYINT(1)   NOT NULL DEFAULT 1,
  created_by       CHAR(36)     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO incentive_master (incentive_code, incentive_name, taxable, pf_applicable, esic_applicable) VALUES
  ('NSA',   'Night Shift Allowance',           1, 0, 0),
  ('PERF',  'Performance Incentive',           1, 0, 0),
  ('REF',   'Referral Incentive',              1, 0, 0),
  ('OT',    'Overtime Allowance',              1, 0, 1),
  ('PLI',   'Performance Linked Incentive',    1, 0, 0),
  ('INDM',  'Performance Incentive Indiamart', 1, 0, 0),
  ('SPEC',  'Special Task Incentive',          1, 0, 0)
ON DUPLICATE KEY UPDATE incentive_name = VALUES(incentive_name);

-- 2. Add incentive_id to incentive_upload_batch
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incentive_upload_batch' AND COLUMN_NAME = 'incentive_id') = 0,
  'ALTER TABLE incentive_upload_batch ADD COLUMN incentive_id CHAR(36) NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Add pay_month to incentive_upload_batch
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incentive_upload_batch' AND COLUMN_NAME = 'pay_month') = 0,
  'ALTER TABLE incentive_upload_batch ADD COLUMN pay_month VARCHAR(7) NULL AFTER incentive_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. Add cost_centre_id to incentive_upload_batch
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incentive_upload_batch' AND COLUMN_NAME = 'cost_centre_id') = 0,
  'ALTER TABLE incentive_upload_batch ADD COLUMN cost_centre_id CHAR(36) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. Ensure incentive_upload_line exists (migration 136 may not have run)
CREATE TABLE IF NOT EXISTS incentive_upload_line (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  batch_id          CHAR(36)      NOT NULL,
  employee_id       CHAR(36)      NOT NULL,
  employee_code     VARCHAR(50)   NOT NULL,
  incentive_code    VARCHAR(50)   NULL COMMENT 'type code e.g. NSA, PERF',
  amount            DECIMAL(10,2) NOT NULL DEFAULT 0,
  remarks           TEXT,
  validation_status ENUM('ok','error') NOT NULL DEFAULT 'ok',
  validation_msg    VARCHAR(512),
  branch_id         CHAR(36)      NULL,
  cost_centre_id    CHAR(36)      NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_il_batch    (batch_id),
  INDEX idx_il_employee (employee_id),
  FOREIGN KEY (batch_id) REFERENCES incentive_upload_batch(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Add incentive_code to existing incentive_upload_line (if 136 ran without it)
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incentive_upload_line' AND COLUMN_NAME = 'incentive_code') = 0,
  'ALTER TABLE incentive_upload_line ADD COLUMN incentive_code VARCHAR(50) NULL COMMENT "type code" AFTER employee_code',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7. Add branch_id to incentive_upload_line
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incentive_upload_line' AND COLUMN_NAME = 'branch_id') = 0,
  'ALTER TABLE incentive_upload_line ADD COLUMN branch_id CHAR(36) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 8. Add cost_centre_id to incentive_upload_line
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incentive_upload_line' AND COLUMN_NAME = 'cost_centre_id') = 0,
  'ALTER TABLE incentive_upload_line ADD COLUMN cost_centre_id CHAR(36) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 9. Add register_ref to incentive_payroll_register
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incentive_payroll_register' AND COLUMN_NAME = 'register_ref') = 0,
  'ALTER TABLE incentive_payroll_register ADD COLUMN register_ref VARCHAR(50) NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 10. Add incentive_total to salary_prep_line if missing
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'incentive_total') = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN incentive_total DECIMAL(10,2) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
