-- Housing Premium's own "CDR" sheet -- found while auditing every sheet of
-- the same real workbook already downloaded this session for Sale Raw
-- (sql/1706), not named in Housing Premium's own SOP text, but real data
-- with no DB backing anywhere: a full outbound call log, 194,546 real rows
-- in the sample file, current to the file's own "Aug'26" period.
--
-- Scoped down from the source's full 18 columns to the ones a KPI actually
-- needs (call identity, agent, timing, outcome) -- Routing Numbers/Routing
-- Status/Start Time (frequently blank)/Time (a redundant hour marker)/
-- Count/Unique Count/"V+W" (unclear semantics)/Talk Time (a day-fraction
-- duplicate of Talk Duration, which already arrives in plain seconds) are
-- left out deliberately, same reasoning as clovia_crm_disposition (sql/1705).
--
-- Row identity verified live across all 194,546 real rows with zero
-- collisions: (Date, "Date row Count") -- the sheet's own per-date running
-- counter. CALLER+MEMBER+End Time alone collides (two rows can share an
-- identical phone/agent/timestamp with a different DURATION -- a
-- re-attempt logged at the same second), so those are not the key.
CREATE TABLE IF NOT EXISTS housing_premium_cdr_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  date_row_count INT NOT NULL,
  caller_number VARCHAR(50) NULL,
  agent_name VARCHAR(255) NULL,
  tl_name VARCHAR(255) NULL,
  end_time DATETIME NULL,
  duration_seconds INT NULL,
  talk_duration_seconds INT NULL,
  ringing_duration_seconds INT NULL,
  status VARCHAR(100) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_housing_premium_cdr_raw (process_id, report_date, date_row_count, source_reference),
  KEY idx_housing_premium_cdr_raw_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'HOUSING_PREMIUM_CDR';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'HOUSING_PREMIUM_CDR', 'Housing Premium — CDR', 'housing_premium_cdr_raw',
   'Housing Premium''s own CDR sheet: full outbound call log (no DB backing exists).',
   JSON_ARRAY('Date', 'Date_Row_Count'),
   JSON_ARRAY('CALLER', 'MEMBER', 'TL_Name', 'End_Time', 'DURATION', 'Talk_Duration', 'Ringing_Duration', 'STATUS'),
   JSON_OBJECT('Date', '2026-08-01', 'Date_Row_Count', 1, 'CALLER', '8910313594', 'MEMBER', 'Waqif Hussain', 'TL_Name', 'Arbaz', 'End_Time', '2026-08-01 19:35:34', 'DURATION', 4, 'Talk_Duration', 0, 'Ringing_Duration', 4, 'STATUS', 'No Answered'),
   1);
