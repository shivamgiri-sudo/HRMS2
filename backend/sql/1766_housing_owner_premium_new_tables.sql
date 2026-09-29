-- Creates 6 brand-new db_masmis tables for Housing Owner and Housing
-- Premium, per explicit user request -- deliberately separate from the
-- existing, more sophisticated Housing Dashboards feature (mas_hrms
-- housing_owner_sale_raw etc., and db_masmis's own CR_housing_owner/
-- CR_housing_premium CDR tables), which the user confirmed after being
-- shown the overlap.
--
-- REVISED 2026-09-15 after the user supplied real reference files
-- (C:\Users\MAS60358\Desktop\Housing Premium\*.xlsx). The first version of
-- this migration guessed at CDR and Agent Details shapes with no sample to
-- check against (see aw-mandate-bulk.service.ts's own caveat about that
-- pattern) -- the real files turned out structurally different from the
-- guess in a way normalized header matching alone could not paper over:
--
--   * Owner "CDR" (Owner_Cdrapr.xlsx) is NOT per-call records at all -- it
--     is an agent-level APR-style daily aggregate (Average Calls/Day, Call
--     Handling Rate, Available/Break/In-Call Duration, no call_id column
--     anywhere). The original owner_cdr design (call_id, disposition,
--     duration-per-call) could never have matched.
--   * Premium CDR (Premium_CDR.xlsx) genuinely is per-call, but with a
--     different real column set (CALLER/MEMBER/Routing Numbers/etc, no
--     call_id -- CALLER is the row identity) than the generic guess.
--   * Both Agent Details files use REAL company-specific schemas, not a
--     shared generic roster shape -- Owner has CRMID/Bucket/Ageing/MAS/
--     MonthlyTarget/PerDayTarget: Premium has a different Emp ID/Tenure/
--     Achievement/Ach% shape. Kept genuinely separate rather than forced
--     into one common table design.
--
-- owner_sale/pre_sale needed only minor changes: added month/day/am
-- columns present in the real files but missing from the first design,
-- and the Discount % header (normalizes to "discount", not "discountpct"
-- the way "Discount_Pct" does, since "%" is stripped by the normalizer)
-- is now matched explicitly in owner-sale-bulk.service.ts.
--
-- Still blocked on shivam_user's missing CREATE privilege on db_masmis
-- (confirmed live via ER_TABLEACCESS_DENIED_ERROR) -- this file has not
-- self-applied and needs a manual run or a grant, same as before.

