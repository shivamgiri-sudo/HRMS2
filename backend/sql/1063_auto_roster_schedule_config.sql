-- 1063_auto_roster_schedule_config.sql
-- Add per-process auto-schedule columns to wfm_process_planning_rule.
-- Uses INFORMATION_SCHEMA guards for MySQL 8.x compatibility.
USE mas_hrms;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'wfm_process_planning_rule'
    AND COLUMN_NAME  = 'auto_schedule_enabled'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE wfm_process_planning_rule ADD COLUMN auto_schedule_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1 = worker will auto-generate a draft roster for the next week on the configured day''',
  'SELECT ''auto_schedule_enabled already exists'' AS migration_note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'wfm_process_planning_rule'
    AND COLUMN_NAME  = 'auto_schedule_day_of_week'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE wfm_process_planning_rule ADD COLUMN auto_schedule_day_of_week TINYINT NOT NULL DEFAULT 0 COMMENT ''Day of week to run auto-generation: 0=Sunday, 1=Monday, ..., 6=Saturday''',
  'SELECT ''auto_schedule_day_of_week already exists'' AS migration_note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Seed worker_config row (disabled by default — must be explicitly enabled in DB)
INSERT IGNORE INTO worker_config (worker_name, enabled, description)
VALUES ('auto-roster-scheduler', 0, 'Weekly auto-roster draft generation — set enabled=1 and auto_schedule_enabled=1 on a planning rule to activate');

SELECT '1063_auto_roster_schedule_config.sql applied' AS migration_status;
