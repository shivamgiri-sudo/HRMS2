-- 150_leave_policy_engine.sql
USE mas_hrms;

-- 1. Fix EL max_days_per_year from 15 → 18
UPDATE leave_type_master SET max_days_per_year = 18 WHERE leave_code = 'EL' AND max_days_per_year != 18;

-- 2. leave_request.status is VARCHAR(50), so 'pending_branch_head' value is already supported.
--    No schema change required.

-- Earlier deployments used these table names for a different key/value policy
-- schema. Preserve those rows before creating the worker-compatible tables.
SET @has_legacy_policy_shape = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'leave_policy_config'
    AND COLUMN_NAME = 'policy_key'
);
SET @has_policy_target_shape = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'leave_policy_config'
    AND COLUMN_NAME = 'leave_type_id'
);
SET @has_policy_legacy_table = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'leave_policy_config_legacy'
);
SET @sql = IF(
  @has_legacy_policy_shape > 0
    AND @has_policy_target_shape = 0
    AND @has_policy_legacy_table = 0,
  'RENAME TABLE leave_policy_config TO leave_policy_config_legacy',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_legacy_credit_shape = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'leave_el_credit_log'
    AND COLUMN_NAME = 'completed_months'
);
SET @has_credit_target_shape = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'leave_el_credit_log'
    AND COLUMN_NAME = 'leave_type_id'
);
SET @has_credit_legacy_table = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'leave_el_credit_log_legacy'
);
SET @sql = IF(
  @has_legacy_credit_shape > 0
    AND @has_credit_target_shape = 0
    AND @has_credit_legacy_table = 0,
  'RENAME TABLE leave_el_credit_log TO leave_el_credit_log_legacy',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. leave_policy_config table
CREATE TABLE IF NOT EXISTS leave_policy_config (
  id                        CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  leave_type_id             CHAR(36)      NOT NULL UNIQUE,
  monthly_credit_days       DECIMAL(5,2)  NOT NULL DEFAULT 0,
  annual_credit_days        DECIMAL(5,2)  NOT NULL DEFAULT 0,
  credit_on_jan_first       TINYINT(1)    NOT NULL DEFAULT 0,
  max_days_per_month        DECIMAL(5,2)  NOT NULL DEFAULT 0,
  max_occurrences_per_year  INT           NOT NULL DEFAULT 0,
  max_days_per_occurrence   DECIMAL(5,2)  NOT NULL DEFAULT 0,
  exception_approver_role   VARCHAR(50)   NULL,
  created_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (leave_type_id) REFERENCES leave_type_master(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Seed CL policy: 1 day/month credit, max 2 days/month, no occurrence limits
INSERT INTO leave_policy_config (
  leave_type_id, monthly_credit_days, annual_credit_days,
  credit_on_jan_first, max_days_per_month, max_occurrences_per_year,
  max_days_per_occurrence, exception_approver_role
)
SELECT id, 1.00, 0.00, 0, 2.00, 0, 0.00, NULL
FROM leave_type_master WHERE leave_code = 'CL'
ON DUPLICATE KEY UPDATE monthly_credit_days = 1.00, max_days_per_month = 2.00; -- idempotent re-run: update core policy fields if row already exists

-- 5. Seed EL policy: 18 days/year on Jan 1, max 2 occurrences/year, max 12 days/occurrence, branch_head exception
INSERT INTO leave_policy_config (
  leave_type_id, monthly_credit_days, annual_credit_days,
  credit_on_jan_first, max_days_per_month, max_occurrences_per_year,
  max_days_per_occurrence, exception_approver_role
)
SELECT id, 0.00, 18.00, 1, 0.00, 2, 12.00, 'branch_head'
FROM leave_type_master WHERE leave_code = 'EL'
ON DUPLICATE KEY UPDATE
  annual_credit_days = 18.00,
  max_occurrences_per_year = 2,
  max_days_per_occurrence = 12.00,
  exception_approver_role = 'branch_head';

-- 6. leave_el_credit_log table (tracks CL monthly credits and EL annual credits)
--    UNIQUE KEY covers (employee_id, leave_type_id, credit_year, credit_month, credit_type):
--    MySQL treats NULL as distinct in unique indexes, so monthly rows with NULL credit_month
--    do not conflict with each other; annual rows (NULL credit_month, credit_type='annual')
--    correctly prevent duplicate annual credits per employee per year.
CREATE TABLE IF NOT EXISTS leave_el_credit_log (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id   CHAR(36)      NOT NULL,
  leave_type_id CHAR(36)      NOT NULL,
  credit_year   INT           NOT NULL,
  credit_month  INT           NULL COMMENT 'NULL for annual credits, 1-12 for monthly',
  credit_date   DATE          NOT NULL,
  days_credited DECIMAL(6,2)  NOT NULL,
  months_served DECIMAL(5,2)  NOT NULL DEFAULT 0,
  credit_type   ENUM('annual','monthly','manual') NOT NULL DEFAULT 'annual',
  credit_month_key INT GENERATED ALWAYS AS (COALESCE(credit_month, 0)) STORED,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_leave_credit (employee_id, leave_type_id, credit_year, credit_month_key, credit_type),
  INDEX idx_credit_employee (employee_id),
  INDEX idx_credit_year (credit_year),
  FOREIGN KEY (employee_id)   REFERENCES employees(id)        ON DELETE CASCADE,
  FOREIGN KEY (leave_type_id) REFERENCES leave_type_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
