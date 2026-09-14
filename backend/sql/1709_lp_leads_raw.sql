-- LP's "9. Leads" (per its own SOP: "Open BPO Panel... Select BPO Leads (M)...
-- Download each Excel sheet one by one... Paste into Leads sheet" -- no exact
-- columns given, no DB backing exists anywhere). Columns read directly from
-- two real samples (downloaded via the user's own authenticated Drive
-- session): "Lp Regional Sale Dashboard July26.xlsx" (BPO Name =
-- MASCALLNET BPO) and "Lp Non Regional Dashboard July'26.xlsx" (BPO Name =
-- MASCALLNET NRGN), both sheet "Leads" -- the same shape, two dashboard
-- instances, same as this session's Molecular/Reginald Men Email pattern.
-- Both anchor to the "Lawyer Panel" process (the only "LP" process that
-- exists), same anchor already used for LP WebConsole APR (sql/1701) despite
-- that process being active_status=0 -- a business-decision gap, not a
-- storage blocker.
--
-- Row identity verified live against the real Regional sample: (name, phone,
-- campaign, allocated_on) was unique across all 1,072 real rows -- phone and
-- email arrive pre-masked in the source sheet itself (e.g. "******1068"),
-- so no additional redaction is applied here.
CREATE TABLE IF NOT EXISTS lp_leads_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  dashboard_label ENUM('REGIONAL','NON_REGIONAL') NOT NULL,
  lead_name VARCHAR(255) NOT NULL,
  phone_masked VARCHAR(50) NOT NULL,
  email_masked VARCHAR(255) NULL,
  campaign VARCHAR(50) NULL,
  city VARCHAR(100) NULL,
  card_range VARCHAR(100) NULL,
  pl_amount DECIMAL(12,2) NULL,
  unsecured_loan_amount DECIMAL(12,2) NULL,
  income_band VARCHAR(150) NULL,
  lead_date DATE NULL,
  status VARCHAR(100) NULL,
  sub_status VARCHAR(100) NULL,
  lead_by VARCHAR(255) NULL,
  allocated_on DATE NULL,
  harassment_note VARCHAR(255) NULL,
  last_amount DECIMAL(12,2) NULL,
  bpo_name VARCHAR(100) NULL,
  attempt INT NULL,
  disposition VARCHAR(100) NULL,
  sub_disposition VARCHAR(100) NULL,
  cr_download VARCHAR(50) NULL,
  token_amount VARCHAR(100) NULL,
  ls_amount VARCHAR(100) NULL,
  followup VARCHAR(50) NULL,
  report_date DATE NOT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lp_leads_raw (process_id, dashboard_label, lead_name, phone_masked, campaign, allocated_on, source_reference),
  KEY idx_lp_leads_raw_process_date (process_id, dashboard_label, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code IN ('LP_LEADS_REGIONAL', 'LP_LEADS_NON_REGIONAL');

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'LP_LEADS_REGIONAL', 'LP Leads — Regional', 'lp_leads_raw',
   'LP''s BPO Leads (M) export, Regional dashboard, per its own SOP Leads sheet (no DB backing exists).',
   JSON_ARRAY('Name', 'Phone', 'Campaign', 'AllocatedOn', 'Date'),
   JSON_ARRAY('Email', 'city', 'Card', 'PL', 'Income', 'Status', 'SubStatus', 'Lead By', 'Harassment', 'Bpo Name', 'Attempt', 'Disposition', 'Sub Disposition', 'CR Download', 'token amount', 'LS Amount', 'Followup'),
   JSON_OBJECT('Name', 'Selva Selvarayar', 'Phone', '******1068', 'Campaign', '9JEK32', 'Card', 'Rs.5-10 lacs', 'PL', 650000, 'Income', 'Rs.80,000 - 100,000 per month', 'Date', '01 Jul 2026', 'Status', 'ReSchedule', 'SubStatus', 'Call back', 'Lead By', 'KAVIYASH RAJ', 'AllocatedOn', '01 Jul 2026', 'Bpo Name', 'MASCALLNET BPO', 'Attempt', 1, 'Disposition', 'Connected'),
   1),
  (UUID(), 'LP_LEADS_NON_REGIONAL', 'LP Leads — Non Regional', 'lp_leads_raw',
   'LP''s BPO Leads (M) export, Non Regional dashboard, per its own SOP Leads sheet (no DB backing exists).',
   JSON_ARRAY('Name', 'Phone', 'Campaign', 'AllocatedOn', 'Date'),
   JSON_ARRAY('Email', 'city', 'Card', 'PL', 'Income', 'Status', 'SubStatus', 'Lead By', 'Harassment', 'Bpo Name', 'Attempt', 'Disposition', 'Sub Disposition', 'CR Download', 'token amount', 'LS Amount', 'Followup'),
   JSON_OBJECT('Name', 'Akkshay mehrotra', 'Phone', '******7370', 'Campaign', '9JEK34', 'Card', 'No credit card dues', 'PL', 450000, 'Income', 'Rs.20,000 - 40,000 per month', 'Date', '01 Jul 2026', 'Status', 'ReSchedule', 'SubStatus', 'Call back', 'Lead By', 'Dolly', 'AllocatedOn', '01 Jul 2026', 'Bpo Name', 'MASCALLNET NRGN', 'Attempt', 1, 'Disposition', 'Connected'),
   1);
