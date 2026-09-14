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
ALTER TABLE employees CHANGE COLUMN IF EXISTS address_line1 address1 VARCHAR(255) NULL;
ALTER TABLE employees CHANGE COLUMN IF EXISTS address_line2 address2 VARCHAR(255) NULL;

-- 3. Add separate permanent address fields to employees table
SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'permanent_address1'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE employees ADD COLUMN permanent_address1 VARCHAR(255) NULL COMMENT ''Permanent address line 1''',
  'SELECT "permanent_address1 already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'permanent_address2'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE employees ADD COLUMN permanent_address2 VARCHAR(255) NULL COMMENT ''Permanent address line 2''',
  'SELECT "permanent_address2 already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'permanent_city'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE employees ADD COLUMN permanent_city VARCHAR(100) NULL COMMENT ''Permanent city''',
  'SELECT "permanent_city already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;

SET @mcol_4 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'permanent_state'
);
SET @msql_4 = IF(@mcol_4 = 0,
  'ALTER TABLE employees ADD COLUMN permanent_state VARCHAR(100) NULL COMMENT ''Permanent state''',
  'SELECT "permanent_state already exists" AS message');
PREPARE mstmt_4 FROM @msql_4;
EXECUTE mstmt_4;
DEALLOCATE PREPARE mstmt_4;

SET @mcol_5 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'permanent_pincode'
);
SET @msql_5 = IF(@mcol_5 = 0,
  'ALTER TABLE employees ADD COLUMN permanent_pincode VARCHAR(20) NULL COMMENT ''Permanent pincode''',
  'SELECT "permanent_pincode already exists" AS message');
PREPARE mstmt_5 FROM @msql_5;
EXECUTE mstmt_5;
DEALLOCATE PREPARE mstmt_5;

SET @mcol_6 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'permanent_country'
);
SET @msql_6 = IF(@mcol_6 = 0,
  'ALTER TABLE employees ADD COLUMN permanent_country VARCHAR(100) NULL COMMENT ''Permanent country''',
  'SELECT "permanent_country already exists" AS message');
PREPARE mstmt_6 FROM @msql_6;
EXECUTE mstmt_6;
DEALLOCATE PREPARE mstmt_6;

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
SET @mcol_7 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'full_final_calculation' AND COLUMN_NAME = 'nominee_distribution_status'
);
SET @msql_7 = IF(@mcol_7 = 0,
  'ALTER TABLE full_final_calculation ADD COLUMN nominee_distribution_status ENUM(''not_applicable'',''pending'',''completed'',''rejected'') NOT NULL DEFAULT ''not_applicable'' AFTER is_ff_provisional',
  'SELECT "nominee_distribution_status already exists" AS message');
PREPARE mstmt_7 FROM @msql_7;
EXECUTE mstmt_7;
DEALLOCATE PREPARE mstmt_7;

SET @mcol_8 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'full_final_calculation' AND COLUMN_NAME = 'gratuity_distribution_id'
);
SET @msql_8 = IF(@mcol_8 = 0,
  'ALTER TABLE full_final_calculation ADD COLUMN gratuity_distribution_id CHAR(36) NULL AFTER nominee_distribution_status',
  'SELECT "gratuity_distribution_id already exists" AS message');
PREPARE mstmt_8 FROM @msql_8;
EXECUTE mstmt_8;
DEALLOCATE PREPARE mstmt_8;

-- Ensure existing records have default value
UPDATE full_final_calculation
SET nominee_distribution_status = CASE
  WHEN gratuity_amount > 0 THEN 'pending'
  ELSE 'not_applicable'
END
WHERE nominee_distribution_status = 'not_applicable';

INSERT INTO audit_log (action, module, details, created_at)
VALUES ('nominee_gratuity_distribution_setup', 'exit', 'Created gratuity_distribution table, standardized address fields, added permanent address columns', NOW());
