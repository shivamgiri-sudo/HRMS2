-- Migration 1932: SBI Card Collections process (code SBI_CARD) -- dialer MIS, agent MIS, account file, downtime tracker and pen
-- estimation uploads, cloned from the Dalmia pipeline (sql/1734). All tables are mas_hrms, re-upload upserts on the UNIQUE key.
--
-- Dialer MIS: one workbook sheet per campaign (EL_DEL_CD2_SBI_1_4_, ..._PTP_, ..._STAB_ ...), header on row 2. The uploader injects the
-- sheet name as the "Campaign" column. Sheets "Master" and "Overall ..." are rollups of the real campaigns: stored with is_rollup = 1
-- and excluded from every dashboard total so nothing is counted twice.
-- Account file: only the columns the dashboard needs are kept (no customer name, no employer / residence / additional phone numbers,
-- no per-call history); MOBILE_NO is stored as given and is never logged.

INSERT INTO process_master (process_code, process_name, slug, active_status)
SELECT 'SBI_CARD', 'SBI Card Collections', 'sbi-card-collections', 1
  FROM DUAL
 WHERE NOT EXISTS (
         SELECT 1 FROM process_master WHERE process_code = 'SBI_CARD' OR process_name = 'SBI Card Collections'
       );

CREATE TABLE IF NOT EXISTS sbi_card_dialer_mis (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  campaign VARCHAR(100) NOT NULL,
  is_rollup TINYINT(1) NOT NULL DEFAULT 0,
  total_accounts INT NULL,
  accounts_excluded INT NULL,
  accounts_scheduled INT NULL,
  accounts_called INT NULL,
  dials INT NULL,
  actual_dialer_dials INT NULL,
  answers INT NULL,
  connects INT NULL,
  make_calls INT NULL,
  aborts INT NULL,
  drop_calls INT NULL,
  ptp INT NULL,
  pad INT NULL,
  otp INT NULL,
  disp INT NULL,
  wn INT NULL,
  nc INT NULL,
  au INT NULL,
  voml INT NULL,
  ct INT NULL,
  tc INT NULL,
  ews INT NULL,
  ws INT NULL,
  ds INT NULL,
  bctp INT NULL,
  dptp INT NULL,
  wh INT NULL,
  lb INT NULL,
  tcbl INT NULL,
  tpc INT NULL,
  rtp INT NULL,
  cbl INT NULL,
  total_calls INT NULL,
  total_contacts INT NULL,
  total_promises INT NULL,
  agent_count INT NULL,
  cur_bal DECIMAL(18,4) NULL,
  ptp_value DECIMAL(18,4) NULL,
  total_ptp_value DECIMAL(18,4) NULL,
  agent_hours DECIMAL(18,4) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sbi_card_dialer_mis (process_id, report_date, campaign),
  KEY idx_sbi_card_dialer_mis_date (report_date, is_rollup)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sbi_card_agent_mis (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  employee_id VARCHAR(30) NOT NULL,
  dialer_id VARCHAR(30) NULL,
  agent_name VARCHAR(150) NULL,
  team VARCHAR(100) NULL,
  team_leader VARCHAR(150) NULL,
  first_login_time TIME NULL,
  target_time TIME NULL,
  last_logout_time TIME NULL,
  leakage_seconds INT NULL,
  calls INT NULL,
  aod_calls INT NULL,
  acd_calls INT NULL,
  transferred_calls INT NULL,
  manual_calls INT NULL,
  acw_active_count INT NULL,
  contacts INT NULL,
  ptp INT NULL,
  pad INT NULL,
  total_promises INT NULL,
  no_promise INT NULL,
  amt_collected_pp DECIMAL(18,4) NULL,
  amt_collected_pu DECIMAL(18,4) NULL,
  amt_collected DECIMAL(18,4) NULL,
  tos_hours DECIMAL(18,4) NULL,
  talk_hours DECIMAL(18,4) NULL,
  wrap_hours DECIMAL(18,4) NULL,
  idle_hours DECIMAL(18,4) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sbi_card_agent_mis (process_id, report_date, employee_id),
  KEY idx_sbi_card_agent_mis_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sbi_card_account_file (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  account_no VARCHAR(40) NOT NULL,
  billing_cycle VARCHAR(20) NULL,
  delq1 VARCHAR(20) NULL,
  cibil_score INT NULL,
  credit_limit DECIMAL(18,4) NULL,
  cur_bal DECIMAL(18,4) NULL,
  cur_bal_plus_dpi DECIMAL(18,4) NULL,
  total_amount_due DECIMAL(18,4) NULL,
  total_cur_due DECIMAL(18,4) NULL,
  date_last_pmt DATE NULL,
  last_action_code VARCHAR(30) NULL,
  last_ptp_date DATE NULL,
  mobile_no VARCHAR(20) NULL,
  vintage VARCHAR(30) NULL,
  region VARCHAR(50) NULL,
  agency_name VARCHAR(100) NULL,
  call_table_name VARCHAR(100) NULL,
  dial_cnt INT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sbi_card_account_file (process_id, report_date, account_no),
  KEY idx_sbi_card_account_file_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sbi_card_downtime (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  start_time TIME NOT NULL,
  up_time TIME NULL,
  site VARCHAR(100) NOT NULL DEFAULT '',
  downtime_minutes DECIMAL(10,2) NULL,
  impacted_users INT NULL,
  responsibility VARCHAR(100) NULL,
  reason VARCHAR(255) NULL,
  status VARCHAR(50) NULL,
  rca VARCHAR(255) NULL,
  remarks VARCHAR(255) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sbi_card_downtime (process_id, report_date, start_time, site),
  KEY idx_sbi_card_downtime_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sbi_card_pen_estimation (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  call_table VARCHAR(120) NOT NULL,
  download_count INT NULL,
  penetration DECIMAL(12,4) NULL,
  dials_required INT NULL,
  dph DECIMAL(12,4) NULL,
  present_agents INT NULL,
  rostered_count INT NULL,
  present_agent_hrs DECIMAL(12,4) NULL,
  dials INT NULL,
  estimated_pen DECIMAL(12,4) NULL,
  target_penetration DECIMAL(12,4) NULL,
  required_agent_hrs DECIMAL(12,4) NULL,
  excess_deficit_hrs DECIMAL(12,4) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sbi_card_pen_estimation (process_id, report_date, call_table),
  KEY idx_sbi_card_pen_estimation_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'SBI_CARD_DIALER_MIS';
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'SBI_CARD_DIALER_MIS', 'SBI Card -- Dialer MIS (campaign daily)', 'sbi_card_dialer_mis',
   'SBI Card Collections campaign-level daily DIALER MIS. One workbook sheet per upload: the uploader adds the sheet name as the Campaign column; header is on row 2. Master / Overall sheets are rollups and are excluded from dashboard totals.',
   JSON_ARRAY('Date'),
   JSON_ARRAY('Campaign', 'Day', 'Total Accounts', 'Accounts Excluded', 'Accounts Scheduled', 'Accounts Called', 'Dials', 'Actual Dialer Dials', 'Answers', 'Connects', 'Make Calls', 'Aborts', 'DROP', 'PTP', 'PAD', 'OTP', 'DISP', 'WN', 'NC', 'AU', 'VOML', 'CT', 'TC', 'EWS', 'WS', 'DS', 'BCTP', 'DPTP', 'WH', 'LB', 'TCBL', 'TPC', 'RTP', 'CBL', 'TOTAL CALLS', 'TOTAL Contacts', 'TOTAL Promises', 'Count Of Agents', 'Cur_Bal', 'PTP Value', 'Total PTP Value', 'Agent Hours'),
   JSON_OBJECT('Date', '2026-08-01', 'Campaign', 'EL_DEL_CD2_SBI_7_8_', 'Total Accounts', '493', 'Accounts Called', '493', 'Dials', '1943', 'Answers', '145', 'Connects', '145', 'PTP', '7', 'PAD', '1', 'OTP', '5', 'TOTAL Contacts', '15'),
   1);
DELETE FROM upload_template_master WHERE upload_type_code = 'SBI_CARD_AGENT_MIS';
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'SBI_CARD_AGENT_MIS', 'SBI Card -- Agent MIS (agent daily)', 'sbi_card_agent_mis',
   'SBI Card Collections per-agent per-day MIS (Sheet1). Re-uploading the same Employee ID + Date refreshes the row.',
   JSON_ARRAY('Employee ID', 'Date'),
   JSON_ARRAY('DIALER ID', 'Name', 'TEAM', 'TEAM LEADER', 'First Login Time', 'Target Time', 'Last Logout Time', 'Leakage Of Day', 'Calls', 'AOD Calls', 'ACD Calls', 'Transfered Calls', 'Manual Calls', 'ACW Active count', 'Contacts', 'PTP', 'PAD', 'Total Promises', 'No Promise', 'Amt collected PP', 'Amt collected PU', 'Amt collected', 'TOS', 'Talk', 'Wrap', 'Idle'),
   JSON_OBJECT('Employee ID', '600264364', 'DIALER ID', '600264364', 'Name', 'Sarita', 'Date', '2026-08-01', 'Calls', '164', 'Contacts', '15', 'First Login Time', '9:00:46', 'Last Logout Time', '18:40:12', 'Leakage Of Day', '0:00:46'),
   1);
DELETE FROM upload_template_master WHERE upload_type_code = 'SBI_CARD_ACCOUNT_FILE';
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'SBI_CARD_ACCOUNT_FILE', 'SBI Card -- Account file (dialer export)', 'sbi_card_account_file',
   'SBI Card Collections account-level dialer export/import file. Only needed columns are stored; customer name and alternate phone numbers are dropped. Report Date defaults to the upload day.',
   JSON_ARRAY('ACCOUNT_NO'),
   JSON_ARRAY('Report Date', 'BILLING_CYCLE', 'DELQ1', 'CIBIL_SCORE', 'CREDIT_LIMIT', 'CUR_BAL', 'CUR_BAL_PLUS_DPI', 'TOTAL_AMOUNT_DUE', 'TOTAL_CUR_DUE', 'DATE_LAST_PMT', 'LAST_ACTION_CODE', 'LAST_PTP_DATE', 'MOBILE_NO', 'VINTAGE', 'REGION', 'AGENCY_NAME', 'CALL_TABLE_NAME', 'DIAL_CNT'),
   JSON_OBJECT('ACCOUNT_NO', '4000000000000001', 'Report Date', '2026-08-19', 'BILLING_CYCLE', '12', 'DELQ1', '2', 'CUR_BAL', '25000.50', 'TOTAL_AMOUNT_DUE', '5200.00', 'LAST_ACTION_CODE', 'PTP'),
   1);
DELETE FROM upload_template_master WHERE upload_type_code = 'SBI_CARD_DOWNTIME';
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'SBI_CARD_DOWNTIME', 'SBI Card -- Downtime tracker', 'sbi_card_downtime',
   'SBI Card Collections downtime tracker. Downtime Minutes may be h:mm (4:20 = 260 minutes) or plain minutes.',
   JSON_ARRAY('Date', 'Start Time'),
   JSON_ARRAY('Start Time', 'Up Time', 'Downtime Minutes', 'Total Impacted Users', 'Responsibility', 'Downtime Description/ Issue Reason', 'Site', 'Status', 'RCA (If Any)', 'Remarks'),
   JSON_OBJECT('Date', '2026-08-09', 'Start Time', '14:30', 'Up Time', '18:50', 'Downtime Minutes', '4:20', 'Total Impacted Users', '33', 'Site', 'ELEVATE', 'Status', 'Resolved'),
   1);
DELETE FROM upload_template_master WHERE upload_type_code = 'SBI_CARD_PEN_ESTIMATION';
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'SBI_CARD_PEN_ESTIMATION', 'SBI Card -- Pen estimation', 'sbi_card_pen_estimation',
   'SBI Card Collections pen estimation report (one row per dialer call table). The day is read from Report Date or the call table name''s ddmmyyyy suffix; the GRAND TOTAL row is skipped.',
   JSON_ARRAY('CALL TABLES'),
   JSON_ARRAY('Report Date', 'Download', 'Penetration', 'Dials Required', 'DPH', 'Present Agents (Nos.)', 'Actual Rostered Count', 'Actual Present Agent Hrs.', 'Dials', 'Estimated PEN', 'Target Penetration', 'Required Agent Hrs.', 'Excess/Deficit Agent Hrs.'),
   JSON_OBJECT('CALL TABLES', 'AL_MUM_CD3_HB_19082026', 'Download', '1318', 'Penetration', '3', 'Dials Required', '3954', 'Present Agents (Nos.)', '24'),
   1);
