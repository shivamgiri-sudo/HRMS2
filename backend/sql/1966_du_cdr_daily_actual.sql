-- DU Digital's "CDR Raw" sheet (Export Calls Report from the DU dialer,
-- dudigital.par-infinity.com -- a vicidial instance), Korea and Thailand
-- dashboards. Mirrors du_apr_daily_actual's own doc (sql/1710) and
-- dashboard_label split: same "DU Digital" process, one row per real call.
--
-- Columns read directly from both reference workbooks' own "CDR Raw" sheet
-- (confirmed live 2026-10-01, both the Korea and Thailand MIS Dashboard
-- Oct'26.xlsb files): call_date, phone_number_dialed, status, user,
-- full_name, campaign_id, user_group, length_in_sec, entry_date,
-- status_name, queue_time, uniqueid are the same raw vicidial export
-- columns in both countries (Thailand's sheet additionally carries a
-- couple of display-only derived columns the dashboard formulas add after
-- pasting -- Hour (THA)/Date/Temp/Agent Name -- which are NOT part of the
-- real export and are recomputed here instead, not imported).
--
-- queue_time (seconds the call waited before being answered) is what the
-- dashboard's "Answered Within 20 Sec" / SL% actually key off -- confirmed
-- against the reference workbook: "Call Answered" (66) vs "Answered Within
-- 20 Sec" (64) differ by exactly the count of answered calls whose queue
-- wait exceeded 20s, not by call duration.
--
-- uniqueid is vicidial's own per-call identifier -- the natural, reliable
-- de-dup key for a re-uploaded or overlapping-range export, the same role
-- Pre_cdr's own CALLER+timestamps combination plays informally elsewhere.
CREATE TABLE IF NOT EXISTS du_cdr_daily_actual (
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

DELETE FROM upload_template_master WHERE upload_type_code IN ('DU_CDR_KOREA', 'DU_CDR_THAILAND');

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'DU_CDR_KOREA', 'DU Digital — CDR (Korea)', 'du_cdr_daily_actual',
   'DU Digital''s Export Calls Report, Korea dashboard, per its own SOP CDR Raw sheet (no DB backing existed before this).',
   JSON_ARRAY('uniqueid', 'call_date', 'status'),
   JSON_ARRAY('entry_date', 'user', 'full_name', 'phone_number_dialed', 'campaign_id', 'user_group', 'status_name', 'length_in_sec', 'queue_time'),
   JSON_OBJECT('uniqueid', '1790819000.1234', 'call_date', '2026-10-01', 'status', 'A', 'user', 'Agent7004', 'full_name', 'Agent7004', 'campaign_id', 'South_Korea_IB', 'user_group', 'SouthKoreaKorean', 'status_name', 'Answering Machine', 'length_in_sec', 8, 'queue_time', 11),
   1),
  (UUID(), 'DU_CDR_THAILAND', 'DU Digital — CDR (Thailand)', 'du_cdr_daily_actual',
   'DU Digital''s Export Calls Report, Thailand dashboard, per its own SOP CDR Raw sheet (no DB backing existed before this).',
   JSON_ARRAY('uniqueid', 'call_date', 'status'),
   JSON_ARRAY('entry_date', 'user', 'full_name', 'phone_number_dialed', 'campaign_id', 'user_group', 'status_name', 'length_in_sec', 'queue_time'),
   JSON_OBJECT('uniqueid', '1790819000.5678', 'call_date', '2026-10-01', 'status', 'A', 'user', 'Agent7006', 'full_name', 'Montri', 'campaign_id', 'ThailandThai', 'user_group', 'Thailand', 'status_name', 'Answering Machine', 'length_in_sec', 20, 'queue_time', 8),
   1);
