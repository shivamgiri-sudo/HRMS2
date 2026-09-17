-- Migration 1804: Add data_source/source_reference to gs1_approval_audit_raw.
--
-- Corrective fix for 1800, found by live-running the GS1 Approval import against the real
-- "GS1.xlsx" Approval sheet immediately after applying 1800/1802: every row failed outright
-- with ER_BAD_FIELD_ERROR "Unknown column 'data_source'" on gs1_approval_audit_raw. 1800 only
-- backfilled data_source/source_reference onto gs1_email_daily_actual and
-- gs1_datakart_daily_actual (and only added the missing UNIQUE KEY to gs1_approval_audit_raw,
-- not re-checking its columns) -- but gs1_approval_audit_raw has the exact same gap: migration
-- 1769's own CREATE TABLE text declares both columns, gs1-approval-audit-bulk.service.ts
-- inserts into both on every row, yet SHOW COLUMNS confirms neither exists live. Same root
-- cause as 1800 (table created by an earlier run of 1769 before these columns were added to
-- its text; CREATE TABLE IF NOT EXISTS never backfills an existing table).
--
-- Table confirmed still empty live (every prior Approval import attempt failed at this exact
-- error) -- pure additive schema fix, no backfill needed.

SET @tbl := 'gs1_approval_audit_raw';
SET @col := 'data_source';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN data_source VARCHAR(50) NULL AFTER sku_count'),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := 'source_reference';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN source_reference VARCHAR(36) NULL AFTER data_source'),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
