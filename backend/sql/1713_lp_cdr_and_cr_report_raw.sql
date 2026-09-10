-- LP's "10. CR Reports" ("Open BPO Panel... Select Mascallnet NRGN Call
-- History... Paste into CR Reports sheet") -- no exact columns given, no
-- DB backing exists anywhere. Columns read directly from two real samples
-- (already downloaded this session for LP Leads/APR): "Lp Regional Sale
-- Dashboard July26.xlsx" and "Lp Non Regional Dashboard July'26.xlsx",
-- sheet "CR Report" -- same shape, two dashboard instances, same pattern
-- as this session's LP Leads.
--
-- The sibling "11. CDR" sheet's own table (lp_cdr_raw) was RETRACTED
-- 2026-09-10: db_masmis.CR_lp_regional/CR_lp_non_regional already carry
-- this exact call-detail-record data live (same ticket/task ref, agent,
-- campaign, disconnected time, call duration, lead status/sub-status,
-- disposition) -- see runPendingMigrations.ts's retraction comment for
-- sql/1713. CR Report's own content (loan status, unsecured_loan_amount)
-- has no such overlap in any CR_lp_* table found live -- kept.
--
-- Row identity for lp_cr_report_raw verified live against all 219 real
-- Regional rows: (Name, Mobile, CreatedOn) unique with zero collisions.
-- Mobile/Email arrive pre-masked in the source (e.g. "******1068"), stored
-- as-is, same as lp_leads_raw.
CREATE TABLE IF NOT EXISTS lp_cr_report_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  dashboard_label ENUM('REGIONAL','NON_REGIONAL') NOT NULL,
  lead_name VARCHAR(255) NOT NULL,
  email_masked VARCHAR(255) NULL,
  mobile_masked VARCHAR(50) NOT NULL,
  status VARCHAR(255) NULL,
  unsecured_loan_amount DECIMAL(12,2) NULL,
  agent_name VARCHAR(255) NULL,
  created_on DATE NOT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lp_cr_report_raw (process_id, dashboard_label, lead_name, mobile_masked, created_on, source_reference),
  KEY idx_lp_cr_report_raw_process_date (process_id, dashboard_label, created_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code IN ('LP_CR_REPORT_REGIONAL', 'LP_CR_REPORT_NON_REGIONAL');

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'LP_CR_REPORT_REGIONAL', 'LP CR Report — Regional', 'lp_cr_report_raw',
   'LP''s Mascallnet NRGN Call History export, Regional dashboard, per its own SOP CR Reports sheet (no DB backing exists).',
   JSON_ARRAY('Name', 'Mobile', 'CreatedOn'),
   JSON_ARRAY('Email', 'Status', 'Unsecured_Loan', 'AgentName'),
   JSON_OBJECT('Name', 'Gunal', 'Mobile', '******1623', 'Email', 'gua******@GMAIL.COM', 'Status', 'Credit report link shared with client to download on call(Priority 1)', 'Unsecured_Loan', 256249, 'AgentName', 'G Sanjay rao', 'CreatedOn', '2026-07-01'),
   1),
  (UUID(), 'LP_CR_REPORT_NON_REGIONAL', 'LP CR Report — Non Regional', 'lp_cr_report_raw',
   'LP''s Mascallnet NRGN Call History export, Non Regional dashboard, per its own SOP CR Reports sheet (no DB backing exists).',
   JSON_ARRAY('Name', 'Mobile', 'CreatedOn'),
   JSON_ARRAY('Email', 'Status', 'Unsecured_Loan', 'AgentName'),
   JSON_OBJECT('Name', 'Akkshay mehrotra', 'Mobile', '******7370', 'Email', 'aks******@gmail.com', 'Status', 'Credit report link shared with client to download on call(Priority 1)', 'Unsecured_Loan', 818572, 'AgentName', 'Dolly', 'CreatedOn', '2026-07-01'),
   1);
