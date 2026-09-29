-- Creates 4 brand-new db_masmis tables for two new processes: LP
-- Feedback (lp_feedback_apr, lp_feedback_cdr) and LP Onboarding
-- (lp_onboarding_apr, lp_onboarding_cdr), per explicit user request.
-- Columns confirmed directly against the real files the user supplied
-- (C:\Users\MAS60358\Desktop\Clovia\LP Feedback APR.xlsx, LP Feedback
-- CDR.xlsx, LP Onboarding APR.xlsx, LP Onboarding CDR.xlsx) -- not
-- guessed. LP Feedback and LP Onboarding's APR files are structurally
-- identical to each other (same headers, same sample data), and likewise
-- for their CDR files -- but each process still gets its own physically
-- separate table, per this codebase's established convention (Housing
-- Owner/Premium, Clovia) of never sharing a table across processes even
-- when the schema matches.
--
-- This app's db_masmis user has no CREATE privilege (confirmed live,
-- same as sql/1766/1768/1770) -- NOT applied by this session; the user
-- is running it themselves.

-- lp_feedback_apr: LP Feedback APR.xlsx
CREATE TABLE IF NOT EXISTS db_masmis.lp_feedback_apr (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  report_date VARCHAR(50) NULL,
  interval_val VARCHAR(50) NULL,
  agent VARCHAR(150) NULL,
  login_id VARCHAR(100) NULL,
  total_calls VARCHAR(20) NULL,
  dialer_calls VARCHAR(20) NULL,
  outbound_calls VARCHAR(20) NULL,
  manual_calls VARCHAR(20) NULL,
  transfered_calls VARCHAR(20) NULL,
  login_time VARCHAR(50) NULL,
  net_login_time VARCHAR(50) NULL,
  break_count VARCHAR(20) NULL,
  tea VARCHAR(50) NULL,
  lunch VARCHAR(50) NULL,
  meeting VARCHAR(50) NULL,
  bio_break VARCHAR(50) NULL,
  unsolicited VARCHAR(50) NULL,
  total_break_duration VARCHAR(50) NULL,
  handle_duration VARCHAR(50) NULL,
  avg_handle_duration VARCHAR(50) NULL,
  idle_duration VARCHAR(50) NULL,
  avg_idle_duration VARCHAR(50) NULL,
  idle_block_duration VARCHAR(50) NULL,
  ring_duration VARCHAR(50) NULL,
  avg_ring_duration VARCHAR(50) NULL,
  talk_duration VARCHAR(50) NULL,
  avg_talk_duration VARCHAR(50) NULL,
  hold_duration VARCHAR(50) NULL,
  avg_hold_duration VARCHAR(50) NULL,
  wrapup_duration VARCHAR(50) NULL,
  avg_wrapup_duration VARCHAR(50) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lp_feedback_apr_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- lp_feedback_cdr: LP Feedback CDR.xlsx
CREATE TABLE IF NOT EXISTS db_masmis.lp_feedback_cdr (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  s_no VARCHAR(20) NULL,
  report_date VARCHAR(50) NULL,
  interval_val VARCHAR(50) NULL,
  call_number VARCHAR(100) NULL,
  service VARCHAR(100) NULL,
  agent VARCHAR(150) NULL,
  login_id VARCHAR(100) NULL,
  start_time VARCHAR(50) NULL,
  end_time VARCHAR(50) NULL,
  extension VARCHAR(50) NULL,
  remarks VARCHAR(500) NULL,
  dni VARCHAR(50) NULL,
  cli VARCHAR(50) NULL,
  disposition VARCHAR(200) NULL,
  lead_id VARCHAR(50) NULL,
  batch VARCHAR(100) NULL,
  dialer_type VARCHAR(50) NULL,
  duration VARCHAR(50) NULL,
  ivr_duration VARCHAR(50) NULL,
  ring_duration VARCHAR(50) NULL,
  talk_duration VARCHAR(50) NULL,
  wrapup_duration VARCHAR(50) NULL,
  hold_duration VARCHAR(50) NULL,
  call_status VARCHAR(50) NULL,
  hangup_by VARCHAR(100) NULL,
  child_call_number VARCHAR(100) NULL,
  ivr_terminal VARCHAR(50) NULL,
  unique_flag VARCHAR(20) NULL,
  disposition_status VARCHAR(100) NULL,
  attempt VARCHAR(20) NULL,
  service_2 VARCHAR(100) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lp_feedback_cdr_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- lp_onboarding_apr: LP Onboarding APR.xlsx
CREATE TABLE IF NOT EXISTS db_masmis.lp_onboarding_apr (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  report_date VARCHAR(50) NULL,
  interval_val VARCHAR(50) NULL,
  agent VARCHAR(150) NULL,
  login_id VARCHAR(100) NULL,
  total_calls VARCHAR(20) NULL,
  dialer_calls VARCHAR(20) NULL,
  outbound_calls VARCHAR(20) NULL,
  manual_calls VARCHAR(20) NULL,
  transfered_calls VARCHAR(20) NULL,
  login_time VARCHAR(50) NULL,
  net_login_time VARCHAR(50) NULL,
  break_count VARCHAR(20) NULL,
  tea VARCHAR(50) NULL,
  lunch VARCHAR(50) NULL,
  meeting VARCHAR(50) NULL,
  bio_break VARCHAR(50) NULL,
  unsolicited VARCHAR(50) NULL,
  total_break_duration VARCHAR(50) NULL,
  handle_duration VARCHAR(50) NULL,
  avg_handle_duration VARCHAR(50) NULL,
  idle_duration VARCHAR(50) NULL,
  avg_idle_duration VARCHAR(50) NULL,
  idle_block_duration VARCHAR(50) NULL,
  ring_duration VARCHAR(50) NULL,
  avg_ring_duration VARCHAR(50) NULL,
  talk_duration VARCHAR(50) NULL,
  avg_talk_duration VARCHAR(50) NULL,
  hold_duration VARCHAR(50) NULL,
  avg_hold_duration VARCHAR(50) NULL,
  wrapup_duration VARCHAR(50) NULL,
  avg_wrapup_duration VARCHAR(50) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lp_onboarding_apr_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- lp_onboarding_cdr: LP Onboarding CDR.xlsx
CREATE TABLE IF NOT EXISTS db_masmis.lp_onboarding_cdr (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  s_no VARCHAR(20) NULL,
  report_date VARCHAR(50) NULL,
  interval_val VARCHAR(50) NULL,
  call_number VARCHAR(100) NULL,
  service VARCHAR(100) NULL,
  agent VARCHAR(150) NULL,
  login_id VARCHAR(100) NULL,
  start_time VARCHAR(50) NULL,
  end_time VARCHAR(50) NULL,
  extension VARCHAR(50) NULL,
  remarks VARCHAR(500) NULL,
  dni VARCHAR(50) NULL,
  cli VARCHAR(50) NULL,
  disposition VARCHAR(200) NULL,
  lead_id VARCHAR(50) NULL,
  batch VARCHAR(100) NULL,
  dialer_type VARCHAR(50) NULL,
  duration VARCHAR(50) NULL,
  ivr_duration VARCHAR(50) NULL,
  ring_duration VARCHAR(50) NULL,
  talk_duration VARCHAR(50) NULL,
  wrapup_duration VARCHAR(50) NULL,
  hold_duration VARCHAR(50) NULL,
  call_status VARCHAR(50) NULL,
  hangup_by VARCHAR(100) NULL,
  child_call_number VARCHAR(100) NULL,
  ivr_terminal VARCHAR(50) NULL,
  unique_flag VARCHAR(20) NULL,
  disposition_status VARCHAR(100) NULL,
  attempt VARCHAR(20) NULL,
  service_2 VARCHAR(100) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lp_onboarding_cdr_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
