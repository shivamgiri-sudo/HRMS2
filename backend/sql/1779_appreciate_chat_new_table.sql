-- Creates 1 brand-new db_masmis table for a new Appreciate Wealth uploader:
-- Appreciate Chat (appreciate_chat), per explicit user request. Columns follow
-- the header row of the sample the user supplied (25 columns: Date, Member
-- Assigned At, Resolution Time, Conversation id, First Response Time Chrs,
-- Initiated At, Assigned Agent name, Conversation status, User properties
-- Name / Email / Phone number, Issue Re-opened, Response due type, Status,
-- Interaction Time, Issue Resolved, Label category, Label subcategory,
-- Resolved At, Csat Score, CSAT received by, C-SAT, Handle/not handle,
-- FRT in sec, FRT In time) -- not guessed.
-- Every source column is stored as text exactly as exported (dates such as
-- "1-Sep-26" / "9/1/2026 9:12" and durations such as "10m 19s" / "0:00:36"
-- are mixed formats); the dashboard layer parses them, as it does for the
-- other aw_* tables. No existing appreciate_chat or equivalent table exists.
--
-- This app's db_masmis user has no CREATE privilege -- NOT applied by this
-- session; it must be run by a higher-privileged account.

CREATE TABLE IF NOT EXISTS db_masmis.appreciate_chat (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  report_date VARCHAR(50) NULL,
  member_assigned_at VARCHAR(50) NULL,
  resolution_time VARCHAR(30) NULL,
  conversation_id VARCHAR(60) NULL,
  first_response_time VARCHAR(30) NULL,
  initiated_at VARCHAR(50) NULL,
  assigned_agent_name VARCHAR(150) NULL,
  conversation_status VARCHAR(50) NULL,
  user_name VARCHAR(200) NULL,
  user_email VARCHAR(200) NULL,
  user_phone_number VARCHAR(50) NULL,
  issue_reopened VARCHAR(10) NULL,
  response_due_type VARCHAR(50) NULL,
  status VARCHAR(50) NULL,
  interaction_time VARCHAR(30) NULL,
  issue_resolved VARCHAR(10) NULL,
  label_category VARCHAR(150) NULL,
  label_subcategory VARCHAR(150) NULL,
  resolved_at VARCHAR(50) NULL,
  csat_score VARCHAR(20) NULL,
  csat_received_by VARCHAR(150) NULL,
  c_sat VARCHAR(50) NULL,
  handle_status VARCHAR(50) NULL,
  frt_in_sec VARCHAR(20) NULL,
  frt_in_time VARCHAR(20) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_appreciate_chat_batch (upload_batch_id),
  KEY idx_appreciate_chat_conv (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
