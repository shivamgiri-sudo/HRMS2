-- 188_integration_table_header_mapping.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS integration_table_map (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key VARCHAR(100) NOT NULL,
  source_table    VARCHAR(255) NOT NULL,
  target_table    VARCHAR(100) NOT NULL,
  sync_mode       VARCHAR(50)  NOT NULL DEFAULT 'daily_aggregate',
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  confirmed_by    CHAR(36),
  confirmed_at    DATETIME,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_integration_source_table (integration_key, source_table),
  INDEX idx_table_map_key (integration_key),
  CONSTRAINT fk_table_map_integration
    FOREIGN KEY (integration_key) REFERENCES integration_config(integration_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_source_table = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'integration_field_map'
     AND COLUMN_NAME = 'source_table'
);
SET @sql = IF(
  @has_source_table = 0,
  'ALTER TABLE integration_field_map ADD COLUMN source_table VARCHAR(255) NOT NULL DEFAULT ''*'' AFTER integration_key',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_old_map_unique = (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'integration_field_map'
     AND INDEX_NAME = 'uq_map_key_field'
);
SET @sql = IF(
  @has_old_map_unique > 0,
  'ALTER TABLE integration_field_map DROP INDEX uq_map_key_field',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_table_field_unique = (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'integration_field_map'
     AND INDEX_NAME = 'uq_map_key_table_field'
);
SET @sql = IF(
  @has_table_field_unique = 0,
  'ALTER TABLE integration_field_map ADD UNIQUE KEY uq_map_key_table_field (integration_key, source_table, source_field)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_suggestion_source_table = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'integration_field_map_suggestion'
     AND COLUMN_NAME = 'source_table'
);
SET @sql = IF(
  @has_suggestion_source_table = 0,
  'ALTER TABLE integration_field_map_suggestion ADD COLUMN source_table VARCHAR(255) NOT NULL DEFAULT ''*'' AFTER integration_key',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
