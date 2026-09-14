-- GNC's Agent Productivity Report (APR) export. Mydashboards
-- (github.com/tausifansari-mcn/Mydashboards, backend/src/modules/sales/
-- sales.service.ts uploadGncApr()) writes the identical report into
-- db_masmis.gnc_apr -- confirmed live: that table is real (829 rows) but
-- stale, last updated 2026-05-30, over three months before this migration.
-- Whatever fed it externally has stopped. This gives our own team a live
-- upload path for the same report shape, landing in our own table rather
-- than writing into db_masmis (an external schema we only ever read, never
-- write, per the Database Boundary Rule) -- same "own table, same report
-- shape" pattern already used for du_apr_daily_actual (sql/1710) and
-- lp_apr_daily_actual.
--
-- Column names/types follow Mydashboards' own GncAprRow interface exactly
-- (sales.service.ts, "GNC APR Upload" section) so the CSV a GNC ops person
-- already has needs no reshaping to upload here. Their duration columns
-- (login_time, wait_time, talk_time, dispo_time, pause_time, net_login,
-- break_time) are HH:MM:SS text in their own real sample data (same shape
-- LP's WebConsole APR uses, confirmed against lp-apr-daily-bulk.service.ts'
-- own parser) -- stored here as seconds (INT), parsed at import time, not
-- as day-fraction decimals like DU Digital's export (a different source
-- system with a different native format).
CREATE TABLE IF NOT EXISTS gnc_apr_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  uid VARCHAR(100) NULL,
  report_date DATE NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  agent_code VARCHAR(100) NULL,
  tl_name VARCHAR(255) NULL,
  process_type VARCHAR(100) NULL,
  total_calls INT NOT NULL DEFAULT 0,
  login_seconds INT NOT NULL DEFAULT 0,
  wait_seconds INT NOT NULL DEFAULT 0,
  talk_seconds INT NOT NULL DEFAULT 0,
  dispo_seconds INT NOT NULL DEFAULT 0,
  pause_seconds INT NOT NULL DEFAULT 0,
  net_login_seconds INT NOT NULL DEFAULT 0,
  break_seconds INT NOT NULL DEFAULT 0,
  acht_seconds INT NULL,
  attendance VARCHAR(50) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gnc_apr_daily (process_id, user_name, report_date),
  KEY idx_gnc_apr_daily_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'GNC_APR';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'GNC_APR', 'GNC — Agent Productivity Report (APR)', 'gnc_apr_daily_actual',
   'GNC''s daily Agent Productivity Report -- same report shape Mydashboards'' own GNC APR Upload writes to db_masmis.gnc_apr, which stopped receiving data on 2026-05-30. Duration columns are HH:MM:SS text.',
   JSON_ARRAY('report_date', 'user_name', 'calls'),
   JSON_ARRAY('uid', 'emp_id', 'tl_name', 'process_type', 'login_time', 'wait_time', 'talk_time', 'dispo_time', 'pause_time', 'net_login', 'break_time', 'acht', 'atten'),
   JSON_OBJECT('report_date', '2026-09-10', 'user_name', 'Priya Sharma', 'emp_id', 'MAS60123', 'tl_name', 'Rohit Verma', 'process_type', 'Outbound', 'calls', 42, 'login_time', '08:15:00', 'wait_time', '01:20:00', 'talk_time', '03:45:00', 'dispo_time', '00:30:00', 'pause_time', '00:40:00', 'net_login', '06:15:00', 'break_time', '00:45:00', 'acht', '00:05:21', 'atten', 'Present'),
   1);
