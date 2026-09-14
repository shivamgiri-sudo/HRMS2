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

USE onfido_db;

ALTER TABLE onfido_doc_external_audit_raw
  ADD COLUMN IF NOT EXISTS manual_far_total     INT NULL COMMENT 'Total Manual FAR audits on this row — denominator for FAR%',
  ADD COLUMN IF NOT EXISTS manual_frr_total     INT NULL COMMENT 'Total Manual FRR audits on this row — denominator for FRR%',
  ADD COLUMN IF NOT EXISTS classification_total INT NULL COMMENT 'Total Classification stage audits — denominator for Classification error%',
  ADD COLUMN IF NOT EXISTS extraction_total     INT NULL COMMENT 'Total Extraction stage audits — denominator for Extraction error%',
  ADD COLUMN IF NOT EXISTS add_extraction_total INT NULL COMMENT 'Total Add-Extraction stage audits — denominator for Add-Extraction error%',
  ADD COLUMN IF NOT EXISTS raw_extraction_total INT NULL COMMENT 'Total Raw-Extraction stage audits — denominator for Raw-Extraction error%';
