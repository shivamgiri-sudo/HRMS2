-- 343_global_page_availability.sql
-- Global page availability switch for compliance release control.
USE mas_hrms;

SET @has_page_active := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'page_catalog'
    AND COLUMN_NAME = 'active_status'
);
SET @sql := IF(
  @has_page_active = 0,
  'ALTER TABLE page_catalog ADD COLUMN active_status TINYINT(1) NOT NULL DEFAULT 1 AFTER description',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_page_active_idx := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'page_catalog'
    AND INDEX_NAME = 'idx_page_catalog_active'
);
SET @sql := IF(
  @has_page_active_idx = 0,
  'CREATE INDEX idx_page_catalog_active ON page_catalog(active_status, module, page_name)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
