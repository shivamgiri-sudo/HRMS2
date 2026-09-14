-- Add call_id column to wfm_attendance_session for operations live status.
-- INFORMATION_SCHEMA guard keeps the migration idempotent across MySQL versions.
SET @col = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wfm_attendance_session'
    AND COLUMN_NAME = 'call_id'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE wfm_attendance_session ADD COLUMN call_id VARCHAR(100) NULL AFTER current_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
