-- DU Digital's "6. DU Korea" / "6. DU Thailand" (per its own SOP: "Open DU
-- CRM... Agents Reports... Click Agents Time details... Download... Paste
-- into APR Raw" -- no DB backing exists anywhere). Columns read directly
-- from two real samples (downloaded via the user's own authenticated Drive
-- session): "Du-Digital Korea MIS Dashboard Sep'26.xlsb" and "Du-Digital
-- Thailand MIS Dashboard Sep'26.xlsb", both sheet "APR Raw" -- same shape,
-- two dashboard instances of the identical report, same pattern as this
-- session's LP Leads and Molecular/Reginald Men Email dashboards. Both
-- anchor to the single "DU Digital" process (active_status=1).
--
-- The source's time columns are day-fraction decimals (e.g. LOGINTIME =
-- 0.4174 = 41.74% of a day = 36,061 seconds), not HH:MM:SS text like LP's
-- WebConsole APR (sql/1701) -- confirmed live: 0.41737268518518517 * 86400
-- = 36061.06.. seconds, matching the source's own "Login Time In Sec"
-- column (36061) to the second. Utilization % likewise arrives as a plain
-- fraction (0.1503... = 15.04%), not a pre-multiplied percentage.
CREATE TABLE IF NOT EXISTS du_apr_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  dashboard_label ENUM('KOREA','THAILAND') NOT NULL,
  agent_name VARCHAR(255) NOT NULL,
  agent_code VARCHAR(100) NULL,
  call_date DATE NOT NULL,
  total_calls INT NOT NULL DEFAULT 0,
  login_seconds INT NOT NULL DEFAULT 0,
  net_login_seconds INT NOT NULL DEFAULT 0,
  talk_seconds INT NOT NULL DEFAULT 0,
  idle_seconds INT NOT NULL DEFAULT 0,
  wrapup_seconds INT NOT NULL DEFAULT 0,
  break_seconds INT NOT NULL DEFAULT 0,
  dead_seconds INT NOT NULL DEFAULT 0,
  utilization_pct DECIMAL(7,4) NULL,
  week_label VARCHAR(20) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_du_apr_daily (process_id, dashboard_label, agent_name, call_date, source_reference),
  KEY idx_du_apr_daily_process_date (process_id, dashboard_label, call_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code IN ('DU_APR_KOREA', 'DU_APR_THAILAND');

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'DU_APR_KOREA', 'DU Digital — APR (Korea)', 'du_apr_daily_actual',
   'DU Digital''s Agents Time details export, Korea dashboard, per its own SOP APR Raw sheet (no DB backing exists).',
   JSON_ARRAY('Date', 'Agent', 'Calls'),
   JSON_ARRAY('Agent_ID', 'Login_Seconds', 'Net_Login_Seconds', 'Talk_Seconds', 'Idle_Seconds', 'Wrapup_Seconds', 'Break_Seconds', 'Dead_Seconds', 'Utilization_Pct', 'Week'),
   JSON_OBJECT('Date', '2026-09-01', 'Agent', 'Ravi Kumar', 'Agent_ID', 'Agent7004', 'Calls', 20, 'Login_Seconds', 36061, 'Net_Login_Seconds', 33843, 'Talk_Seconds', 4902, 'Idle_Seconds', 28747, 'Wrapup_Seconds', 186, 'Break_Seconds', 2226, 'Dead_Seconds', 165, 'Utilization_Pct', 15.04, 'Week', 'Week1'),
   1),
  (UUID(), 'DU_APR_THAILAND', 'DU Digital — APR (Thailand)', 'du_apr_daily_actual',
   'DU Digital''s Agents Time details export, Thailand dashboard, per its own SOP APR Raw sheet (no DB backing exists).',
   JSON_ARRAY('Date', 'Agent', 'Calls'),
   JSON_ARRAY('Agent_ID', 'Login_Seconds', 'Net_Login_Seconds', 'Talk_Seconds', 'Idle_Seconds', 'Wrapup_Seconds', 'Break_Seconds', 'Dead_Seconds', 'Utilization_Pct', 'Week'),
   JSON_OBJECT('Date', '2026-09-01', 'Agent', 'Montri', 'Agent_ID', 'Agent7006', 'Calls', 28, 'Login_Seconds', 32083, 'Net_Login_Seconds', 29988, 'Talk_Seconds', 5232, 'Idle_Seconds', 24746, 'Wrapup_Seconds', 121, 'Break_Seconds', 2103, 'Dead_Seconds', 752, 'Utilization_Pct', 17.46, 'Week', 'Week1'),
   1);
