-- Clovia's own "Outbound Report" sheet -- found while auditing every sheet
-- of the same workbook family already used this session for Chat
-- Performance/CRM Disposition/Team Alignment/APR Utilization/IB CDR Raw,
-- not named in Clovia Steps.docx's own SOP text, but real data with no DB
-- backing anywhere: a full outbound call log, 1,317 real rows in the
-- sample file.
--
-- Row identity verified live across all 1,317 real rows with zero
-- collisions: (UAN, Count) -- the sheet's own "UAN" column (a
-- phone+date concatenation) alone collides 48 times, same "genuine
-- duplicate raw export row" pattern already found in IB CDR Raw (sql/1719)
-- -- "Count" (1 vs 2) is what actually tells the duplicates apart.
--
-- Length (Sec) arrives already in plain seconds in the real sample (24.0),
-- unlike Start Time/End Time, which are FRACTIONAL Excel serials (date +
-- time-of-day), same convention as clovia_crm_disposition (sql/1705).
CREATE TABLE IF NOT EXISTS clovia_outbound_cdr_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  agent_code VARCHAR(50) NULL,
  phone_number VARCHAR(50) NULL,
  call_code VARCHAR(20) NULL,
  start_time DATETIME NULL,
  end_time DATETIME NULL,
  length_seconds INT NULL,
  campaign VARCHAR(100) NULL,
  reason VARCHAR(100) NULL,
  status VARCHAR(50) NULL,
  uan VARCHAR(100) NOT NULL,
  row_count INT NOT NULL,
  unique_or_repeat VARCHAR(20) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clovia_outbound_cdr_raw (process_id, uan, row_count, source_reference),
  KEY idx_clovia_outbound_cdr_raw_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'CLOVIA_OUTBOUND_CDR';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'CLOVIA_OUTBOUND_CDR', 'Clovia — Outbound CDR', 'clovia_outbound_cdr_raw',
   'Clovia''s own Outbound Report sheet: full outbound call log (no DB backing exists).',
   JSON_ARRAY('UAN', 'Count', 'Call_Date'),
   JSON_ARRAY('Agent', 'Phone_Number', 'Call_Code', 'Start_Time', 'End_Time', 'Length_Sec', 'Campaign', 'Reason', 'Status', 'U_R'),
   JSON_OBJECT('UAN', '900443887046266', 'Count', 1, 'Call_Date', '2026-09-01', 'Agent', 'MAS59259', 'Phone_Number', '9004438870', 'Call_Code', 'A', 'Start_Time', '2026-09-01 10:33:58', 'End_Time', '2026-09-01 10:34:22', 'Length_Sec', 24, 'Campaign', 'OUTBOUND', 'Reason', 'CALLER', 'Status', 'Connected', 'U_R', 'Unique'),
   1);
