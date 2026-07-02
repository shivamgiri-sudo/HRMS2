-- 171_attendance_regularization_v2.sql
-- Enhances attendance_regularization with reason codes + requested status

-- Reason code master
CREATE TABLE IF NOT EXISTS attendance_reason_master (
  code        VARCHAR(50)  NOT NULL PRIMARY KEY,
  label       VARCHAR(255) NOT NULL,
  allowed_for ENUM('employee','manager','both') NOT NULL DEFAULT 'both',
  active      TINYINT(1)   NOT NULL DEFAULT 1
);

INSERT IGNORE INTO attendance_reason_master (code, label, allowed_for) VALUES
  ('DIALLER_NOT_LOGGED',     'Dialler system not logged (technical issue)',       'both'),
  ('FORGOT_LOGIN',           'Agent forgot to log into dialler',                 'employee'),
  ('SYSTEM_OUTAGE',          'System/network outage prevented login',            'both'),
  ('ON_FLOOR_WORK',          'Employee was on floor work (not on calls)',         'manager'),
  ('TRAINING_OFFLINE',       'Employee on offline/classroom training',            'manager'),
  ('MEDICAL_EMERGENCY',      'Medical emergency during shift',                    'both'),
  ('BIOMETRIC_MISMATCH',     'Biometric shows presence but dialler not logged',   'both'),
  ('INCORRECT_CAMPAIGN',     'Logged in under wrong campaign/agent ID',           'both'),
  ('APPROVED_INTERNAL_WORK', 'Approved internal task (non-call activity)',        'manager'),
  ('WFH_NOT_CAPTURED',       'Work from home attendance not captured',            'both'),
  ('LATE_ARRIVAL_VALID',     'Late arrival for valid personal reason',            'employee'),
  ('OTHER_MANAGER_APPROVED', 'Other — requires manager justification',            'manager');

-- Add columns with runner-compatible INFORMATION_SCHEMA guards.
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'attendance_regularization'
    AND COLUMN_NAME = 'requested_status'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN requested_status ENUM(''present'',''half_day'',''absent'') NULL AFTER session_date',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'attendance_regularization'
    AND COLUMN_NAME = 'reason_code'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN reason_code VARCHAR(50) NULL AFTER reason',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'attendance_regularization'
    AND COLUMN_NAME = 'requested_by_type'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN requested_by_type ENUM(''employee'',''manager'') NOT NULL DEFAULT ''employee'' AFTER reason_code',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'attendance_regularization'
    AND COLUMN_NAME = 'branch_id'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE attendance_regularization ADD COLUMN branch_id CHAR(36) NULL AFTER requested_by_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @constraint_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'attendance_regularization'
    AND CONSTRAINT_NAME = 'fk_reg_reason_code'
);
SET @sql = IF(
  @constraint_exists = 0,
  'ALTER TABLE attendance_regularization ADD CONSTRAINT fk_reg_reason_code FOREIGN KEY (reason_code) REFERENCES attendance_reason_master(code)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
