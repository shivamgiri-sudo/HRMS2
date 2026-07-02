-- 215_inactive_access_and_otp_auth.sql
-- Add 90-day grace period for inactive employees to access historical data
-- Add SMS/WhatsApp OTP authentication support for email-less employees

-- 1. Add access_end_date to employees for grace period tracking
ALTER TABLE employees
ADD COLUMN access_end_date DATE NULL
COMMENT '90-day grace period for terminated employees to access historical data';

-- 2. Add index for faster inactive employee queries
CREATE INDEX idx_employees_status_access
ON employees(active_status, access_end_date);

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

-- 4. Trigger to auto-set access_end_date when employee becomes inactive
DROP TRIGGER IF EXISTS set_access_end_date_on_inactive;

DELIMITER $$
CREATE TRIGGER set_access_end_date_on_inactive
BEFORE UPDATE ON employees
FOR EACH ROW
BEGIN
  IF NEW.active_status = 0 AND OLD.active_status = 1 AND NEW.access_end_date IS NULL THEN
    -- Set 90-day grace period from today (only if not already set)
    SET NEW.access_end_date = DATE_ADD(CURDATE(), INTERVAL 90 DAY);
  END IF;
END$$
DELIMITER ;

-- 5. Create OTP table for password reset via SMS/WhatsApp
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
