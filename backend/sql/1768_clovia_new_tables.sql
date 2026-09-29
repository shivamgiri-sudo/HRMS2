-- Creates 9 brand-new db_masmis tables for Clovia, per explicit user
-- request. Columns confirmed directly against the 9 real files the user
-- supplied (C:\Users\MAS60358\Desktop\Clovia\*.xlsx) -- not guessed.
--
-- 6 of these 9 upload types (cl_chat, cl_dispo, cl_email_raw, cl_feedback,
-- cl_quality, cl_rechurn_call) already have a working, different Clovia
-- upload feature in this codebase writing into mas_hrms tables
-- (clovia-chat-daily-bulk.service.ts etc, see sql/1703/1704/1705/1717/
-- 1721/1722/1723) -- kept deliberately separate here per the same explicit
-- user confirmation already given for the Housing Owner/Premium overlap.
-- cl_apr, cl_ib_cdr and cl_outbound have no existing Clovia equivalent.
--
-- Per explicit user instruction this file is NOT being applied by this
-- session -- the user is running it themselves (same reason as
-- sql/1766: this app's db_masmis user has no CREATE privilege, confirmed
-- live via ER_TABLEACCESS_DENIED_ERROR on the Housing Owner/Premium
-- tables).

-- Clovia's APR export (cl_apr.xlsx, 34 real columns). Not a
-- duplicate of the existing clovia-*-bulk.service.ts family (email/chat/
-- disposition/team-alignment/feedback/quality-audit/rechurn-calls) -- APR
-- has no existing Clovia equivalent in this codebase, confirmed by search.
CREATE TABLE IF NOT EXISTS db_masmis.cl_apr (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  unique_id VARCHAR(150) NULL,
  report_date VARCHAR(50) NULL,
  user_name VARCHAR(150) NULL,
  mas_id VARCHAR(50) NULL,
  no_of_calls VARCHAR(20) NULL,
  login_time VARCHAR(50) NULL,
  parks VARCHAR(20) NULL,
  park_time VARCHAR(50) NULL,
  avg_park VARCHAR(50) NULL,
  parks_per_call VARCHAR(20) NULL,
  wait_time VARCHAR(50) NULL,
  talk_time VARCHAR(50) NULL,
  dispo_time VARCHAR(50) NULL,
  pause_time VARCHAR(50) NULL,
  bio VARCHAR(50) NULL,
  lunch VARCHAR(50) NULL,
  outcal VARCHAR(50) NULL,
  qualit VARCHAR(50) NULL,
  short_aux VARCHAR(50) NULL,
  traini VARCHAR(50) NULL,
  acht VARCHAR(50) NULL,
  team_briefing_aux VARCHAR(50) NULL,
  total_break VARCHAR(50) NULL,
  actual_login_hrs VARCHAR(50) NULL,
  downtime VARCHAR(50) NULL,
  net_login_hrs_dn VARCHAR(50) NULL,
  utilization VARCHAR(20) NULL,
  attendance VARCHAR(20) NULL,
  week_1 VARCHAR(50) NULL,
  lob VARCHAR(100) NULL,
  chat_count VARCHAR(20) NULL,
  email_count VARCHAR(20) NULL,
  total_calls VARCHAR(20) NULL,
  csat VARCHAR(20) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cl_apr_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clovia's Chat transcript export (cl_chat.xlsx, 31 real columns).
-- "Chat" holds the full raw transcript (TEXT) -- confirmed a real sample
-- runs to several KB of timestamped agent/customer/bot lines.
CREATE TABLE IF NOT EXISTS db_masmis.cl_chat (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  report_date VARCHAR(50) NULL,
  uid VARCHAR(50) NULL,
  chat_id VARCHAR(100) NULL,
  phone_number VARCHAR(50) NULL,
  chat_transcript TEXT NULL,
  username VARCHAR(150) NULL,
  name VARCHAR(150) NULL,
  surname VARCHAR(150) NULL,
  channel VARCHAR(50) NULL,
  dept VARCHAR(100) NULL,
  chat_flow VARCHAR(100) NULL,
  date_time VARCHAR(50) NULL,
  chat_duration VARCHAR(50) NULL,
  accepted_time VARCHAR(50) NULL,
  wait_time VARCHAR(50) NULL,
  star_rating_value VARCHAR(20) NULL,
  issue_solved VARCHAR(50) NULL,
  total_chat VARCHAR(20) NULL,
  web VARCHAR(20) NULL,
  wp VARCHAR(20) NULL,
  rating_received VARCHAR(20) NULL,
  response_rcv VARCHAR(20) NULL,
  issue_resolved_yes VARCHAR(20) NULL,
  issue_resolved_no VARCHAR(20) NULL,
  actual_agent_on_chat VARCHAR(20) NULL,
  tl_name VARCHAR(150) NULL,
  week VARCHAR(50) NULL,
  mas_id VARCHAR(50) NULL,
  user_name VARCHAR(150) NULL,
  hours VARCHAR(50) NULL,
  min_slot_15 VARCHAR(50) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cl_chat_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clovia's CRM disposition export (cl_dispo.xlsx, 26 real
-- columns). Distinct table from the existing clovia_crm_disposition
-- (mas_hrms, clovia-crm-disposition-bulk.service.ts) per explicit user
-- confirmation of the Housing Owner/Premium precedent -- deliberately
-- separate, not a migration of that feature.
CREATE TABLE IF NOT EXISTS db_masmis.cl_dispo (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_no VARCHAR(100) NULL,
  report_date VARCHAR(50) NULL,
  order_no VARCHAR(100) NULL,
  agent_name VARCHAR(150) NULL,
  source_val VARCHAR(50) NULL,
  gender VARCHAR(20) NULL,
  conduct_of_customer VARCHAR(50) NULL,
  reason VARCHAR(150) NULL,
  sub_reason VARCHAR(150) NULL,
  comment TEXT NULL,
  action_taken VARCHAR(100) NULL,
  user_state VARCHAR(50) NULL,
  skill VARCHAR(50) NULL,
  flag VARCHAR(50) NULL,
  awb_number VARCHAR(100) NULL,
  order_status VARCHAR(100) NULL,
  courier_partner VARCHAR(100) NULL,
  actual_date VARCHAR(50) NULL,
  count_of_order VARCHAR(20) NULL,
  repeat_ftr VARCHAR(20) NULL,
  ftr VARCHAR(20) NULL,
  emp_name VARCHAR(150) NULL,
  campaign VARCHAR(100) NULL,
  weeks VARCHAR(50) NULL,
  con VARCHAR(50) NULL,
  qrc VARCHAR(50) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cl_dispo_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clovia's Email raw export (cl_email_raw.xlsx, 12 real
-- columns). Distinct table from the existing clovia_email_daily_actual
-- (mas_hrms) per the same Housing Owner/Premium precedent.
CREATE TABLE IF NOT EXISTS db_masmis.cl_email_raw (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  unique_id VARCHAR(100) NULL,
  emp_id VARCHAR(50) NULL,
  week VARCHAR(50) NULL,
  report_date VARCHAR(50) NULL,
  agent_name VARCHAR(150) NULL,
  open_email VARCHAR(20) NULL,
  in_process VARCHAR(20) NULL,
  re_open VARCHAR(20) NULL,
  total_mail_assigned VARCHAR(20) NULL,
  total_touched_email VARCHAR(20) NULL,
  closed_email VARCHAR(20) NULL,
  junk_mail VARCHAR(20) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cl_email_raw_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clovia's Feedback (IVR CSAT) export (cl_feedback.xlsx, 8 real
-- columns). Distinct table from the existing clovia_feedback_raw
-- (mas_hrms) per the same Housing Owner/Premium precedent.
CREATE TABLE IF NOT EXISTS db_masmis.cl_feedback (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  unique_id VARCHAR(150) NULL,
  report_date VARCHAR(50) NULL,
  advisor_id VARCHAR(50) NULL,
  phone_number VARCHAR(50) NULL,
  language VARCHAR(50) NULL,
  option_val VARCHAR(100) NULL,
  call_date VARCHAR(50) NULL,
  csat_dsat VARCHAR(20) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cl_feedback_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clovia's Inbound CDR export (cl_ib_cdr.xlsx, 29 real columns).
-- No existing Clovia equivalent in this codebase. The real file has "Count"
-- TWICE (positions 20 and 28) -- SheetJS's sheet_to_json dedupes the second
-- occurrence to "Count_1" (confirmed live earlier this session against this
-- project's installed xlsx@0.18.5, same pattern as GNC Sale Raw's LOB/LOB_1),
-- so count_2 aliases "Count_1", not "Count" again.
CREATE TABLE IF NOT EXISTS db_masmis.cl_ib_cdr (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  call_date VARCHAR(50) NULL,
  time_val VARCHAR(50) NULL,
  call_time VARCHAR(50) NULL,
  agent_id VARCHAR(50) NULL,
  name VARCHAR(150) NULL,
  call_type VARCHAR(50) NULL,
  camp_name VARCHAR(100) NULL,
  phone_number VARCHAR(50) NULL,
  disposition VARCHAR(50) NULL,
  disconn_by VARCHAR(50) NULL,
  call_duration VARCHAR(50) NULL,
  queue_duration VARCHAR(50) NULL,
  hold_time VARCHAR(50) NULL,
  acw_duration VARCHAR(50) NULL,
  hours_slot VARCHAR(50) NULL,
  total_handled_time VARCHAR(50) NULL,
  call_20_sec_sl VARCHAR(20) NULL,
  end_time VARCHAR(50) NULL,
  status VARCHAR(50) NULL,
  count_val VARCHAR(20) NULL,
  unique_repeat VARCHAR(20) NULL,
  call_10_sec_sl VARCHAR(20) NULL,
  abn VARCHAR(20) NULL,
  short_calls VARCHAR(20) NULL,
  slot_time VARCHAR(50) NULL,
  count1 VARCHAR(20) NULL,
  min_slot_15 VARCHAR(50) NULL,
  count_2 VARCHAR(20) NULL,
  u_r VARCHAR(20) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cl_ib_cdr_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clovia's Outbound call export (cl_outbound.xlsx, 14 real
-- columns). No existing Clovia equivalent in this codebase.
CREATE TABLE IF NOT EXISTS db_masmis.cl_outbound (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agent VARCHAR(50) NULL,
  phone_number VARCHAR(50) NULL,
  call_date VARCHAR(50) NULL,
  call_code VARCHAR(20) NULL,
  start_time VARCHAR(50) NULL,
  end_time VARCHAR(50) NULL,
  length_sec VARCHAR(20) NULL,
  length_min VARCHAR(20) NULL,
  campaign VARCHAR(100) NULL,
  reason VARCHAR(150) NULL,
  status VARCHAR(50) NULL,
  uan VARCHAR(100) NULL,
  count_val VARCHAR(20) NULL,
  u_r VARCHAR(20) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cl_outbound_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clovia's Quality Audit export (cl_quality.xlsx, 23 real
-- columns). Distinct table from the existing clovia_quality_audit_raw
-- (mas_hrms) per the same Housing Owner/Premium precedent. "Emp ID" in the
-- real file has trailing spaces in its header text -- harmless, the
-- normalizer strips all whitespace anyway.
CREATE TABLE IF NOT EXISTS db_masmis.cl_quality (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  unique_id VARCHAR(150) NULL,
  chat_mail_date VARCHAR(50) NULL,
  audit_date VARCHAR(50) NULL,
  chat_id VARCHAR(100) NULL,
  emp_id VARCHAR(50) NULL,
  emp_name VARCHAR(150) NULL,
  tl VARCHAR(150) NULL,
  chat_source VARCHAR(50) NULL,
  cx_query VARCHAR(150) NULL,
  frt_shared_within_timeline VARCHAR(20) NULL,
  correct_information_shared VARCHAR(20) NULL,
  soft_skills_followed_on_chat VARCHAR(20) NULL,
  reminder_shared_to_cx VARCHAR(20) NULL,
  cx_concern_resolved VARCHAR(20) NULL,
  tagging_mail_shared VARCHAR(20) NULL,
  aoi_if_any VARCHAR(255) NULL,
  lob VARCHAR(100) NULL,
  week VARCHAR(50) NULL,
  count_val VARCHAR(20) NULL,
  cq_score VARCHAR(20) NULL,
  fatal VARCHAR(20) NULL,
  acpt VARCHAR(100) NULL,
  acpt_reason VARCHAR(255) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cl_quality_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clovia's Rechurn Call export (cl_rechurn_call.xlsx, 6 real
-- columns). Distinct table from the existing clovia_rechurn_calls_raw
-- (mas_hrms) per the same Housing Owner/Premium precedent.
CREATE TABLE IF NOT EXISTS db_masmis.cl_rechurn_call (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agent VARCHAR(50) NULL,
  phone_number VARCHAR(50) NULL,
  call_date VARCHAR(50) NULL,
  abandoned_date VARCHAR(50) NULL,
  status VARCHAR(50) NULL,
  report_date VARCHAR(50) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cl_rechurn_call_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

