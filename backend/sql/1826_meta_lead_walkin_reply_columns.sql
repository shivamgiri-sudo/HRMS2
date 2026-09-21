-- 1826_meta_lead_walkin_reply_columns.sql
--
-- Add walk-in reply tracking columns to meta_lead_raw.
-- The Wassenger WhatsApp webhook records the candidate's reply to the
-- shortlist notification (confirmed / reschedule / not_interested).
-- All columns are additive / nullable so existing rows are unaffected.
--
-- MySQL 8 does not support ADD COLUMN IF NOT EXISTS in a plain ALTER TABLE;
-- uses the information_schema-guarded PREPARE/EXECUTE idiom.

SET @db = DATABASE();

SET @sql = IF(
  NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'meta_lead_raw'
                AND COLUMN_NAME = 'walkin_confirmed'),
  'ALTER TABLE meta_lead_raw ADD COLUMN walkin_confirmed TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT ''walkin_confirmed already exists'' AS _skip'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'meta_lead_raw'
                AND COLUMN_NAME = 'walkin_reschedule_requested'),
  'ALTER TABLE meta_lead_raw ADD COLUMN walkin_reschedule_requested TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT ''walkin_reschedule_requested already exists'' AS _skip'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'meta_lead_raw'
                AND COLUMN_NAME = 'walkin_declined'),
  'ALTER TABLE meta_lead_raw ADD COLUMN walkin_declined TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT ''walkin_declined already exists'' AS _skip'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'meta_lead_raw'
                AND COLUMN_NAME = 'walkin_reply'),
  'ALTER TABLE meta_lead_raw ADD COLUMN walkin_reply VARCHAR(30) NULL',
  'SELECT ''walkin_reply already exists'' AS _skip'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'meta_lead_raw'
                AND COLUMN_NAME = 'walkin_reply_at'),
  'ALTER TABLE meta_lead_raw ADD COLUMN walkin_reply_at DATETIME NULL',
  'SELECT ''walkin_reply_at already exists'' AS _skip'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'meta_lead_raw'
                AND INDEX_NAME = 'idx_ml_walkin'),
  'ALTER TABLE meta_lead_raw ADD INDEX idx_ml_walkin (walkin_confirmed)',
  'SELECT ''idx_ml_walkin already exists'' AS _skip'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1826_meta_lead_walkin_reply_columns.sql applied' AS migration_status;
