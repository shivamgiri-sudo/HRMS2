-- Preserve the exact source used to create each employee/day attendance row.
USE mas_hrms;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'attendance_daily_record'
    AND COLUMN_NAME = 'source_system'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE attendance_daily_record ADD COLUMN source_system VARCHAR(100) NULL AFTER attendance_source',
  'SELECT ''source_system already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'attendance_daily_record'
    AND COLUMN_NAME = 'source_record_date'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE attendance_daily_record ADD COLUMN source_record_date DATE NULL AFTER source_system',
  'SELECT ''source_record_date already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'attendance_daily_record'
    AND COLUMN_NAME = 'source_reference'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE attendance_daily_record ADD COLUMN source_reference VARCHAR(255) NULL AFTER source_record_date',
  'SELECT ''source_reference already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'attendance_daily_record'
    AND INDEX_NAME = 'idx_adr_source_date'
);
SET @sql = IF(
  @idx = 0,
  'CREATE INDEX idx_adr_source_date ON attendance_daily_record (source_system, source_record_date)',
  'SELECT ''idx_adr_source_date already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
