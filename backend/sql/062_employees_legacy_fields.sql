-- Migration 062: Add Legacy Sync Fields to Employees Table
-- Adds fields from legacy masjclrentry table (32K employees).
-- MySQL 8.4 has no ADD COLUMN IF NOT EXISTS syntax, so each compatibility
-- operation is guarded through INFORMATION_SCHEMA before execution.

SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='biometric_code');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN biometric_code VARCHAR(50) NULL COMMENT ''Biometric/attendance system ID from legacy''', 'SELECT ''employees.biometric_code exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='date_of_leaving');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN date_of_leaving DATE NULL COMMENT ''Date of leaving/resignation''', 'SELECT ''employees.date_of_leaving exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='marital_status');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN marital_status VARCHAR(20) NULL COMMENT ''Married/Single/Divorced''', 'SELECT ''employees.marital_status exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='blood_group');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN blood_group VARCHAR(10) NULL COMMENT ''A+/B+/O+/AB+ etc''', 'SELECT ''employees.blood_group exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='qualification');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN qualification VARCHAR(100) NULL COMMENT ''Educational qualification''', 'SELECT ''employees.qualification exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='official_email');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN official_email VARCHAR(255) NULL COMMENT ''Official company email''', 'SELECT ''employees.official_email exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='address_line1');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN address_line1 VARCHAR(255) NULL COMMENT ''Primary address''', 'SELECT ''employees.address_line1 exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='address_line2');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN address_line2 VARCHAR(255) NULL COMMENT ''Secondary address''', 'SELECT ''employees.address_line2 exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='city');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN city VARCHAR(100) NULL COMMENT ''City''', 'SELECT ''employees.city exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='state');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN state VARCHAR(100) NULL COMMENT ''State''', 'SELECT ''employees.state exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='pincode');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN pincode VARCHAR(20) NULL COMMENT ''PIN/Postal code''', 'SELECT ''employees.pincode exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='passport_number');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN passport_number VARCHAR(50) NULL COMMENT ''Passport number''', 'SELECT ''employees.passport_number exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='epf_number');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN epf_number VARCHAR(50) NULL COMMENT ''EPF account number''', 'SELECT ''employees.epf_number exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='esic_number');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN esic_number VARCHAR(50) NULL COMMENT ''ESIC number''', 'SELECT ''employees.esic_number exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='uan');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN uan VARCHAR(50) NULL COMMENT ''Universal Account Number (EPF)''', 'SELECT ''employees.uan exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='department');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN department VARCHAR(100) NULL COMMENT ''Department name''', 'SELECT ''employees.department exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='designation');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN designation VARCHAR(100) NULL COMMENT ''Job designation/title''', 'SELECT ''employees.designation exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='branch');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN branch VARCHAR(100) NULL COMMENT ''Branch/office location''', 'SELECT ''employees.branch exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='client_name');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN client_name VARCHAR(100) NULL COMMENT ''Client/project name''', 'SELECT ''employees.client_name exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='process');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN process VARCHAR(100) NULL COMMENT ''Process/campaign name''', 'SELECT ''employees.process exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='cost_center');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN cost_center VARCHAR(100) NULL COMMENT ''Cost center code''', 'SELECT ''employees.cost_center exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='bank_account_number');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN bank_account_number VARCHAR(100) NULL COMMENT ''Bank account number''', 'SELECT ''employees.bank_account_number exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='bank_name');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN bank_name VARCHAR(100) NULL COMMENT ''Bank name''', 'SELECT ''employees.bank_name exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='bank_branch');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN bank_branch VARCHAR(100) NULL COMMENT ''Bank branch''', 'SELECT ''employees.bank_branch exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='ifsc_code');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN ifsc_code VARCHAR(20) NULL COMMENT ''Bank IFSC code''', 'SELECT ''employees.ifsc_code exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='account_holder_name');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN account_holder_name VARCHAR(100) NULL COMMENT ''Bank account holder name''', 'SELECT ''employees.account_holder_name exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='legacy_last_updated');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN legacy_last_updated DATETIME NULL COMMENT ''Timestamp from legacy system for incremental sync tracking''', 'SELECT ''employees.legacy_last_updated exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='legacy_emp_id');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN legacy_emp_id INT NULL COMMENT ''Original ID from legacy masjclrentry table''', 'SELECT ''employees.legacy_emp_id exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='gender');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN gender VARCHAR(20) NULL COMMENT ''Gender from legacy''', 'SELECT ''employees.gender exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='title');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD COLUMN title VARCHAR(20) NULL COMMENT ''Mr/Ms/Mrs from legacy''', 'SELECT ''employees.title exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Indexes are also compatibility objects and must be guarded independently.
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND INDEX_NAME='idx_biometric_code');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD INDEX idx_biometric_code (biometric_code)', 'SELECT ''idx_biometric_code exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND INDEX_NAME='idx_legacy_last_updated');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD INDEX idx_legacy_last_updated (legacy_last_updated)', 'SELECT ''idx_legacy_last_updated exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND INDEX_NAME='idx_legacy_emp_id');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD INDEX idx_legacy_emp_id (legacy_emp_id)', 'SELECT ''idx_legacy_emp_id exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND INDEX_NAME='idx_official_email');
SET @ddl = IF(@exists=0, 'ALTER TABLE employees ADD INDEX idx_official_email (official_email)', 'SELECT ''idx_official_email exists'' AS status'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 062 complete: legacy employee columns and indexes reconciled' AS status;
