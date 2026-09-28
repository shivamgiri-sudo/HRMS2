-- Bla Bli Blu's real "Auto Call Back CDR Inbound.xls" export -- an HTML-
-- table export (not a real workbook, same as sql/1739's DD Tagging file,
-- from the same local folder: rebla_bli_bludashboard_sop_formulation_
-- inboundabc_with_). This is a distinct event from the sibling "CDR Raw
-- Inbound.xls" (already confirmed a duplicate of dialer_db.cdr_in_10_4,
-- see sql/1739's comment) -- confirmed by direct comparison: the same
-- agent+phone+date (MAS60390/9122191422/2026-09-08) has a REAL completed
-- call in cdr_in_10_4 (557 seconds talk time, EndTime 10:14:32) and a
-- SEPARATE zero-duration "auto callback" record here (EndTime 10:15:26,
-- one minute later, Call Code 'A') -- a callback-attempt/scheduling log
-- entry, not a duplicate of the completed call. 50 real rows, all
-- 2026-09-08, all real Bla Bli Blu agents. Zero DB backing anywhere:
-- dialer_db's CDR tables carry only completed-call timing, nothing
-- resembling a distinct callback-attempt log with its own Call Code.
--
-- Row identity: (agent, phone_number, start_time) is unique across all
-- 50 real rows, zero collisions.
CREATE TABLE IF NOT EXISTS bla_bli_blu_auto_callback_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  agent_code VARCHAR(50) NOT NULL,
  phone_number VARCHAR(30) NOT NULL,
  call_date DATE NULL,
  call_code VARCHAR(20) NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NULL,
  length_seconds INT NULL,
  campaign VARCHAR(100) NULL,
  reason VARCHAR(100) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bla_bli_blu_auto_callback (process_id, agent_code, phone_number, start_time),
  KEY idx_bla_bli_blu_auto_callback_date (process_id, call_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'BLA_BLI_BLU_AUTO_CALLBACK';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'BLA_BLI_BLU_AUTO_CALLBACK', 'Bla Bli Blu — Auto Call Back CDR', 'bla_bli_blu_auto_callback_raw',
   'Bla Bli Blu''s real Auto Call Back CDR export (no DB backing exists) -- a distinct callback-attempt log, not a duplicate of the completed-call CDR.',
   JSON_ARRAY('Agent', 'Phone Number', 'Start Time'),
   JSON_ARRAY('Call Date', 'Call Code', 'End Time', 'Length (Sec)', 'Campaign', 'Reason'),
   JSON_OBJECT('Agent', 'MAS60390', 'Phone Number', '9122191422', 'Call Date', '2026-09-08',
     'Call Code', 'A', 'Start Time', '2026-09-08 10:15:26', 'Campaign', 'INBOUND', 'Reason', 'AGENT'),
   1);
