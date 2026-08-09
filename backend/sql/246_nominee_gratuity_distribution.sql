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
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS permanent_address1 VARCHAR(255) NULL COMMENT 'Permanent address line 1',
ADD COLUMN IF NOT EXISTS permanent_address2 VARCHAR(255) NULL COMMENT 'Permanent address line 2',
ADD COLUMN IF NOT EXISTS permanent_city VARCHAR(100) NULL COMMENT 'Permanent city',
ADD COLUMN IF NOT EXISTS permanent_state VARCHAR(100) NULL COMMENT 'Permanent state',
ADD COLUMN IF NOT EXISTS permanent_pincode VARCHAR(20) NULL COMMENT 'Permanent pincode',
ADD COLUMN IF NOT EXISTS permanent_country VARCHAR(100) NULL COMMENT 'Permanent country';

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
ADD COLUMN IF NOT EXISTS nominee_distribution_status ENUM('not_applicable','pending','completed','rejected') NOT NULL DEFAULT 'not_applicable' AFTER is_ff_provisional,
ADD COLUMN IF NOT EXISTS gratuity_distribution_id CHAR(36) NULL AFTER nominee_distribution_status;

-- Ensure existing records have default value
UPDATE full_final_calculation
SET nominee_distribution_status = CASE
  WHEN gratuity_amount > 0 THEN 'pending'
  ELSE 'not_applicable'
END
WHERE nominee_distribution_status = 'not_applicable';

INSERT INTO audit_log (action, module, details, created_at)
VALUES ('nominee_gratuity_distribution_setup', 'exit', 'Created gratuity_distribution table, standardized address fields, added permanent address columns', NOW());
