-- Migration 062: Add Legacy Sync Fields to Employees Table
-- Adds fields from legacy masjclrentry table (32K employees)
-- Date: 2026-06-07

-- Note: Using individual ALTER statements for MySQL 5.x compatibility
-- Errors for existing columns are expected and safe to ignore

ALTER TABLE employees ADD COLUMN biometric_code VARCHAR(50) NULL COMMENT 'Biometric/attendance system ID from legacy';
ALTER TABLE employees ADD COLUMN date_of_leaving DATE NULL COMMENT 'Date of leaving/resignation';
ALTER TABLE employees ADD COLUMN marital_status VARCHAR(20) NULL COMMENT 'Married/Single/Divorced';
ALTER TABLE employees ADD COLUMN blood_group VARCHAR(10) NULL COMMENT 'A+/B+/O+/AB+ etc';
ALTER TABLE employees ADD COLUMN qualification VARCHAR(100) NULL COMMENT 'Educational qualification';
ALTER TABLE employees ADD COLUMN official_email VARCHAR(255) NULL COMMENT 'Official company email';
ALTER TABLE employees ADD COLUMN address_line1 VARCHAR(255) NULL COMMENT 'Primary address';
ALTER TABLE employees ADD COLUMN address_line2 VARCHAR(255) NULL COMMENT 'Secondary address';
ALTER TABLE employees ADD COLUMN city VARCHAR(100) NULL COMMENT 'City';
ALTER TABLE employees ADD COLUMN state VARCHAR(100) NULL COMMENT 'State';
ALTER TABLE employees ADD COLUMN pincode VARCHAR(20) NULL COMMENT 'PIN/Postal code';
ALTER TABLE employees ADD COLUMN passport_number VARCHAR(50) NULL COMMENT 'Passport number';
ALTER TABLE employees ADD COLUMN epf_number VARCHAR(50) NULL COMMENT 'EPF account number';
ALTER TABLE employees ADD COLUMN esic_number VARCHAR(50) NULL COMMENT 'ESIC number';
ALTER TABLE employees ADD COLUMN uan VARCHAR(50) NULL COMMENT 'Universal Account Number (EPF)';
ALTER TABLE employees ADD COLUMN department VARCHAR(100) NULL COMMENT 'Department name';
ALTER TABLE employees ADD COLUMN designation VARCHAR(100) NULL COMMENT 'Job designation/title';
ALTER TABLE employees ADD COLUMN branch VARCHAR(100) NULL COMMENT 'Branch/office location';
ALTER TABLE employees ADD COLUMN client_name VARCHAR(100) NULL COMMENT 'Client/project name';
ALTER TABLE employees ADD COLUMN process VARCHAR(100) NULL COMMENT 'Process/campaign name';
ALTER TABLE employees ADD COLUMN cost_center VARCHAR(100) NULL COMMENT 'Cost center code';
ALTER TABLE employees ADD COLUMN bank_account_number VARCHAR(100) NULL COMMENT 'Bank account number';
ALTER TABLE employees ADD COLUMN bank_name VARCHAR(100) NULL COMMENT 'Bank name';
ALTER TABLE employees ADD COLUMN bank_branch VARCHAR(100) NULL COMMENT 'Bank branch';
ALTER TABLE employees ADD COLUMN ifsc_code VARCHAR(20) NULL COMMENT 'Bank IFSC code';
ALTER TABLE employees ADD COLUMN account_holder_name VARCHAR(100) NULL COMMENT 'Bank account holder name';
ALTER TABLE employees ADD COLUMN legacy_last_updated DATETIME NULL COMMENT 'Timestamp from legacy system for incremental sync tracking';
ALTER TABLE employees ADD COLUMN legacy_emp_id INT NULL COMMENT 'Original ID from legacy masjclrentry table';
ALTER TABLE employees ADD COLUMN gender VARCHAR(20) NULL COMMENT 'Gender from legacy';
ALTER TABLE employees ADD COLUMN title VARCHAR(20) NULL COMMENT 'Mr/Ms/Mrs from legacy';

-- Add indexes (ignore errors if they exist)
ALTER TABLE employees ADD INDEX idx_biometric_code (biometric_code);
ALTER TABLE employees ADD INDEX idx_legacy_last_updated (legacy_last_updated);
ALTER TABLE employees ADD INDEX idx_legacy_emp_id (legacy_emp_id);
ALTER TABLE employees ADD INDEX idx_official_email (official_email);

SELECT 'Migration 062 complete: Added 30 legacy sync columns to employees table' AS status;
