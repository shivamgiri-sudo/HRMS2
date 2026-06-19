-- 215_inactive_access_and_otp_auth.sql (Without Trigger)
-- Add 90-day grace period for inactive employees to access historical data
-- Add SMS/WhatsApp OTP authentication support for email-less employees

-- 1. Add access_end_date to employees for grace period tracking
-- Check if column exists first, add if it doesn't
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'access_end_date');

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE employees ADD COLUMN access_end_date DATE NULL COMMENT ''90-day grace period for terminated employees to access historical data''',
  'SELECT ''Column access_end_date already exists'' AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Add index for faster inactive employee queries
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_employees_status_access');

SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_employees_status_access ON employees(active_status, access_end_date)',
  'SELECT ''Index idx_employees_status_access already exists'' AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Add audit log for inactive employee logins
CREATE TABLE IF NOT EXISTS auth_inactive_access_log (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  employee_id CHAR(36) NOT NULL,
  login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent TEXT,
  access_granted TINYINT(1) NOT NULL DEFAULT 1,
  denial_reason VARCHAR(255),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_inactive_log_date (login_at),
  INDEX idx_inactive_log_emp (employee_id)
);

-- 4. Create OTP table for password reset via SMS/WhatsApp
CREATE TABLE IF NOT EXISTS auth_password_reset_otp (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  phone VARCHAR(20) NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  expires_at DATETIME NOT NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_phone (phone),
  INDEX idx_otp_expires (expires_at)
);

-- Note: Trigger creation skipped due to SUPER privilege requirement
-- Grace period will be set automatically by application code when employee becomes inactive
-- Manual command to set grace period for existing inactive employees:
-- UPDATE employees SET access_end_date = DATE_ADD(CURDATE(), INTERVAL 90 DAY) WHERE active_status = 0 AND access_end_date IS NULL;
