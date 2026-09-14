-- 173_employees_ctc_column.sql
-- Adds CTC (Cost to Company, annual) column to employees table
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employees'
    AND COLUMN_NAME = 'ctc'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE employees ADD COLUMN ctc DECIMAL(12,2) NULL DEFAULT NULL COMMENT ''Annual Cost to Company (CTC) in INR''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
