-- Migration 2155: AHM call-attempt log (every dial, not just the order/survey outcome) + the metric codes built on it.
-- Source of GPI's EC% (Effective Call), PC% (Productive Call) and Incoming %; Lines Cut comes from ahm_dump_raw. The file's exact
-- header names were not known when this shipped, so the importer (ahm-call-log-bulk.service.ts) matches headers tolerantly and
-- classifies each call once at import (is_connected / is_productive / is_incoming, NULL = the file did not say).
-- mas_hrms table, so the app user can create it (unlike db_masmis). Additive: new table, INSERT IGNORE metrics, one template row.
CREATE TABLE IF NOT EXISTS ahm_call_log (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  call_key CHAR(40) NOT NULL,
  call_time DATETIME NOT NULL,
  call_date DATE NOT NULL,
  telesales_id VARCHAR(60) NOT NULL,
  outlet_id VARCHAR(60) NULL,
  phone VARCHAR(30) NULL,
  call_type VARCHAR(30) NULL,
  call_status VARCHAR(80) NULL,
  disposition VARCHAR(120) NULL,
  duration_sec INT NULL,
  is_connected TINYINT NULL,
  is_productive TINYINT NULL,
  is_incoming TINYINT NULL,
  zone VARCHAR(100) NULL,
  region VARCHAR(100) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ahm_call_key (call_key),
  KEY idx_ahm_call_date (call_date),
  KEY idx_ahm_call_agent (telesales_id, call_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO kpi_metric_master
  (id, metric_code, metric_name, category, family, unit, direction, aggregation_method, active_status)
VALUES
  (UUID(), 'AHM_CALLS',             'AHM calls made',                 'operations', 'volume', 'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'AHM_EC_PCT',            'AHM effective call (EC) %',      'operations', 'rate',   'percent', 'higher_is_better', 'average', 1),
  (UUID(), 'AHM_PC_PCT',            'AHM productive call (PC) %',     'sales',      'rate',   'percent', 'higher_is_better', 'average', 1),
  (UUID(), 'AHM_INCOMING_PCT',      'AHM incoming call %',            'operations', 'rate',   'percent', 'higher_is_better', 'average', 1),
  (UUID(), 'AHM_LINES_CUT',         'AHM lines cut (order lines)',    'sales',      'volume', 'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'AHM_LINES_PER_ORDER',   'AHM lines per order',            'sales',      'rate',   'count',   'higher_is_better', 'average', 1);

DELETE FROM upload_template_master WHERE upload_type_code = 'AHM_CALLS';
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'AHM_CALLS', 'AHM — Call log', 'ahm_call_log',
   'AHM call-attempt log: one row per dial by a telesales agent. Drives EC %, PC % and Incoming %. Headers are matched loosely (Call Date / Telesales ID / Outlet ID / Call Type / Call Status / Disposition / Duration).',
   JSON_ARRAY(),
   JSON_ARRAY('Call Date', 'Call Time', 'Telesales ID', 'Agent ID', 'Outlet ID', 'Phone Number', 'Call Type', 'Direction',
     'Call Status', 'Disposition', 'Duration', 'Talk Time', 'Productive', 'Zone', 'Region'),
   JSON_OBJECT('Call Date', '2026-10-02 10:15:00', 'Telesales ID', 'rajuditc01', 'Outlet ID', 'B01812162045',
     'Phone Number', '9876543210', 'Call Type', 'Outgoing', 'Call Status', 'Connected', 'Disposition', 'Survey Taken', 'Duration', '85'),
   1);
