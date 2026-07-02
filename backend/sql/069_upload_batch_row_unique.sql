-- Migration 069: Add unique constraint to prevent duplicate row_no within the same batch
-- Safe to run multiple times — creates index only if it does not already exist

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'upload_batch_row'
    AND index_name = 'uq_batch_row');

SET @sql := IF(@idx = 0,
  'ALTER TABLE upload_batch_row ADD UNIQUE KEY uq_batch_row (upload_batch_id, row_no)',
  'SELECT 1');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
