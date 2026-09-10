-- Housing Premium's "Sales + CDR Performance Dashboard" -- per the user's
-- own real prompt (email from Tausif Ansari, "Inbound full code for all
-- inbound process", 2026-09-10, attachment "# HOUSING PREMIUM.txt"): a
-- dedicated flexible-mapping dashboard app with two independent raw
-- uploaders, separate from the existing housing_premium_sale_raw
-- (sql/1706, built earlier this session from the same real MIS workbook's
-- own "Sale Raw" sheet) -- kept distinct for the same reason as sql/1749.
CREATE TABLE IF NOT EXISTS housing_premium_dashboard_sale_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  upload_batch_id CHAR(36) NOT NULL,
  order_id VARCHAR(100) NULL,
  coupon_code VARCHAR(100) NULL,
  amount DECIMAL(12,2) NULL,
  created_at_source DATETIME NULL,
  report_date DATE NULL,
  partner_name VARCHAR(255) NULL,
  agent_name VARCHAR(255) NULL,
  agent_name_norm VARCHAR(255) NULL,
  tl_name VARCHAR(255) NULL,
  assigned_tl VARCHAR(255) NULL,
  source_time VARCHAR(20) NULL,
  hour_of_day TINYINT NULL,
  order_value DECIMAL(12,2) NULL,
  target DECIMAL(12,2) NULL,
  slot VARCHAR(50) NULL,
  sale_count INT NULL,
  week_label VARCHAR(20) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_hp_dash_sale_batch (upload_batch_id),
  KEY idx_hp_dash_sale_process_date (process_id, report_date),
  KEY idx_hp_dash_sale_agent (process_id, agent_name_norm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS housing_premium_dashboard_cdr_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  upload_batch_id CHAR(36) NOT NULL,
  caller VARCHAR(50) NULL,
  member VARCHAR(255) NULL,
  member_norm VARCHAR(255) NULL,
  report_date DATE NULL,
  source_time VARCHAR(20) NULL,
  end_time DATETIME NULL,
  duration_seconds INT NULL,
  status VARCHAR(100) NULL,
  status_normalized ENUM('Answered','Not Answered','Other') NOT NULL DEFAULT 'Other',
  routing_numbers VARCHAR(50) NULL,
  routing_status VARCHAR(50) NULL,
  talk_duration_seconds INT NULL,
  ringing_duration_seconds INT NULL,
  tl_name VARCHAR(255) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_hp_dash_cdr_batch (upload_batch_id),
  KEY idx_hp_dash_cdr_process_date (process_id, report_date),
  KEY idx_hp_dash_cdr_member (process_id, member_norm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
