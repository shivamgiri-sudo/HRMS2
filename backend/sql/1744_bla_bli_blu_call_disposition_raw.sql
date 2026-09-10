-- Bla Bli Blu's real Smartping CDR export ("CDR ABC_Cart Sales.csv" /
-- byte-identical "Data For call Received from client ABC_Cart Sales.csv",
-- confirmed via md5sum) -- NOT a new CDR table: the call metadata itself
-- (timing, agent, phone, queue) is already live in dialer_db.cdr_bla_bli_
-- blu (321,917 rows through 2026-09-09), confirmed by exact match on this
-- file's own "Session Id" column against that table's call_uuid column
-- (id 319085, MAS61344/NAEEM SAIFI, phone 919699434443, 2026-09-08
-- 13:19:21 -- matches exactly).
--
-- What IS a genuine, verified gap: cdr_bla_bli_blu's disposition/
-- sub_disposition_1..5 columns are 0% filled for every row in September
-- 2026 (checked directly: 0 of 26,482 rows have a non-blank disposition)
-- -- meaning the live sync never captures call OUTCOME (Sale Done,
-- payment mode, QA rating, agent remarks), even though this raw website
-- export has it. dialer_db is a read-only upstream source (SELECT-only
-- grant, confirmed) -- we cannot write disposition data back into it, so
-- this lands as its own enrichment table, joined to the live CDR by
-- call_uuid rather than duplicating call metadata a second time.
--
-- Kept only the genuine enrichment columns (disposition taxonomy, agent
-- remarks, recording/QA fields, team lead) -- dropped every column that
-- duplicates data already live in cdr_bla_bli_blu (durations, hangup
-- causes, queue timing, etc.), same discipline as every other
-- duplication check this session.
--
-- Row identity: the sheet's own "Session Id" is unique across all 17,238
-- real rows, zero collisions -- and is the same value as
-- dialer_db.cdr_bla_bli_blu.call_uuid, so this table can be joined to the
-- live CDR by that column without ever writing into dialer_db itself.
--
-- crm_form is TEXT, not VARCHAR(255) as first declared: the real import
-- run hit ER_DATA_TOO_LONG on every single row -- "CRM Form" carries a
-- full customer/order summary (name, email, delivery date, line items,
-- address) up to 570 real characters, not a short label. Live table
-- ALTERed to TEXT before the real import completed.
CREATE TABLE IF NOT EXISTS bla_bli_blu_call_disposition_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  call_uuid VARCHAR(100) NOT NULL,
  call_date_time DATETIME NULL,
  customer_number VARCHAR(30) NULL,
  agent_code VARCHAR(50) NULL,
  agent_name VARCHAR(255) NULL,
  campaign_name VARCHAR(255) NULL,
  queue_name VARCHAR(255) NULL,
  campaign_type VARCHAR(100) NULL,
  disposition_l1 VARCHAR(100) NULL,
  disposition_l2 VARCHAR(100) NULL,
  disposition_l3 VARCHAR(100) NULL,
  disposition_l4 VARCHAR(100) NULL,
  remarks TEXT NULL,
  recording_url VARCHAR(500) NULL,
  team_lead VARCHAR(255) NULL,
  call_rating VARCHAR(20) NULL,
  recording_rating VARCHAR(20) NULL,
  recording_remarks TEXT NULL,
  evaluation_form VARCHAR(255) NULL,
  script VARCHAR(255) NULL,
  knowledge_base VARCHAR(255) NULL,
  crm_form TEXT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bla_bli_blu_call_disposition (process_id, call_uuid),
  KEY idx_bla_bli_blu_call_disposition_date (process_id, call_date_time),
  KEY idx_bla_bli_blu_call_disposition_l1 (disposition_l1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'BLA_BLI_BLU_CALL_DISPOSITION';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'BLA_BLI_BLU_CALL_DISPOSITION', 'Bla Bli Blu — Call Disposition (ABC_Cart Sales CDR)', 'bla_bli_blu_call_disposition_raw',
   'Bla Bli Blu''s real Smartping CDR export -- captures ONLY the disposition/outcome fields the live dialer_db sync never fills, joined by Session Id = call_uuid.',
   JSON_ARRAY('Session Id'),
   JSON_ARRAY('Date & Time', 'Customer Number', 'Agent ID', 'Agent Name', 'Campaign Name', 'Queue',
     'Campaign Type', 'Disposition - L1', 'Disposition - L2', 'Disposition - L3', 'Disposition - L4',
     'Remarks', 'Recording', 'Team Lead', 'Call Rating', 'Recording Rating', 'Recording Remarks',
     'Evaluation Form', 'Script', 'Knowledge Base', 'CRM Form'),
   JSON_OBJECT('Session Id', 'b41d0ef4-d5f3-4f81-962a-5b139d86fcf4', 'Date & Time', '08-09-26 18:50',
     'Agent ID', 'MAS63266', 'Disposition - L1', 'Connected', 'Disposition - L2', 'Sale Done'),
   1);
