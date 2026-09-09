-- Clovia's own "Rechurn Calls" sheet -- found while auditing every sheet of
-- the same workbook family already used this session for Chat Performance/
-- CRM Disposition/Team Alignment/APR Utilization/IB+Outbound CDR Raw/
-- Feedback, not named in Clovia Steps.docx's own SOP text, but real data
-- with no DB backing anywhere: abandoned-call rechurn/follow-up tracking,
-- 125 real rows in the sample file.
--
-- Row identity verified live across all 125 real rows with zero
-- collisions: (Phone Number, Abandoned Date) -- the same phone number can
-- recur with different statuses ("Press 2"/"Abandon") at close but
-- distinct Call Date/Abandoned Date timestamps, a genuine multi-attempt
-- retry pattern, not a duplicate.
--
-- Call Date/Abandoned Date are FRACTIONAL Excel serials (date +
-- time-of-day), floored per the clovia_crm_disposition convention
-- (sql/1705).
CREATE TABLE IF NOT EXISTS clovia_rechurn_calls_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  agent_code VARCHAR(50) NULL,
  phone_number VARCHAR(50) NOT NULL,
  call_date DATETIME NULL,
  abandoned_date DATETIME NOT NULL,
  status VARCHAR(50) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clovia_rechurn_calls_raw (process_id, phone_number, abandoned_date, source_reference),
  KEY idx_clovia_rechurn_calls_raw_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'CLOVIA_RECHURN_CALLS';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'CLOVIA_RECHURN_CALLS', 'Clovia — Rechurn Calls', 'clovia_rechurn_calls_raw',
   'Clovia''s own Rechurn Calls sheet: abandoned-call rechurn/follow-up tracking (no DB backing exists).',
   JSON_ARRAY('Phone_Number', 'Abandoned_Date', 'Date'),
   JSON_ARRAY('Agent', 'Call_Date', 'Status'),
   JSON_OBJECT('Phone_Number', '919322458551', 'Abandoned_Date', '2026-09-01 11:42:39', 'Date', '2026-09-01', 'Agent', 'MAS62105', 'Call_Date', '2026-09-01 11:54:07', 'Status', 'Press 2'),
   1);
