-- Migration 408: Leave lapse on payroll cycle close
-- When a payroll cycle locks, any still-pending leave requests for that month
-- are marked 'lapsed'. The LWP deduction already stands (absent ADR rows).
-- These columns record who lapsed the leave and which payroll run triggered it.

SET @sql = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE leave_request ADD COLUMN lapsed_at DATETIME NULL AFTER status',
    'SELECT 1'
  ) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_request' AND COLUMN_NAME = 'lapsed_at'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE leave_request ADD COLUMN lapsed_reason VARCHAR(255) NULL AFTER lapsed_at',
    'SELECT 1'
  ) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_request' AND COLUMN_NAME = 'lapsed_reason'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE leave_request ADD COLUMN lapsed_run_id CHAR(36) NULL AFTER lapsed_reason',
    'SELECT 1'
  ) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_request' AND COLUMN_NAME = 'lapsed_run_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
