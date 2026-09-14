-- Housing Owner's own "Look up Data" sheet -- found while auditing the
-- same real workbook downloaded this session for Sale Raw/Call Logs/
-- Incentive ("Housing Owner Jul'26.xlsb"): a CRM lead/opportunity
-- pipeline log, one row per call attempt against a lead, with the lead's
-- funnel stage at that point (DISCOVERY, PRE_DISCOVERY, BUY_INITIATION,
-- PAYMENT_FAILED, PAYMENT_DONE, ORDER_CONFIRMATION). 398,363 real
-- non-blank rows, 2026-07-01 to 2026-07-28 -- by far the largest single
-- sheet found this session. Not covered by db_masmis.CR_housing_owner
-- (pure call records, no CRM stage/opportunity context) or
-- housing_owner_sale_raw (completed sales only) or anything else found
-- on this host.
--
-- Row identity: no single or small composite column is reliably unique
-- (the same caseId is called repeatedly as it moves through the funnel,
-- and callId is null on ~57% of rows -- pre-call/lead-only events, not
-- completed calls). The full row tuple is unique for 396,402 of 398,363
-- real rows (1,437 exact duplicates, the same copy-paste-export pattern
-- already seen in Clovia IB CDR); this table's identity is therefore the
-- broadest reasonably-identifying composite (case_id, report_date,
-- call_id, disposition, case_created_at), handled with ON DUPLICATE KEY
-- UPDATE like every other near-duplicate raw export this session.
--
-- Dropped as carrying no real signal: "ringTime" (100% NULL across all
-- 398,363 rows); "Created Date" (redundant with the kept, more precise
-- "createdAt"). "wrapupTime" is not a real duration despite its name --
-- it is exactly 1.0 on every one of its 210,294 non-null rows -- stored
-- here as the boolean flag it actually is, not a guessed duration.
-- "talkTime" is a genuine fraction-of-a-day duration, floored to seconds
-- per this session's standard convention.
CREATE TABLE IF NOT EXISTS housing_owner_lead_pipeline_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  case_id VARCHAR(64) NOT NULL,
  call_id VARCHAR(64) NULL,
  call_type VARCHAR(50) NULL,
  agent_id VARCHAR(50) NULL,
  agent_name VARCHAR(255) NULL,
  agent_number VARCHAR(30) NULL,
  customer_name VARCHAR(255) NULL,
  customer_phone VARCHAR(30) NULL,
  alternate_phone VARCHAR(30) NULL,
  tl_id VARCHAR(50) NULL,
  tl_name VARCHAR(255) NULL,
  opportunity_id VARCHAR(64) NULL,
  account_id VARCHAR(64) NULL,
  opportunity_stage VARCHAR(50) NULL,
  opportunity_type VARCHAR(100) NULL,
  case_created_at DATETIME NULL,
  assigned_at DATETIME NULL,
  call_start_time DATETIME NULL,
  call_end_time DATETIME NULL,
  talk_time_seconds INT NULL,
  had_wrapup TINYINT(1) NULL,
  call_status VARCHAR(30) NULL,
  disposition VARCHAR(100) NULL,
  notes TEXT NULL,
  followup_time DATETIME NULL,
  recording_url VARCHAR(500) NULL,
  is_fresh_lead TINYINT(1) NULL,
  lead_temperature VARCHAR(20) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_housing_owner_lead_pipeline (process_id, case_id, report_date, call_id, disposition, case_created_at),
  KEY idx_housing_owner_lead_pipeline_date (process_id, report_date),
  KEY idx_housing_owner_lead_pipeline_stage (opportunity_stage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'HOUSING_OWNER_LEAD_PIPELINE';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'HOUSING_OWNER_LEAD_PIPELINE', 'Housing Owner — Lead Pipeline (Look up Data)', 'housing_owner_lead_pipeline_raw',
   'Housing Owner''s own Look up Data sheet: per-call-attempt CRM lead/opportunity funnel log (no DB backing exists).',
   JSON_ARRAY('caseId', 'Date'),
   JSON_ARRAY('callId', 'callType', 'agentId', 'agentName', 'customerName', 'customerPhone', 'tlId', 'tlName',
     'opportunityId', 'accountId', 'ownerOpportunityStageName', 'opportunityType', 'createdAt', 'assignedAt',
     'callStartTime', 'callEndTime', 'talkTime', 'wrapupTime', 'callStatus', 'disposition', 'notes',
     'followupTime', 'recordingURL', 'Fresh', 'Hot Leads'),
   JSON_OBJECT('caseId', '6a451521c56fcb17e9c703a4', 'Date', '2026-07-01', 'agentName', 'Harsh bhatt MCN',
     'customerName', 'Aashu', 'ownerOpportunityStageName', 'DISCOVERY', 'disposition', 'Ringing'),
   1);
