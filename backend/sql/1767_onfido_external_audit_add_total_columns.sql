-- Migration 1767: Add denominator columns to onfido_doc_external_audit_raw
--
-- The source "External Audit Dashboard" file carries these six aggregate columns per row:
--   "Manual FAR"     — total Manual FAR audits on that row (denominator for FAR%)
--   "Manual FRR"     — total Manual FRR audits on that row (denominator for FRR%)
--   "Classification" — total Classification stage audits
--   "Extraction"     — total Extraction stage audits
--   "Add. Extraction"— total Add-Extraction stage audits
--   "Raw. Extraction"— total Raw-Extraction stage audits
--
-- Previously only the error-flag ("*.Yes") columns were extracted, causing all
-- rate calculations (FAR%, FRR%, classification error%, extraction error%) to use
-- COUNT(*) as denominator — inflating it to total rows instead of total audits of
-- that type, understating the error rates when not every row covers every stage.
--
-- The corrected formula per the reference dashboard:
--   Ext Manual FAR% = SUM(manual_far_flag) / SUM(manual_far_total)
--   Ext Manual FRR% = SUM(manual_frr_flag) / SUM(manual_frr_total)
--   Classification%  = SUM(classification_flag) / SUM(classification_total)
--   Extraction%      = SUM(extraction_flag)      / SUM(extraction_total)
--
-- Existing rows receive NULL (no historical re-upload needed; the service already
-- returns null/no_data when denominator is 0). New uploads post-migration populate
-- these columns via the updated onfido-report-configs.ts extract map.
--
-- NOTE: ADD COLUMN IF NOT EXISTS is MariaDB-only syntax rejected by MySQL 8.0.
-- Each column is guarded individually via INFORMATION_SCHEMA.COLUMNS check.

SET @db  = 'onfido_db';
SET @tbl = 'onfido_doc_external_audit_raw';

SET @sql = (SELECT IF(COUNT(*)=0,
  CONCAT('ALTER TABLE `',@db,'`.`',@tbl,'` ADD COLUMN manual_far_total INT NULL COMMENT ''Total Manual FAR audits on this row — denominator for FAR%'''),
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME=@tbl AND COLUMN_NAME='manual_far_total');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(COUNT(*)=0,
  CONCAT('ALTER TABLE `',@db,'`.`',@tbl,'` ADD COLUMN manual_frr_total INT NULL COMMENT ''Total Manual FRR audits on this row — denominator for FRR%'''),
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME=@tbl AND COLUMN_NAME='manual_frr_total');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(COUNT(*)=0,
  CONCAT('ALTER TABLE `',@db,'`.`',@tbl,'` ADD COLUMN classification_total INT NULL COMMENT ''Total Classification stage audits — denominator for Classification error%'''),
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME=@tbl AND COLUMN_NAME='classification_total');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(COUNT(*)=0,
  CONCAT('ALTER TABLE `',@db,'`.`',@tbl,'` ADD COLUMN extraction_total INT NULL COMMENT ''Total Extraction stage audits — denominator for Extraction error%'''),
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME=@tbl AND COLUMN_NAME='extraction_total');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(COUNT(*)=0,
  CONCAT('ALTER TABLE `',@db,'`.`',@tbl,'` ADD COLUMN add_extraction_total INT NULL COMMENT ''Total Add-Extraction stage audits — denominator for Add-Extraction error%'''),
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME=@tbl AND COLUMN_NAME='add_extraction_total');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(COUNT(*)=0,
  CONCAT('ALTER TABLE `',@db,'`.`',@tbl,'` ADD COLUMN raw_extraction_total INT NULL COMMENT ''Total Raw-Extraction stage audits — denominator for Raw-Extraction error%'''),
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME=@tbl AND COLUMN_NAME='raw_extraction_total');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
