-- Migration 1554: Add alert_threshold_pct to workforce_mandate.
-- hc-gap-alert.cron.ts reads this column daily to decide whether to fire an alert.
-- Additive and idempotent: information_schema-guarded, existing rows default to 80.00%.

SET @db = DATABASE();

SELECT COUNT(*) INTO @has_col
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'workforce_mandate' AND COLUMN_NAME = 'alert_threshold_pct';
SET @sql = IF(@has_col = 0,
  'ALTER TABLE workforce_mandate
     ADD COLUMN alert_threshold_pct DECIMAL(5,2) NOT NULL DEFAULT 80.00',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
