-- Clovia's "CRM Disposition" data (per its own SOP: "Downloaded from CRM:
-- Clovia CRM", no DB backing) -- a real sample was found and read directly:
-- "Clovia_Performance_Dashboard Report Sept26 (1).xlsb", sheet
-- "CRM Disposition".
--
-- The sheet's own "Agent Name" column holds @purplepanda.in email addresses
-- (a different company's domain) -- confirmed live, this is NOT a MAS
-- employee code. "EMP Name" is the column that actually names a MAS agent by
-- display name (e.g. "Rashmi Singh"), populated on ~42% of rows (1,175 of
-- 2,809 checked) -- stored here as free text, not joined to employees, for
-- the same reason GNC_SCRIPT_AI/NEEMANS_SCRIPT_AI's agent_name columns are
-- documented as "a display name, not a MAS code": no reliable code exists in
-- this data to join on.
--
-- Scoped to the columns a KPI actually needs, not the full 26-column export:
-- ticket identity, date, agent display name, reason taxonomy, FTR/repeat
-- flags, campaign and week. Free-text/logistics columns (Comment, Action
-- Taken, AWB Number, Order Status, Courier Partner, Order No) are left out
-- deliberately -- they carry no KPI value and needlessly widen what this
-- table exposes.
CREATE TABLE IF NOT EXISTS clovia_crm_disposition (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  ticket_no VARCHAR(50) NOT NULL,
  report_date DATE NOT NULL,
  emp_name VARCHAR(255) NULL,
  reason VARCHAR(255) NULL,
  sub_reason VARCHAR(255) NULL,
  ftr_flag TINYINT(1) NULL,
  repeat_or_ftr VARCHAR(20) NULL,
  campaign VARCHAR(100) NULL,
  week_label VARCHAR(20) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clovia_crm_disposition (process_id, ticket_no, source_reference),
  KEY idx_clovia_crm_disposition_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'CLOVIA_CRM_DISPOSITION';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES
(UUID(), 'CLOVIA_CRM_DISPOSITION', 'Clovia CRM Disposition',
 'clovia_crm_disposition',
 'Per-ticket CRM disposition data for Clovia (per its SOP: "Downloaded from CRM: Clovia CRM"; no DB backing exists). EMP Name identifies the MAS agent by display name where the CRM captured it (~42% of rows); the CRM''s own "Agent Name" column is a different company''s (Purple Panda) login email and is not accepted here.',
 JSON_ARRAY('Ticket No','Date','Reason'),
 JSON_ARRAY('EMP Name','Sub Reason','FTR','Repeat/FTR','Campaign','WEEKS'),
 JSON_OBJECT(
   'Ticket No','4730982',
   'Date','2026-09-01',
   'EMP Name','Rashmi Singh',
   'Reason','refunds',
   'Sub Reason','Refund status',
   'FTR','1',
   'Repeat/FTR','FTR',
   'Campaign','3301749046266',
   'WEEKS','Week 1'
 ), 1);
