-- Housing Owner's "Sales + CDR Performance Dashboard" -- per the user's
-- own real prompt (email from Tausif Ansari, "Inbound full code for all
-- inbound process", 2026-09-10, attachment "Housing Owner.txt"): a
-- dedicated flexible-mapping dashboard app with two independent raw
-- uploaders, separate from the existing housing_owner_sale_raw (sql/1708,
-- built earlier this session from the same process's own "Sale Raw"
-- Google Sheet SOP) -- kept distinct rather than merged, since this
-- dashboard's own contract requires tolerating column drift the SOP sheet
-- importer does not, and the two raw shapes only partially overlap.
--
-- Columns per the prompt's own field list, mapped via
-- flexible-parser.ts's alias matching (not a fixed exact-header import).
CREATE TABLE IF NOT EXISTS housing_owner_dashboard_sale_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  upload_batch_id CHAR(36) NOT NULL,
  report_date DATE NULL,
  agent_id VARCHAR(50) NULL,
  agent_name VARCHAR(255) NULL,
  agent_name_norm VARCHAR(255) NULL,
  value DECIMAL(12,2) NULL,
  sale_count INT NULL,
  payment_mode VARCHAR(100) NULL,
  package_name VARCHAR(100) NULL,
  package_type VARCHAR(100) NULL,
  opp_id VARCHAR(100) NULL,
  discount_pct DECIMAL(6,2) NULL,
  tl_name VARCHAR(255) NULL,
  week_label VARCHAR(20) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ho_dash_sale_batch (upload_batch_id),
  KEY idx_ho_dash_sale_process_date (process_id, report_date),
  KEY idx_ho_dash_sale_agent (process_id, agent_name_norm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS housing_owner_dashboard_cdr_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  upload_batch_id CHAR(36) NOT NULL,
  report_date DATE NULL,
  uid VARCHAR(255) NULL,
  agent_name VARCHAR(255) NULL,
  agent_name_norm VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  tl_name VARCHAR(255) NULL,
  am_name VARCHAR(255) NULL,
  total_calls INT NULL,
  inbound_calls_offered INT NULL,
  inbound_calls_answered INT NULL,
  inbound_calls_missed INT NULL,
  outbound_click_to_call_attempted INT NULL,
  outbound_click_to_call_answered INT NULL,
  calls_handled INT NULL,
  connected INT NULL,
  not_connected INT NULL,
  available_duration_seconds INT NULL,
  in_call_duration_seconds INT NULL,
  break_duration_seconds INT NULL,
  average_talk_time_seconds INT NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ho_dash_cdr_batch (upload_batch_id),
  KEY idx_ho_dash_cdr_process_date (process_id, report_date),
  KEY idx_ho_dash_cdr_agent (process_id, agent_name_norm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
