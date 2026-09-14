-- Migration 1764: add attachment_url to exit_clearance_task.
-- Supports the WFM "Client ID deactivation" clearance task where the WFM team
-- attaches the confirmation screenshot/email from Operations showing the agent's
-- client-system ID has been deactivated. Field is nullable (non-mandatory) so
-- all existing tasks and the other seven default tasks are unaffected.
-- ADD COLUMN IF NOT EXISTS is MariaDB syntax; MySQL 8 requires the check via information_schema.
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_clearance_task' AND COLUMN_NAME = 'attachment_url'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE exit_clearance_task ADD COLUMN attachment_url VARCHAR(700) DEFAULT NULL AFTER remarks',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
