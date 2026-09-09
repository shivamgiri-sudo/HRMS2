-- Clovia's own "IB CDR Raw" sheet -- found while auditing every sheet of
-- the same workbook family already used this session for Chat Performance/
-- CRM Disposition/Team Alignment/APR Utilization, not named in Clovia
-- Steps.docx's own SOP text, but real data with no DB backing anywhere: a
-- full inbound call log, 1,627 real rows in the sample file.
--
-- Scoped down from the source's full 29 columns to the ones a KPI actually
-- needs -- the several redundant slot/count columns the sheet's own pivot
-- views build on (Hours Slot, Total Handled Time, Call 20/10 Sec (SL),
-- Short Calls, Slot Time, Count1, "15 Min Slot", second "Count", "U/R",
-- Slot) are left out deliberately, same reasoning as clovia_crm_disposition
-- (sql/1705).
--
-- Row identity verified live across all 1,627 real rows with zero
-- collisions: (Phone Number, CallTime, Agent Id, "Count") -- Phone+CallTime
-- alone collides 3 times, and even adding Agent Id still collides: the raw
-- export contains genuine duplicate rows for the same physical call, one
-- tagged "Unique" and one "Repeat" (the sheet's own Count column, 1 vs 2,
-- is what actually tells them apart).
CREATE TABLE IF NOT EXISTS clovia_ib_cdr_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  call_time DATETIME NULL,
  agent_code VARCHAR(50) NULL,
  agent_name VARCHAR(255) NULL,
  call_type VARCHAR(50) NULL,
  campaign VARCHAR(100) NULL,
  phone_number VARCHAR(50) NOT NULL,
  disposition VARCHAR(50) NULL,
  disconn_by VARCHAR(50) NULL,
  call_duration_seconds INT NULL,
  queue_duration_seconds INT NULL,
  hold_time_seconds INT NULL,
  acw_duration_seconds INT NULL,
  unique_or_repeat VARCHAR(20) NULL,
  status VARCHAR(50) NULL,
  row_count INT NOT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clovia_ib_cdr_raw (process_id, phone_number, call_time, agent_code, row_count, source_reference),
  KEY idx_clovia_ib_cdr_raw_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'CLOVIA_IB_CDR';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'CLOVIA_IB_CDR', 'Clovia — Inbound CDR', 'clovia_ib_cdr_raw',
   'Clovia''s own IB CDR Raw sheet: full inbound call log (no DB backing exists).',
   JSON_ARRAY('Phone_Number', 'CallTime', 'Agent_Id', 'Count'),
   JSON_ARRAY('Name', 'Calltype', 'Campname', 'Disposition', 'Disconn_By', 'Callduration', 'Queue_Duration', 'Hold_Time', 'ACW_Duration', 'Unique_Repeat', 'Status', 'CallDate'),
   JSON_OBJECT('Phone_Number', '918887831178', 'CallTime', '2026-09-01 09:31:43', 'Agent_Id', 'MAS62105', 'Count', 1, 'Name', 'SHUBHA JAIN SHARMA', 'Calltype', 'Inbound', 'Campname', 'Clovia_Hindi', 'Disposition', 'A', 'Disconn_By', 'AGENT', 'Callduration', 184, 'Queue_Duration', 0, 'ACW_Duration', 58, 'Unique_Repeat', 'Unique', 'Status', 1, 'CallDate', '2026-09-01'),
   1);
