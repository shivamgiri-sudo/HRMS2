-- Clovia's own "APR-Utilization Raw" sheet -- found while auditing every
-- sheet of "Clovia_Performance_Dashboard Report Sept26 (1).xlsb" (the same
-- workbook family already used this session for Chat Performance/CRM
-- Disposition/Team Alignment), not named in Clovia Steps.docx's own SOP
-- text, but real data with no DB backing anywhere: a per-agent per-day
-- productivity/utilization sheet spanning all three Clovia LOBs (Inbound,
-- Outbound, Email).
--
-- Scoped down from the source's full 35 columns to the ones a KPI actually
-- needs -- the many individual AUX-time buckets (PARKS, Bio, Lunch, OutCal,
-- Qualit, Short, Traini, Team Briefing AUX) are left out, same reasoning as
-- clovia_crm_disposition (sql/1705); Total Break already sums them.
--
-- Row identity: the sheet's own "Unique ID" column concatenates MAS ID +
-- Date (e.g. "MAS6210546266") -- used here as its logical parts (MAS ID,
-- Date) instead, verified live as unique across all 74 real non-blank rows.
-- Duration columns are day-fraction decimals (e.g. LOGIN TIME =
-- 0.3824537037037037 = 33,044 seconds), same convention as this session's
-- DU APR (sql/1710), not HH:MM:SS text like LP's WebConsole APR (sql/1701).
CREATE TABLE IF NOT EXISTS clovia_apr_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  mas_employee_code VARCHAR(50) NOT NULL,
  agent_name VARCHAR(255) NULL,
  call_date DATE NOT NULL,
  lob VARCHAR(50) NULL,
  total_calls INT NULL,
  chat_count INT NULL,
  email_count INT NULL,
  login_seconds INT NULL,
  net_login_seconds INT NULL,
  wait_seconds INT NULL,
  talk_seconds INT NULL,
  dispo_seconds INT NULL,
  total_break_seconds INT NULL,
  acht_seconds INT NULL,
  utilization_pct DECIMAL(7,4) NULL,
  attendance_fraction DECIMAL(4,2) NULL,
  csat_pct DECIMAL(7,4) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clovia_apr_daily (process_id, mas_employee_code, call_date, source_reference),
  KEY idx_clovia_apr_daily_process_date (process_id, call_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'CLOVIA_APR_DAILY';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'CLOVIA_APR_DAILY', 'Clovia — APR Utilization (Daily)', 'clovia_apr_daily_actual',
   'Clovia''s own APR-Utilization Raw sheet: per-agent per-day productivity across Inbound/Outbound/Email (no DB backing exists).',
   JSON_ARRAY('MAS_ID', 'Date'),
   JSON_ARRAY('USER_NAME', 'LOB', 'No_of_Calls', 'Chat_Count', 'Email_Count', 'Actual_Login_Hrs', 'Net_Login_Hrs_DN', 'WAIT', 'TALK', 'DISPO', 'Total_Break', 'ACHT', 'Utilization', 'Attendance', 'CSAT'),
   JSON_OBJECT('MAS_ID', 'MAS62105', 'Date', '2026-09-01', 'USER_NAME', 'SHUBHA JAIN SHARMA', 'LOB', 'Inbound', 'No_of_Calls', 59, 'Actual_Login_Hrs', 0.3522685185185185, 'WAIT', 0.17030092592592594, 'TALK', 0.1275, 'Utilization', 0.4427980023656197, 'Attendance', 1.0),
   1);
