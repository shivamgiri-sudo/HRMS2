-- DU Digital CDR/APR tables live in db_masmis, alongside every other uploaded business
-- dataset (Pre_cdr, owner_sale, cl_apr, ...). Originally created in mas_hrms by sql/1710
-- and sql/1966; this migration creates the db_masmis copies and backfills them from mas_hrms.
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS plus INSERT IGNORE on the same unique
-- keys. The mas_hrms tables are left in place.

CREATE TABLE IF NOT EXISTS db_masmis.du_cdr_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  dashboard_label ENUM('KOREA','THAILAND') NOT NULL,
  uniqueid VARCHAR(100) NOT NULL,
  call_date DATE NOT NULL,
  call_datetime DATETIME NULL,
  agent_user VARCHAR(100) NULL,
  agent_name VARCHAR(255) NULL,
  phone_number VARCHAR(50) NULL,
  campaign_id VARCHAR(100) NULL,
  user_group VARCHAR(150) NULL,
  status VARCHAR(20) NULL,
  status_name VARCHAR(150) NULL,
  length_in_sec INT NOT NULL DEFAULT 0,
  queue_time_sec INT NOT NULL DEFAULT 0,
  hour_of_day TINYINT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_du_cdr (process_id, dashboard_label, uniqueid),
  KEY idx_du_cdr_process_date (process_id, dashboard_label, call_date),
  KEY idx_du_cdr_date_group (call_date, user_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS db_masmis.du_apr_daily_actual (
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

INSERT IGNORE INTO db_masmis.du_cdr_daily_actual
  (id, process_id, dashboard_label, uniqueid, call_date, call_datetime, agent_user, agent_name, phone_number,
   campaign_id, user_group, status, status_name, length_in_sec, queue_time_sec, hour_of_day, data_source,
   source_reference, upload_batch_id, created_by, created_at, updated_at)
SELECT id, process_id, dashboard_label, uniqueid, call_date, call_datetime, agent_user, agent_name, phone_number,
   campaign_id, user_group, status, status_name, length_in_sec, queue_time_sec, hour_of_day, data_source,
   source_reference, upload_batch_id, created_by, created_at, updated_at
FROM mas_hrms.du_cdr_daily_actual;

INSERT IGNORE INTO db_masmis.du_apr_daily_actual
  (id, process_id, dashboard_label, agent_name, agent_code, call_date, total_calls, login_seconds, net_login_seconds,
   talk_seconds, idle_seconds, wrapup_seconds, break_seconds, dead_seconds, utilization_pct, week_label, data_source,
   source_reference, upload_batch_id, created_by, created_at, updated_at)
SELECT id, process_id, dashboard_label, agent_name, agent_code, call_date, total_calls, login_seconds, net_login_seconds,
   talk_seconds, idle_seconds, wrapup_seconds, break_seconds, dead_seconds, utilization_pct, week_label, data_source,
   source_reference, upload_batch_id, created_by, created_at, updated_at
FROM mas_hrms.du_apr_daily_actual;
