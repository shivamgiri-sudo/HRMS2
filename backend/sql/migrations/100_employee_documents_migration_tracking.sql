-- Migration: Add provenance tracking columns to employee_documents
-- Safe to run multiple times (IF NOT EXISTS guards)

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS legacy_source ENUM('document_master','qual_docoments','esignature','manual') NULL AFTER doc_category,
  ADD COLUMN IF NOT EXISTS legacy_ref_id INT NULL AFTER legacy_source;

-- Unique index to prevent duplicate imports per source+id pair
-- Use a conditional guard since CREATE UNIQUE INDEX IF NOT EXISTS isn't supported in all MySQL 5.x
SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employee_documents'
    AND INDEX_NAME = 'idx_emp_doc_legacy'
);
SET @sql = IF(@idx = 0,
  'ALTER TABLE employee_documents ADD UNIQUE INDEX idx_emp_doc_legacy (legacy_source, legacy_ref_id)',
  'SELECT 1'
);
PREPARE s FROM @sql;
EXECUTE s;
DEALLOCATE PREPARE s;
