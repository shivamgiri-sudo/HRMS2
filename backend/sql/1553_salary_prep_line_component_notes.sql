-- Migration 1553: Add notes column to salary_prep_line_component.
-- salary-dispute.service.ts inserts notes into this table when creating arrear adjustment lines.
-- The original CREATE TABLE (137_schema_gaps.sql) did not include notes; the INSERT fails silently.
-- Additive and idempotent: information_schema-guarded, TEXT NULL, no existing row touched.

SET @db = DATABASE();

SELECT COUNT(*) INTO @has_notes
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'salary_prep_line_component' AND COLUMN_NAME = 'notes';
SET @sql = IF(@has_notes = 0,
  'ALTER TABLE salary_prep_line_component
     ADD COLUMN notes TEXT NULL AFTER reason',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
