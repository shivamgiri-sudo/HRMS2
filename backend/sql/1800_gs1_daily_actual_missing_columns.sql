-- Migration 1800: Add data_source/source_reference to the two GS1 "_daily_actual" tables.
--
-- Found while fixing the GS1 upload pipeline (owner report: "HRMS Issue and observation
-- Reginald & GS1" — GS1 dashboard shows no data). gs1_email_daily_actual and
-- gs1_datakart_daily_actual are both missing data_source/source_reference — columns
-- migration 1769's own CREATE TABLE text declares, and gs1_approval_audit_raw (created by
-- the same migration) already has. Since CREATE TABLE IF NOT EXISTS is a no-op once a table
-- exists, these two tables were evidently created by an earlier run of 1769 before those two
-- columns were added to its text, and nothing ever backfilled them on the live tables.
--
-- Needed now: the rewritten bulk-upload services (gs1-email-daily-bulk.service.ts,
-- gs1-datakart-daily-bulk.service.ts) set data_source='bulk_upload' on every insert, matching
-- every other bulk-upload service in this codebase (an established auditability convention —
-- CLAUDE.md "every state-changing action... must be auditable").
--
-- Both tables are confirmed empty live (0 rows each) — this is the pipeline that was never
-- successfully used, per the owner's own report — so this is a pure additive schema change
-- with no backfill needed for existing rows.

SET @tbl := 'gs1_email_daily_actual';
SET @col := 'data_source';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN data_source VARCHAR(50) NULL AFTER tat_minutes'),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := 'source_reference';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN source_reference VARCHAR(36) NULL AFTER data_source'),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- gs1_approval_audit_raw's own service file (gs1-approval-audit-bulk.service.ts) has
-- always documented "UNIQUE key: (process_id, audit_date, auditee_name, auditor_name)"
-- and relies on ON DUPLICATE KEY UPDATE for that exact tuple -- but migration 1769's
-- CREATE TABLE never actually declared it (PRIMARY KEY (id) only, confirmed live via
-- SHOW INDEX). Every re-upload/correction would silently INSERT a duplicate row instead
-- of updating, inflating every SUM/COUNT the dashboard reads. Table is confirmed empty
-- (0 rows) live, so adding the constraint now is risk-free.
SET @tbl := 'gs1_approval_audit_raw';
SET @idx := 'uq_gs1_approval_audit';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD UNIQUE KEY `', @idx, '` (process_id, audit_date, auditee_name, auditor_name)'),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @idx);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @tbl := 'gs1_datakart_daily_actual';
SET @col := 'data_source';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN data_source VARCHAR(50) NULL AFTER process_type'),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := 'source_reference';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN source_reference VARCHAR(36) NULL AFTER data_source'),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
