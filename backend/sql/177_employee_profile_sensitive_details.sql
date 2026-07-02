USE mas_hrms;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employees'
     AND COLUMN_NAME = 'alternate_mobile') = 0,
  'ALTER TABLE employees ADD COLUMN alternate_mobile VARCHAR(20) NULL AFTER mobile',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employee_bank_detail'
     AND COLUMN_NAME = 'account_holder_name') = 0,
  'ALTER TABLE employee_bank_detail ADD COLUMN account_holder_name VARCHAR(255) NULL AFTER bank_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employee_bank_detail'
     AND COLUMN_NAME = 'bank_branch') = 0,
  'ALTER TABLE employee_bank_detail ADD COLUMN bank_branch VARCHAR(255) NULL AFTER account_holder_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employee_uan'
     AND COLUMN_NAME = 'verification_status') = 0,
  'ALTER TABLE employee_uan ADD COLUMN verification_status ENUM(''pending'',''verified'',''rejected'') NOT NULL DEFAULT ''pending'' AFTER is_active',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employee_uan'
     AND COLUMN_NAME = 'verified_by') = 0,
  'ALTER TABLE employee_uan ADD COLUMN verified_by CHAR(36) NULL AFTER verification_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employee_uan'
     AND COLUMN_NAME = 'verified_at') = 0,
  'ALTER TABLE employee_uan ADD COLUMN verified_at DATETIME NULL AFTER verified_by',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
