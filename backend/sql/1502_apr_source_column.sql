-- 1502_apr_source_column.sql
-- Add source columns to apr to track data origin and protect manual uploads.
-- Manual uploads are locked and should not be overwritten by sync workers.
-- Uses information_schema guards because this production MySQL rejects
-- ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS syntax.

SET @has_source = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr' AND COLUMN_NAME = 'source'
);
SET @sql = IF(@has_source = 0,
  "ALTER TABLE apr ADD COLUMN source ENUM('sync', 'manual') NOT NULL DEFAULT 'sync' AFTER cost_centre",
  "SELECT 'apr.source already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_uploaded_by = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr' AND COLUMN_NAME = 'uploaded_by'
);
SET @sql = IF(@has_uploaded_by = 0,
  "ALTER TABLE apr ADD COLUMN uploaded_by CHAR(36) NULL AFTER source",
  "SELECT 'apr.uploaded_by already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_upload_batch = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr' AND COLUMN_NAME = 'upload_batch_id'
);
SET @sql = IF(@has_upload_batch = 0,
  "ALTER TABLE apr ADD COLUMN upload_batch_id CHAR(36) NULL AFTER uploaded_by",
  "SELECT 'apr.upload_batch_id already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr' AND INDEX_NAME = 'idx_apr_source'
);
SET @sql = IF(@has_idx = 0,
  "ALTER TABLE apr ADD INDEX idx_apr_source (source)",
  "SELECT 'idx_apr_source already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
