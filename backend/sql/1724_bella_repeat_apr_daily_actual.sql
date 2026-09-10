-- Bella Vita Repeat LOB's own "APR" sheet -- found while auditing every
-- sheet of "Bella Vita Repeat LOB Mis Dashboard July26.xlsb", not named in
-- BELLAVITA Dashboard.docx's own SOP text, but real data with no DB backing
-- anywhere: per-agent per-day call/chat productivity for the Repeat
-- Customer LOB specifically, 615 real rows in the sample file. Verified
-- live: all 4 real MAS codes sampled resolve to real employees.employee_
-- code rows with matching names.
--
-- This is a different table from the existing db_masmis.bb_sale (which
-- already IS the live home for this dashboard's own "Sale Raw" sheet,
-- confirmed identical live -- e.g. NIKHIL GIRI/MAS57009's exact sample row
-- matched a real bb_sale row) -- APR productivity has no such existing home.
--
-- Scoped down from the source's full 38 columns to the ones a KPI actually
-- needs, same reasoning as clovia_crm_disposition (sql/1705). Row identity:
-- the sheet's own "Unique ID" column (Date+NOIID concatenation) is unique
-- across all 614 real non-blank rows. Duration columns are day-fraction
-- decimals except ACHT, which is already plain seconds -- both handled by
-- the same parseSecondsFlexible <1 heuristic already fixed this session
-- (sql/1710, sql/1718, sql/1719).
CREATE TABLE IF NOT EXISTS bella_repeat_apr_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  mas_employee_code VARCHAR(50) NOT NULL,
  agent_name VARCHAR(255) NULL,
  call_date DATE NOT NULL,
  lob VARCHAR(100) NULL,
  total_calls INT NULL,
  login_seconds INT NULL,
  net_login_seconds INT NULL,
  wait_seconds INT NULL,
  talk_seconds INT NULL,
  dispo_seconds INT NULL,
  pause_seconds INT NULL,
  acht_seconds INT NULL,
  total_break_seconds INT NULL,
  utilization_pct DECIMAL(7,4) NULL,
  attendance_fraction DECIMAL(4,2) NULL,
  team_leader VARCHAR(255) NULL,
  tenure_days INT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bella_repeat_apr_daily (process_id, mas_employee_code, call_date, source_reference),
  KEY idx_bella_repeat_apr_daily_process_date (process_id, call_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'BELLA_REPEAT_APR_DAILY';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'BELLA_REPEAT_APR_DAILY', 'Bella Vita Repeat LOB — APR (Daily)', 'bella_repeat_apr_daily_actual',
   'Bella Vita Repeat LOB''s own APR sheet: per-agent per-day productivity for the Repeat Customer LOB (no DB backing exists).',
   JSON_ARRAY('NOIID', 'Date'),
   JSON_ARRAY('Emp_Name', 'LOB', 'Calls', 'Login_Seconds', 'Net_Login_Seconds', 'Wait_Seconds', 'Talk_Seconds', 'Dispo_Seconds', 'Pause_Seconds', 'ACHT_Seconds', 'Total_Break_Seconds', 'Utilization', 'Attendance', 'Team_Leader', 'Tenure'),
   JSON_OBJECT('NOIID', 'MAS62548', 'Date', '2026-07-01', 'Emp_Name', 'VISHNU PRIYA SINGH', 'LOB', 'Repeat Customer LOB', 'Calls', 561, 'Login_Seconds', 33720, 'Net_Login_Seconds', 35428, 'Wait_Seconds', 11248, 'Talk_Seconds', 16891, 'Dispo_Seconds', 3351, 'Pause_Seconds', 2230, 'ACHT_Seconds', 36, 'Utilization', 0.40077194781518827, 'Attendance', 1.0, 'Team_Leader', 'Richa', 'Tenure', 43),
   1);
