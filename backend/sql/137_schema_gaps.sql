-- backend/sql/137_schema_gaps.sql
-- Fills two schema gaps discovered during audit:
--   1. salary_prep_line_component — referenced by payroll, payroll-compliance, and incentives
--      but never created in any prior migration.
--   2. state_name column on minimum_wage_master — already defined in 028 without this column
--      but the payroll-masters UI and service expect it.
USE mas_hrms;

-- ── 1. salary_prep_line_component ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salary_prep_line_component (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_id         CHAR(36)      NOT NULL,
  line_id        CHAR(36)      NOT NULL,
  employee_id    CHAR(36)      NOT NULL,
  component_code VARCHAR(50)   NOT NULL,
  component_name VARCHAR(255)  NOT NULL,
  component_type ENUM('earning','deduction','employer_cost') NOT NULL DEFAULT 'earning',
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  source         VARCHAR(100)  NULL,
  taxable        TINYINT(1)    NOT NULL DEFAULT 1,
  UNIQUE KEY uq_line_component (line_id, component_code),
  INDEX idx_splc_run       (run_id),
  INDEX idx_splc_line      (line_id),
  INDEX idx_splc_employee  (employee_id),
  FOREIGN KEY (run_id)      REFERENCES salary_prep_run(id)      ON DELETE CASCADE,
  FOREIGN KEY (line_id)     REFERENCES salary_prep_line(id)     ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id)            ON DELETE CASCADE
);

-- ── 2. state_name on minimum_wage_master (additive, safe) ────────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'minimum_wage_master'
     AND COLUMN_NAME  = 'state_name') = 0,
  'ALTER TABLE minimum_wage_master ADD COLUMN state_name VARCHAR(100) NOT NULL DEFAULT '''' AFTER state_code',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
