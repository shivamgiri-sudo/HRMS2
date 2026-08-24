-- Migration 1555: Add inference columns to attrition_record.
-- attrition-reason-inference.service.ts writes inferred_reason, confidence, and signals
-- when processing exits. All three are NULL-default; existing rows are unaffected.
-- Additive and idempotent: each column individually information_schema-guarded.

SET @db = DATABASE();

SELECT COUNT(*) INTO @has_reason
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'attrition_record' AND COLUMN_NAME = 'inferred_reason';
SET @sql = IF(@has_reason = 0,
  'ALTER TABLE attrition_record ADD COLUMN inferred_reason VARCHAR(50) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @has_conf
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'attrition_record' AND COLUMN_NAME = 'inference_confidence';
SET @sql = IF(@has_conf = 0,
  "ALTER TABLE attrition_record ADD COLUMN inference_confidence ENUM('HIGH','MEDIUM','LOW') NULL",
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @has_signals
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'attrition_record' AND COLUMN_NAME = 'inference_signals';
SET @sql = IF(@has_signals = 0,
  'ALTER TABLE attrition_record ADD COLUMN inference_signals JSON NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @has_idx
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'attrition_record' AND INDEX_NAME = 'idx_attrition_inferred_reason';
SET @sql = IF(@has_idx = 0,
  'ALTER TABLE attrition_record ADD INDEX idx_attrition_inferred_reason (inferred_reason)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
