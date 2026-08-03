-- 246_nominee_gratuity_distribution.sql
-- Support nominee-based gratuity distribution on employee exit

-- 1. Create gratuity_distribution table for recording nominee payouts
CREATE TABLE IF NOT EXISTS gratuity_distribution (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  exit_request_id   CHAR(36)      NOT NULL,
  employee_id       CHAR(36)      NOT NULL,
  nominee_id        CHAR(36),
  nominee_name      VARCHAR(255)  NOT NULL COMMENT 'Nominee name or Employee Bank Account',
  payout_amount     DECIMAL(12,2) NOT NULL,
  status            ENUM('pending','processed','rejected') NOT NULL DEFAULT 'pending',
  paid_on           DATETIME      NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exit_request_id) REFERENCES exit_request(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (nominee_id) REFERENCES employee_nominee(id) ON DELETE SET NULL,
  INDEX idx_exit_emp (exit_request_id, employee_id),
  INDEX idx_nominee (nominee_id)
);

-- 2. Standardize employee address field naming (address_line1 → address1 for consistency)
--
-- CHANGE COLUMN IF EXISTS is MariaDB syntax; MySQL rejects it as a syntax error. Unlike the
-- ADD/DROP cases elsewhere in this repo, the clause cannot simply be removed: renaming a
-- column that is not there raises ER_BAD_FIELD_ERROR (1054), which is not an idempotency
-- error and would stop the chain. So the rename is guarded on the source column existing.
SET @has_addr1 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='address_line1');
SET @sql = IF(@has_addr1 > 0,
  'ALTER TABLE employees CHANGE COLUMN address_line1 address1 VARCHAR(255) NULL',
  'SELECT ''employees.address_line1 absent; rename skipped'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_addr2 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='address_line2');
SET @sql = IF(@has_addr2 > 0,
  'ALTER TABLE employees CHANGE COLUMN address_line2 address2 VARCHAR(255) NULL',
  'SELECT ''employees.address_line2 absent; rename skipped'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Add separate permanent address fields to employees table
ALTER TABLE employees
ADD COLUMN permanent_address1 VARCHAR(255) NULL COMMENT 'Permanent address line 1',
ADD COLUMN permanent_address2 VARCHAR(255) NULL COMMENT 'Permanent address line 2',
ADD COLUMN permanent_city VARCHAR(100) NULL COMMENT 'Permanent city',
ADD COLUMN permanent_state VARCHAR(100) NULL COMMENT 'Permanent state',
ADD COLUMN permanent_pincode VARCHAR(20) NULL COMMENT 'Permanent pincode',
ADD COLUMN permanent_country VARCHAR(100) NULL COMMENT 'Permanent country';

-- 4. Create gratuity_calculation_audit table for tracking gratuity calculations
CREATE TABLE IF NOT EXISTS gratuity_calculation_audit (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  exit_request_id   CHAR(36)      NOT NULL UNIQUE,
  employee_id       CHAR(36)      NOT NULL,
  years_of_service  DECIMAL(5,2)  NOT NULL,
  basic_monthly     DECIMAL(12,2) NOT NULL,
  gratuity_formula  VARCHAR(100)  NOT NULL COMMENT 'e.g., (basic/26)*15*years',
  gross_gratuity    DECIMAL(12,2) NOT NULL,
  tax_deducted      DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_gratuity      DECIMAL(12,2) NOT NULL,
  calculation_date  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exit_request_id) REFERENCES exit_request(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_emp_audit (employee_id)
);

-- 5. Add audit columns to full_final_calculation for nominee distribution tracking
ALTER TABLE full_final_calculation
ADD COLUMN nominee_distribution_status ENUM('not_applicable','pending','completed','rejected') NOT NULL DEFAULT 'not_applicable' AFTER is_ff_provisional,
ADD COLUMN gratuity_distribution_id CHAR(36) NULL AFTER nominee_distribution_status;

-- Ensure existing records have default value
UPDATE full_final_calculation
SET nominee_distribution_status = CASE
  WHEN gratuity_amount > 0 THEN 'pending'
  ELSE 'not_applicable'
END
WHERE nominee_distribution_status = 'not_applicable';

-- audit_log has no action, module or details column. It is created as
-- `CREATE TABLE IF NOT EXISTS audit_log LIKE audit_action_log` (218/220), so its shape is
-- fully determined: action_type, module_key, metadata_json. This INSERT named three columns
-- that have never existed and failed on any fresh database with "Unknown column 'action'".
--
-- Corrected rather than guarded, because unlike the other column mismatches on this branch
-- there is nothing ambiguous here — LIKE fixes the shape exactly, and writing the audit row
-- is the entire point of the statement. metadata_json is a JSON column, so the note is
-- wrapped in JSON_OBJECT rather than passed as a bare string, which would be rejected.
INSERT INTO audit_log (action_type, module_key, metadata_json, created_at)
VALUES (
  'nominee_gratuity_distribution_setup',
  'exit',
  JSON_OBJECT('note', 'Created gratuity_distribution table, standardized address fields, added permanent address columns'),
  NOW()
);
