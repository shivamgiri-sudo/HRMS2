-- Migration 1805: Key gs1_approval_audit_raw per SKU (GTIN), not per person-per-day.
--
-- Found by live-running the real GS1 Approval import (owner-approved end-to-end verification,
-- immediately after 1800/1802/1804): all 7 real rows in "GS1.xlsx"'s Approval sheet share the
-- exact same auditee ("Kishan Yadav"), auditor ("Manisha") and date (1-Sep-26) -- because the
-- real export is a per-SKU/per-GTIN QC log (confirmed live: 7 distinct GTINs, 7 distinct
-- companies, same two people, same day). The existing UNIQUE KEY
-- uq_gs1_approval_audit(process_id, audit_date, auditee_name, auditor_name) -- added by 1800,
-- inherited from 1769's own design -- silently collapsed all 7 real product audits into ONE
-- row via ON DUPLICATE KEY UPDATE, understating the real audit volume 7x and showing only the
-- last-processed product's company/result. gs1_approval_audit_raw is meant to be a RAW per-event
-- log (its own name says so); the key needs to include the product, not just the person+day.
--
-- Adds gtin VARCHAR(20) (the real export's own GTIN/barcode column, already an accepted
-- optional template column per 1802 -- always populated live), then replaces the unique key
-- with (process_id, audit_date, auditee_name, auditor_name, gtin). Table had exactly 1 row live
-- at the time of this fix (the collapsed test row from the same-day verification import) --
-- deleted here since it is not a real standalone record, just re-imported after this migration
-- to get all 7 real rows correctly.

SET @tbl := 'gs1_approval_audit_raw';
SET @col := 'gtin';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN gtin VARCHAR(20) NULL AFTER company_name'),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @old_idx := 'uq_gs1_approval_audit';
SET @sql := (SELECT IF(COUNT(*) > 0,
  CONCAT('ALTER TABLE `', @tbl, '` DROP INDEX `', @old_idx, '`'),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @old_idx);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @new_idx := 'uq_gs1_approval_audit_sku';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD UNIQUE KEY `', @new_idx, '` (process_id, audit_date, auditee_name, auditor_name, gtin)'),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @new_idx);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The one existing row is the collapsed 7-into-1 artifact of the pre-fix key; not a real
-- standalone record, and the same verification pass re-imports the real file correctly right
-- after this migration.
DELETE FROM gs1_approval_audit_raw WHERE gtin IS NULL;
