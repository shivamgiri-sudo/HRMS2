-- Dalmia Cement's own "Dalmia July'26.xlsx" MIS workbook's
-- "APR-Utilization Raw" sheet -- per-agent per-day productivity, found
-- while auditing the same workbook as sql/1730-1732. No DB backing exists
-- anywhere (same cross-schema check). Real, current data: 109 rows,
-- 2026-07-01 to 2026-07-14. Real MAS codes confirmed live (e.g.
-- MAS62624=J ANANTHALAKSHMI, MAS62615=ASIT MOHAN RATH, matching employees
-- exactly).
--
-- Row identity: the sheet's own "Unique ID" (Date-serial + NOIID
-- concatenation, e.g. "46204MAS62624") is unique across all 109 real rows.
--
-- Duration columns are HH:MM:SS time-of-day values / day-fraction
-- decimals, handled by this session's shared parseSecondsFlexible
-- convention (clovia-apr-daily-bulk.service.ts).
--
-- Dropped as broken VLOOKUP formula errors ("#N/A" in all 109 rows):
-- "Team Leader", "FHD", "Tenure", "Sub Lob". Dropped as constant/
-- redundant: "MTD" (always literal "MTD"), "Unique Count" (always 1),
-- "Week 1" (duplicates "Week"), "Attendence 2" and "Capping" (both
-- redundant with "Attendance"), "Tenurity Week" (100% empty). The sheet
-- has TWO columns both literally named "Attendance" (a numeric 1/0.5
-- weight at column 27, and a "P"/"HD" text code at column 38) -- a
-- genuine duplicate header in the source, which collapses to one JSON
-- key by the time a row reaches this table's normalized_data, so only
-- one can survive; the text code (the later, winning duplicate) is kept
-- and the numeric weight is dropped rather than silently guessed at.
CREATE TABLE IF NOT EXISTS dalmia_apr_utilization_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  source_unique_id VARCHAR(50) NOT NULL,
  report_date DATE NOT NULL,
  week_label VARCHAR(20) NULL,
  emp_code VARCHAR(20) NULL,
  emp_name VARCHAR(150) NULL,
  lob VARCHAR(50) NULL,
  call_chat_count INT NULL,
  login_seconds INT NULL,
  wait_seconds INT NULL,
  talk_seconds INT NULL,
  dispo_seconds INT NULL,
  pause_seconds INT NULL,
  acht_seconds INT NULL,
  lunch_seconds INT NULL,
  tea_seconds INT NULL,
  tea1_seconds INT NULL,
  washroom_seconds INT NULL,
  team_briefing_seconds INT NULL,
  net_pause_seconds INT NULL,
  avg_dispo_seconds INT NULL,
  total_break_seconds INT NULL,
  actual_login_seconds INT NULL,
  downtime_seconds INT NULL,
  login_time DATETIME NULL,
  logout_time DATETIME NULL,
  net_login_dn_briefing_seconds INT NULL,
  utilization_pct DECIMAL(6,3) NULL,
  attendance_code VARCHAR(10) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dalmia_apr_util_unique_id (process_id, source_unique_id),
  KEY idx_dalmia_apr_util_date (report_date),
  KEY idx_dalmia_apr_util_emp (emp_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'DALMIA_APR_UTILIZATION';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'DALMIA_APR_UTILIZATION', 'Dalmia Cement — APR Utilization Raw', 'dalmia_apr_utilization_raw',
   'Dalmia Cement''s own APR-Utilization Raw sheet: per-agent per-day productivity (no DB backing exists).',
   JSON_ARRAY('Unique ID', 'Date', 'NOIID'),
   JSON_ARRAY('Week', 'Emp_Name', 'No. of Calls/Chat', 'LOB', 'Login Time', 'WAIT', 'TALK', 'DISPO', 'PAUSE',
     'ACHT', 'Lunch', 'Tea', 'Tea1', 'Washr', 'Team Briefing AUX', 'Net Pause', 'Avg Dispo', 'Total Break',
     'Actual Login Hrs', 'Downtime', 'Login', 'Logout', 'Net Login Hrs+DN+Briefing', 'Utilization',
     'Attendance'),
   JSON_OBJECT('Unique ID', '46204MAS62624', 'Date', '2026-07-01', 'NOIID', 'MAS62624',
     'Emp_Name', 'J.ANANTHALAKSHMI', 'LOB', 'Dalmia', 'Utilization', '0.4132866622912565'),
   1);
