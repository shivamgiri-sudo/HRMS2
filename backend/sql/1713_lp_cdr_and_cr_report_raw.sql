-- LP's "10. CR Reports" ("Open BPO Panel... Select Mascallnet NRGN Call
-- History... Paste into CR Reports sheet") and "11. CDR" ("Select BPO CR
-- Reports... Paste into CDR sheet") -- no exact columns given in either, no
-- DB backing exists anywhere. Columns read directly from two real samples
-- (already downloaded this session for LP Leads/APR): "Lp Regional Sale
-- Dashboard July26.xlsx" and "Lp Non Regional Dashboard July'26.xlsx",
-- sheets "CDR" and "CR Report" -- same shape, two dashboard instances, same
-- pattern as this session's LP Leads.
--
-- The CDR sheet's "Connected Time" column is corrupted at the source (its
-- own cell format is a time-only "h:mm", but the underlying value decodes
-- to nonsense years like 3163/3311 -- confirmed live against the real
-- file) -- it is deliberately NOT stored; "Disconnected Time" (plain,
-- readable "01 Jul 2026 17:43" text) is the only timestamp kept.
--
-- Row identity for lp_cdr_raw was verified live against all 1,872 real
-- Regional rows: the sheet's own "Disposition" column (despite its name,
-- holds a ticket/lead reference like "K320960293", not a connected/
-- not-connected outcome -- that outcome is in the separate "Dispo" column)
-- plus "Unique" (a per-lead call sequence number) plus the report Date is
-- unique with zero collisions; "Disposition"+"Unique" alone collides 61
-- times because the same lead can be called again on a later date.
CREATE TABLE IF NOT EXISTS lp_cdr_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  dashboard_label ENUM('REGIONAL','NON_REGIONAL') NOT NULL,
  ticket_ref VARCHAR(50) NOT NULL,
  call_seq INT NOT NULL,
  report_date DATE NOT NULL,
  agent_name VARCHAR(255) NULL,
  lead_name VARCHAR(255) NULL,
  campaign VARCHAR(50) NULL,
  branch_code VARCHAR(50) NULL,
  disconnected_at DATETIME NULL,
  call_duration_seconds INT NULL,
  feedback VARCHAR(255) NULL,
  lead_status VARCHAR(100) NULL,
  lead_sub_status VARCHAR(100) NULL,
  dispo VARCHAR(50) NULL,
  attempt_total INT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lp_cdr_raw (process_id, dashboard_label, ticket_ref, call_seq, report_date, source_reference),
  KEY idx_lp_cdr_raw_process_date (process_id, dashboard_label, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

DELETE FROM upload_template_master WHERE upload_type_code IN ('LP_CDR_REGIONAL', 'LP_CDR_NON_REGIONAL', 'LP_CR_REPORT_REGIONAL', 'LP_CR_REPORT_NON_REGIONAL');

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'LP_CDR_REGIONAL', 'LP CDR — Regional', 'lp_cdr_raw',
   'LP''s BPO CR Reports (call log) export, Regional dashboard, per its own SOP CDR sheet (no DB backing exists).',
   JSON_ARRAY('Ticket_Ref', 'Unique', 'Date'),
   JSON_ARRAY('Agent_Name', 'Client_Name', 'Campaign', 'CallNumber', 'Disconnected_Time', 'Call_Duration', 'Feedback', 'Lead_Status', 'Lead_Sub_Status', 'Dispo', 'Attempt'),
   JSON_OBJECT('Ticket_Ref', 'K320960293', 'Unique', 1, 'Date', '2026-07-01', 'Agent_Name', 'Digamber', 'Client_Name', 'Shruthi', 'Campaign', '9JEK32', 'CallNumber', 'BRCH004', 'Disconnected_Time', '01 Jul 2026 17:43', 'Call_Duration', '00:01:42', 'Feedback', 'Not picking', 'Lead_Status', 'ReSchedule', 'Lead_Sub_Status', 'Not picking', 'Dispo', 'Not Connected', 'Attempt', 5),
   1),
  (UUID(), 'LP_CDR_NON_REGIONAL', 'LP CDR — Non Regional', 'lp_cdr_raw',
   'LP''s BPO CR Reports (call log) export, Non Regional dashboard, per its own SOP CDR sheet (no DB backing exists).',
   JSON_ARRAY('Ticket_Ref', 'Unique', 'Date'),
   JSON_ARRAY('Agent_Name', 'Client_Name', 'Campaign', 'CallNumber', 'Disconnected_Time', 'Call_Duration', 'Feedback', 'Lead_Status', 'Lead_Sub_Status', 'Dispo', 'Attempt'),
   JSON_OBJECT('Ticket_Ref', 'K340960424', 'Unique', 1, 'Date', '2026-07-01', 'Agent_Name', 'Dolly', 'Client_Name', 'Akkshay mehrotra', 'Campaign', '9JEK34', 'CallNumber', 'BRCH001', 'Disconnected_Time', '01 Jul 2026 18:28', 'Call_Duration', '00:05:21', 'Feedback', 'Call Back CR dwonloading', 'Lead_Status', 'ReSchedule', 'Lead_Sub_Status', 'Call back', 'Dispo', 'Connected', 'Attempt', 1),
   1),
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
