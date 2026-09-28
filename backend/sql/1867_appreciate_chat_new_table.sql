-- Creates appreciate_chat in mas_hrms (not db_masmis -- shivam_user lacks
-- CREATE on db_masmis; moved here so the migration runner can apply it without
-- a higher-privileged account). The aw-chat-bulk service was updated to match.
-- 25 columns from the user-supplied AW Chat export header row (see original
-- commit for the full column list). Dates and durations stored as text; the
-- dashboard layer parses them.

CREATE TABLE IF NOT EXISTS appreciate_chat (
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
