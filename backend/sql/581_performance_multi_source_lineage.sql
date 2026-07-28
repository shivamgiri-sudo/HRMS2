-- Migration 521: Preserve source-specific lineage before canonical KPI aggregation
-- Additive only. No existing performance fact is changed by this migration.
USE mas_hrms;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'performance_fact_lineage'
      AND COLUMN_NAME = 'source_dataset_id'
  ),
  'SELECT 1',
  'ALTER TABLE performance_fact_lineage ADD COLUMN source_dataset_id CHAR(36) NULL AFTER run_id'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'performance_fact_lineage'
      AND COLUMN_NAME = 'mapping_version_id'
  ),
  'SELECT 1',
  'ALTER TABLE performance_fact_lineage ADD COLUMN mapping_version_id CHAR(36) NULL AFTER source_dataset_id'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'performance_fact_lineage'
      AND COLUMN_NAME = 'source_record_count'
  ),
  'SELECT 1',
  'ALTER TABLE performance_fact_lineage ADD COLUMN source_record_count INT UNSIGNED NULL AFTER denominator_value'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'performance_fact_lineage'
      AND COLUMN_NAME = 'process_id_at_event'
  ),
  'SELECT 1',
  'ALTER TABLE performance_fact_lineage ADD COLUMN process_id_at_event CHAR(36) NULL AFTER source_record_count'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'performance_fact_lineage'
      AND COLUMN_NAME = 'branch_id_at_event'
  ),
  'SELECT 1',
  'ALTER TABLE performance_fact_lineage ADD COLUMN branch_id_at_event CHAR(36) NULL AFTER process_id_at_event'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'performance_fact_lineage'
      AND INDEX_NAME = 'idx_performance_lineage_source_fact'
  ),
  'SELECT 1',
  'ALTER TABLE performance_fact_lineage ADD INDEX idx_performance_lineage_source_fact (source_dataset_id, employee_id, metric_id, score_date, lineage_status)'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- VERIFY AFTER STAGING EXECUTION:
-- SHOW COLUMNS FROM performance_fact_lineage LIKE 'source_dataset_id';
-- SHOW COLUMNS FROM performance_fact_lineage LIKE 'mapping_version_id';
-- SHOW INDEX FROM performance_fact_lineage WHERE Key_name = 'idx_performance_lineage_source_fact';
