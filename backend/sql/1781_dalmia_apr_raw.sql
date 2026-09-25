-- Dalmia Cement APR (agent productivity / utilisation) sheet -- the "dalmia_apr" uploader.
--
-- One row per agent per day, read verbatim from the real sample the user supplied (Unique ID, Week, Date,
-- Emp_Name, NOIID, No. of Calls/Chat, LOB, Login Time, WAIT, TALK, DISPO, PAUSE, ACHT, Lunch, Tea, Tea1, Washr,
-- Team Briefing AUX, Net Pause, Avg Dispo, Total Break, Actual Login Hrs, Downtime, Login, Logout, Net Login
-- Hrs+DN+Briefing, Utilization, Attendance, Week 1, MTD, Unique Count, Attendence 2, Capping, Attendance).
--
-- This is a RAW store of the uploaded sheet only. Productivity KPIs keep reading mas_hrms.apr (the dialer sync);
-- sql/1733 was retracted on 2026-09-10 for exactly that reason, and this table is deliberately NOT wired into any
-- KPI/dashboard so the two can never compete as a source of truth. Durations are stored as whole seconds.
--
-- Row identity: "Unique ID" (date serial + employee id, e.g. 46235MAS62624), or "<date>|<employee id>" when blank.
-- The table lives in db_masmis (like the other MASMIS raw stores); the upload_template_master row is in mas_hrms.
-- ADDITIVE ONLY: a new table and one upload_template_master row -- nothing existing is touched.
CREATE TABLE IF NOT EXISTS db_masmis.dalmia_apr_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  unique_id VARCHAR(60) NOT NULL,
  report_date DATE NOT NULL,
  week_label VARCHAR(30) NULL,
  emp_name VARCHAR(150) NULL,
  emp_id VARCHAR(30) NOT NULL,
  calls_chats INT NULL,
  lob VARCHAR(50) NULL,
  login_time_sec INT NULL,
  wait_sec INT NULL,
  talk_sec INT NULL,
  dispo_sec INT NULL,
  pause_sec INT NULL,
  acht_sec INT NULL,
  lunch_sec INT NULL,
  tea_sec INT NULL,
  tea1_sec INT NULL,
  washroom_sec INT NULL,
  team_briefing_aux_sec INT NULL,
  net_pause_sec INT NULL,
  avg_dispo_sec INT NULL,
  total_break_sec INT NULL,
  actual_login_sec INT NULL,
  downtime_sec INT NULL,
  login_clock TIME NULL,
  logout_clock TIME NULL,
  net_login_incl_dn_briefing_sec INT NULL,
  utilization_pct DECIMAL(6,2) NULL,
  attendance_days DECIMAL(5,2) NULL,
  attendance_status VARCHAR(10) NULL,
  week_bucket VARCHAR(30) NULL,
  period_label VARCHAR(30) NULL,
  unique_count INT NULL,
  attendance_2 INT NULL,
  capping_sec INT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dalmia_apr_raw_unique_id (process_id, unique_id),
  KEY idx_dalmia_apr_raw_date (report_date),
  KEY idx_dalmia_apr_raw_emp (emp_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'DALMIA_APR';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'DALMIA_APR', 'Dalmia Cement — APR (dalmia_apr)', 'dalmia_apr_raw',
   'Dalmia Cement''s own APR sheet: one row per agent per day (login, talk, break, dispo times, utilisation, attendance).',
   JSON_ARRAY('Date', 'NOIID'),
   JSON_ARRAY('Unique ID', 'Week', 'Emp_Name', 'No. of Calls/Chat', 'LOB', 'Login Time', 'WAIT', 'TALK', 'DISPO', 'PAUSE',
     'ACHT', 'Lunch', 'Tea', 'Tea1', 'Washr', 'Team Briefing AUX', 'Net Pause', 'Avg Dispo', 'Total Break',
     'Actual Login Hrs', 'Downtime', 'Login', 'Logout', 'Net Login Hrs+DN+Briefing', 'Utilization', 'Attendance',
     'Week 1', 'MTD', 'Unique Count', 'Attendence 2', 'Capping'),
   JSON_OBJECT('Unique ID', '46235MAS62624', 'Week', 'Week 1', 'Date', '1-Aug-26', 'Emp_Name', 'J.ANANTHALAKSHMI',
     'NOIID', 'MAS62624', 'No. of Calls/Chat', '8', 'LOB', 'Dalmia', 'Login Time', '9:27:24', 'WAIT', '7:46:42',
     'TALK', '0:20:55', 'DISPO', '0:00:37', 'ACHT', '162', 'Utilization', '43%', 'Attendance', '1.00'),
   1);
