-- Dalmia Cement's own "Dalmia July'26.xlsx" MIS workbook's "IB CDR Raw"
-- sheet -- found while auditing every sheet of a real dashboard workbook
-- for this process, not backed by any database anywhere (checked across
-- every schema on both hosts: mas_hrms, dialer_db, db_masmis, db_external,
-- Shivamgiri, db_audit, onfido_db, bella_db -- zero "dalmia"-named tables
-- found). Real, current data: 966 rows, 2026-07-01 to 2026-07-14, real MAS
-- agent codes (e.g. MAS62620=BAGA LAXMAN RAO, matching employees exactly).
--
-- Row identity: (Agent Id, CallTime, Phone Number) -- one exact duplicate
-- row pair was found live (MAS62619/2026-07-06 16:09:02, byte-identical
-- in every column, a copy-paste artifact in the source sheet), handled by
-- ON DUPLICATE KEY UPDATE rather than treated as an error.
--
-- Scoped to the sheet's real, unambiguous columns. Dropped: "Time" is kept
-- separately from "CallTime" since they differ in 65/966 real rows (not a
-- duplicate); "Status" and "Abn" both collapse to the exact same 941/25
-- split as "Calling Status" (Connected/Not Connected) -- redundant 0/1
-- re-encodings of the same signal, dropped in favour of the human-readable
-- text column; "Call 20 Sec (SL)" (both copies), "Hours Slot", "Total
-- Handled Time", "Count1" (always 1), "Slot Time"/"15 Min Slot"/"Slot"
-- (redundant time-bucketing), "U/R" (duplicate of Unique/Repeat), and the
-- second "Count" column (an unlabelled 0/1 flag with no clear meaning)
-- are all dropped as either constant, redundant, or unexplained.
CREATE TABLE IF NOT EXISTS dalmia_ib_cdr_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  time_of_call DATETIME NULL,
  call_time DATETIME NOT NULL,
  agent_code VARCHAR(20) NULL,
  agent_name VARCHAR(150) NULL,
  campaign_name VARCHAR(100) NULL,
  phone_number VARCHAR(30) NULL,
  disposition VARCHAR(30) NULL,
  disconnected_by VARCHAR(30) NULL,
  call_duration_seconds INT NULL,
  queue_duration_seconds INT NULL,
  hold_time_seconds INT NULL,
  acw_duration_seconds INT NULL,
  end_time DATETIME NULL,
  call_count INT NULL,
  unique_repeat VARCHAR(20) NULL,
  is_short_call TINYINT(1) NULL,
  calling_status VARCHAR(30) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dalmia_ib_cdr_raw (process_id, agent_code, call_time, phone_number),
  KEY idx_dalmia_ib_cdr_raw_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'DALMIA_IB_CDR';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'DALMIA_IB_CDR', 'Dalmia Cement — IB CDR Raw', 'dalmia_ib_cdr_raw',
   'Dalmia Cement''s own IB CDR Raw sheet: per-call inbound CDR detail (no DB backing exists).',
   JSON_ARRAY('Agent Id', 'CallTime', 'CallDate'),
   JSON_ARRAY('Time', 'Name', 'Campname', 'Phone Number', 'Disposition', 'Disconn.By', 'Callduration',
     'Queue Duration', 'Hold Time', 'Acwduration (Wrapup or Dispo time)', 'End Time', 'Count',
     'Unique/Repeat', 'Short Calls', 'Calling  Status'),
   JSON_OBJECT('Agent Id', 'MAS62620', 'CallDate', '2026-07-01', 'CallTime', '2026-07-01 10:12:11',
     'Name', 'LAXMAN RAO', 'Campname', 'Dalmia_Hindi', 'Phone Number', '918658087241',
     'Disposition', 'NI', 'Calling  Status', 'Connected'),
   1);
