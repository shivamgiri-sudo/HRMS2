-- LP (Lawyer Panel)'s WebConsole "Agent Wise Performance" APR export has real,
-- named columns in its own SOP -- unlike most of the other Report Builder SOP
-- gaps found in this audit, which name only a system, not a format:
-- Total Calls, Login Time, Net LoginTime, Total Break Duration, Idle Duration,
-- Talk Duration, Wrapup Duration, CallDate (LoginId is explicitly deleted by
-- the SOP itself before pasting, so it is not carried here).
--
-- Matches the confirmed-empty dialer_db.apr_5 / apr_137_235 / apr_bla_bli_blu
-- tables found in the 2026-09-09 SOP audit (a dead external sync job) -- this
-- is the manual path for the same data, landing in mas_hrms rather than
-- writing into dialer_db, an upstream read-only source per this project's
-- Database Boundary Rule.
--
-- Durations are stored in seconds (the SOP's own instruction: "Convert text
-- to numbers" on every one of these columns, i.e. the raw export is an
-- HH:MM:SS text column that needs converting -- done here at import time,
-- not left as text).
CREATE TABLE IF NOT EXISTS lp_apr_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  agent_name VARCHAR(255) NOT NULL,
  call_date DATE NOT NULL,
  total_calls INT NOT NULL DEFAULT 0,
  login_seconds INT NOT NULL DEFAULT 0,
  net_login_seconds INT NOT NULL DEFAULT 0,
  total_break_seconds INT NOT NULL DEFAULT 0,
  idle_seconds INT NOT NULL DEFAULT 0,
  talk_seconds INT NOT NULL DEFAULT 0,
  wrapup_seconds INT NOT NULL DEFAULT 0,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- One row per agent per day per upload batch -- a re-upload of the same day
  -- from a new batch does not silently collide with the first, same reasoning
  -- as process_delivery_actual/email_ticket_daily_actual.
  UNIQUE KEY uq_lp_apr_daily (process_id, agent_name, call_date, source_reference),
  KEY idx_lp_apr_daily_process_date (process_id, call_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'LP_APR_DAILY';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES
(UUID(), 'LP_APR_DAILY', 'Lawyer Panel WebConsole APR (Daily)',
 'lp_apr_daily_actual',
 'Daily agent productivity for the Lawyer Panel WebConsole "Agent Wise Performance" export, per its own SOP. dialer_db.apr_5/apr_137_235/apr_bla_bli_blu (the tables this data would otherwise land in) are confirmed empty -- a dead sync job -- so this is the manual path. Durations (Login Time, Net LoginTime, Total Break Duration, Idle Duration, Talk Duration, Wrapup Duration) are HH:MM:SS in the source export and are converted to seconds on import, per the SOP''s own "Convert text to numbers" instruction.',
 JSON_ARRAY('Agent','Call Date','Total Calls','Login Time','Net LoginTime','Total Break Duration','Idle Duration','Talk Duration','Wrapup Duration'),
 JSON_ARRAY(),
 JSON_OBJECT(
   'Agent','Rakesh Kumar',
   'Call Date','2026-09-08',
   'Total Calls','142',
   'Login Time','08:12:30',
   'Net LoginTime','07:45:10',
   'Total Break Duration','00:27:20',
   'Idle Duration','01:10:05',
   'Talk Duration','04:55:40',
   'Wrapup Duration','01:39:25'
 ), 1);
