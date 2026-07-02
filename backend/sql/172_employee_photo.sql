-- 172_employee_photo.sql
-- Ensures avatar_url column exists in employees table.
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employees'
    AND COLUMN_NAME = 'avatar_url'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE employees ADD COLUMN avatar_url VARCHAR(512) NULL COMMENT ''Relative path: /uploads/employee-photos/<id>.<ext>''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