CREATE TABLE IF NOT EXISTS db_masmis.owner_sale (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  opp_id VARCHAR(100) NULL,
  report_date VARCHAR(50) NULL,
  agent_id VARCHAR(100) NULL,
  agent_name VARCHAR(150) NULL,
  tl_name VARCHAR(150) NULL,
  value DECIMAL(12,2) NOT NULL DEFAULT 0,
  sale_count INT NOT NULL DEFAULT 1,
  payment_mode VARCHAR(100) NULL,
  package_name VARCHAR(150) NULL,
  package_type VARCHAR(100) NULL,
  discount_pct DECIMAL(6,2) NULL,
  week VARCHAR(50) NULL,
  month VARCHAR(50) NULL,
  day VARCHAR(20) NULL,
  am VARCHAR(100) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_owner_sale_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Owner_cdr: agent-level daily APR-style aggregate (Owner_Cdrapr.xlsx's own
-- real 35 columns), NOT per-call records.
CREATE TABLE IF NOT EXISTS db_masmis.Owner_cdr (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  uid VARCHAR(150) NULL,
  report_date VARCHAR(50) NULL,
  agent VARCHAR(150) NULL,
  email_id VARCHAR(150) NULL,
  intercom_id VARCHAR(100) NULL,
  group_name VARCHAR(100) NULL,
  department VARCHAR(100) NULL,
  login_based_calling VARCHAR(20) NULL,
  avg_calls_per_day VARCHAR(50) NULL,
  avg_c2c_calls_per_day_outbound_answered VARCHAR(50) NULL,
  avg_inbound_calls_per_day VARCHAR(50) NULL,
  call_handling_rate VARCHAR(50) NULL,
  total_calls VARCHAR(50) NULL,
  inbound_calls_offered VARCHAR(50) NULL,
  outbound_click_to_call_attempted VARCHAR(50) NULL,
  calls_handled VARCHAR(50) NULL,
  inbound_calls_answered VARCHAR(50) NULL,
  inbound_calls_missed VARCHAR(50) NULL,
  outbound_click_to_call_answered VARCHAR(50) NULL,
  available_duration VARCHAR(50) NULL,
  in_call_duration VARCHAR(50) NULL,
  break_duration VARCHAR(50) NULL,
  inbound_in_call_duration VARCHAR(50) NULL,
  outbound_in_call_duration VARCHAR(50) NULL,
  avg_call_handling_duration VARCHAR(50) NULL,
  avg_inbound_call_handling_duration VARCHAR(50) NULL,
  avg_outbound_call_handling_duration VARCHAR(50) NULL,
  not_connected VARCHAR(50) NULL,
  connected VARCHAR(50) NULL,
  tl_name VARCHAR(150) NULL,
  avg_talk_time VARCHAR(50) NULL,
  month VARCHAR(50) NULL,
  day VARCHAR(20) NULL,
  last_val VARCHAR(100) NULL,
  am VARCHAR(100) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_owner_cdr_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS db_masmis.owner_agent_details (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sno VARCHAR(20) NULL,
  crm_id VARCHAR(100) NULL,
  overall VARCHAR(150) NULL,
  tl_name VARCHAR(150) NULL,
  doj VARCHAR(50) NULL,
  status VARCHAR(50) NULL DEFAULT 'Active',
  ageing VARCHAR(50) NULL,
  bucket VARCHAR(100) NULL,
  monthly_target DECIMAL(15,2) NULL,
  without_gst_target DECIMAL(15,2) NULL,
  per_day_target DECIMAL(15,2) NULL,
  mtd DECIMAL(15,2) NULL,
  mas_id VARCHAR(50) NULL,
  name VARCHAR(200) NULL,
  am VARCHAR(100) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_owner_agent_details_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS db_masmis.pre_sale (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(100) NULL,
  report_date VARCHAR(50) NULL,
  created_date VARCHAR(50) NULL,
  agent_name VARCHAR(150) NULL,
  tl_name VARCHAR(150) NULL,
  partner_name VARCHAR(150) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  order_value DECIMAL(12,2) NULL,
  target DECIMAL(12,2) NULL,
  week VARCHAR(50) NULL,
  month VARCHAR(50) NULL,
  day VARCHAR(20) NULL,
  am VARCHAR(100) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pre_sale_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pre_cdr: genuinely per-call, real columns from Premium_CDR.xlsx (CALLER
-- is the row identity -- no call_id column exists in the real file).
CREATE TABLE IF NOT EXISTS db_masmis.Pre_cdr (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  caller VARCHAR(50) NULL,
  member VARCHAR(150) NULL,
  end_time VARCHAR(50) NULL,
  duration VARCHAR(50) NULL,
  status VARCHAR(100) NULL,
  routing_numbers VARCHAR(100) NULL,
  routing_status VARCHAR(100) NULL,
  talk_duration VARCHAR(50) NULL,
  ringing_duration VARCHAR(50) NULL,
  start_time VARCHAR(50) NULL,
  time_value VARCHAR(50) NULL,
  report_date VARCHAR(50) NULL,
  tl_name VARCHAR(150) NULL,
  call_count VARCHAR(50) NULL,
  unique_count VARCHAR(50) NULL,
  date_row_count VARCHAR(50) NULL,
  v_plus_w VARCHAR(50) NULL,
  talk_time VARCHAR(50) NULL,
  tl VARCHAR(150) NULL,
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pre_cdr_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS db_masmis.pre_agent_details (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  emp_id VARCHAR(50) NULL,
  agent_name VARCHAR(200) NULL,
  tl_name VARCHAR(150) NULL,
  center VARCHAR(100) NULL,
  doj VARCHAR(50) NULL,
  tenure VARCHAR(50) NULL,
  tenure_bucket VARCHAR(100) NULL,
  target DECIMAL(15,2) NULL,
  achievement DECIMAL(15,2) NULL,
  ach_pct VARCHAR(20) NULL,
  status VARCHAR(50) NULL DEFAULT 'Active',
  uploaded_by INT NULL,
  upload_batch_id VARCHAR(36) NULL,
  inserted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pre_agent_details_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
