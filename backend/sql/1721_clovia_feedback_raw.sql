-- Clovia's own "Feedback" sheet -- found while auditing every sheet of the
-- same workbook family already used this session for Chat Performance/CRM
-- Disposition/Team Alignment/APR Utilization/IB+Outbound CDR Raw, not named
-- in Clovia Steps.docx's own SOP text, but real data with no DB backing
-- anywhere: a per-call post-call IVR CSAT/DSAT survey response, 275 real
-- rows in the sample file.
--
-- Row identity verified live across all 275 real rows with zero
-- collisions: (the sheet's own "Unique" column [Phone+Advisor Id
-- concatenation], Call Date) -- "Unique" alone collides 3 times (the same
-- advisor/phone pair can be surveyed on more than one call).
--
-- Call Date is a FRACTIONAL Excel serial (date + time-of-day), floored per
-- the clovia_crm_disposition convention (sql/1705); "Date" is a separate,
-- plain integer serial matching the report period. "C-SAT/D-SAT" arrives
-- as a 1.0/0.0 flag in the real sample (1 = Satisfied) alongside "Option"
-- (the survey's own free-text answer, e.g. "Satisfied"/"Not Satisfied") --
-- both kept, since Option carries the raw response and the flag is what a
-- CSAT% rollup actually sums.
CREATE TABLE IF NOT EXISTS clovia_feedback_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  call_date DATETIME NULL,
  unique_ref VARCHAR(100) NOT NULL,
  advisor_id VARCHAR(50) NULL,
  phone_number VARCHAR(50) NULL,
  language VARCHAR(50) NULL,
  survey_option VARCHAR(100) NULL,
  csat_flag TINYINT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clovia_feedback_raw (process_id, unique_ref, call_date, source_reference),
  KEY idx_clovia_feedback_raw_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'CLOVIA_FEEDBACK';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'CLOVIA_FEEDBACK', 'Clovia — Feedback (CSAT/DSAT)', 'clovia_feedback_raw',
   'Clovia''s own Feedback sheet: post-call IVR CSAT/DSAT survey responses (no DB backing exists).',
   JSON_ARRAY('Unique', 'Call_Date', 'Date'),
   JSON_ARRAY('Advisor_Id', 'Phone_Number', 'Language', 'Option', 'CSAT_DSAT'),
   JSON_OBJECT('Unique', '919689079997MAS62733', 'Call_Date', '2026-09-01 09:41:15', 'Date', '2026-09-01', 'Advisor_Id', 'MAS62733', 'Phone_Number', '919689079997', 'Language', 'Hindi', 'Option', 'Not Satisfied', 'CSAT_DSAT', 0),
   1);
