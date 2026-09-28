-- Bla Bli Blu's "DD tagging (Dial Desk)" export -- a real inbound complaint/
-- query/ticket log downloaded straight from the DialDesk ticketing website
-- (folder: rebla_bli_bludashboard_sop_formulation_inboundabc_with_, found
-- alongside CDR Raw Inbound.xls/Auto Call Back CDR Inbound.xls/afterhrdata
-- Inbound.xls -- all real per-agent Dial Desk exports for the same
-- "Blabliblu_IN"/"INBOUND" queue). One row per ticket: scenario/sub-
-- scenario classification, customer feedback, agent remarks, case
-- lifecycle (created/closed/follow-up/TAT/due date), all tied to a real
-- agent via the "Call Created" column ("DialDesk - MAS60037" etc).
--
-- Confirmed zero DB backing: neither db_masmis (CR_* staging tables carry
-- only call metadata, no ticket/complaint fields) nor dialer_db's CDR
-- tables (cdr_in_10_4 etc, which carry only call timing/disposition, no
-- SCENARIO/SUB SCENARIO/Customer Feedback/Case Close By/Ticket Status)
-- have anything resembling this ticket-level complaint taxonomy. 178 real
-- rows, all 2026-09-08, all against real agents (MAS60037, MAS60390,
-- MAS61416, MAS62989).
--
-- Row identity: the sheet's own "Call Id" is unique across all 178 rows.
-- Agent code is parsed out of "Call Created" ("DialDesk - MAS60037" ->
-- "MAS60037") since that is the only column carrying it.
CREATE TABLE IF NOT EXISTS bla_bli_blu_dd_tagging_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  call_id VARCHAR(64) NOT NULL,
  phone_number VARCHAR(30) NULL,
  scenario VARCHAR(100) NULL,
  sub_scenario_1 VARCHAR(255) NULL,
  sub_scenario_2 VARCHAR(255) NULL,
  sub_scenario_3 VARCHAR(255) NULL,
  customer_name VARCHAR(255) NULL,
  awb_logistic VARCHAR(100) NULL,
  order_id VARCHAR(64) NULL,
  email VARCHAR(255) NULL,
  product_name VARCHAR(255) NULL,
  sale_amount DECIMAL(12,2) NULL,
  category VARCHAR(100) NULL,
  call_direction VARCHAR(30) NULL,
  customer_feedback TEXT NULL,
  payment_mode VARCHAR(50) NULL,
  agent_remarks TEXT NULL,
  call_date DATETIME NULL,
  call_action VARCHAR(100) NULL,
  call_sub_action VARCHAR(100) NULL,
  call_action_remarks TEXT NULL,
  closer_date DATETIME NULL,
  follow_up_date DATETIME NULL,
  case_close_by VARCHAR(100) NULL,
  tat VARCHAR(50) NULL,
  due_date DATETIME NULL,
  agent_code VARCHAR(50) NULL,
  call_status VARCHAR(50) NULL,
  ticket_status VARCHAR(50) NULL,
  remarks TEXT NULL,
  damage_product_name VARCHAR(255) NULL,
  closer_time_seconds INT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bla_bli_blu_dd_tagging (process_id, call_id),
  KEY idx_bla_bli_blu_dd_tagging_date (process_id, call_date),
  KEY idx_bla_bli_blu_dd_tagging_scenario (scenario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'BLA_BLI_BLU_DD_TAGGING';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'BLA_BLI_BLU_DD_TAGGING', 'Bla Bli Blu — DD Tagging (Dial Desk)', 'bla_bli_blu_dd_tagging_raw',
   'Bla Bli Blu''s real Dial Desk complaint/query ticket export (no DB backing exists).',
   JSON_ARRAY('Call Id', 'CallDate'),
   JSON_ARRAY('IN CALL FROM', 'SCENARIO', 'SUB SCENARIO 1', 'SUB SCENARIO 2', 'SUB SCENARIO 3', 'Customer Name',
     'AWB Logistic', 'BBB Oder ID', 'Email ID', 'Product Name', 'Sale Amt with GST', 'Category', 'Call From',
     'Customer Feedback', 'Payment Mode', 'Agent Remarks', 'Call Action', 'Call Sub Action', 'Call Action Remarks',
     'Closer Date', 'Follow Up Date', 'Case Close By', 'TAT', 'Due Date', 'Call Created', 'Call Status',
     'Ticket Status', 'Remarks', 'Damage Product Name', 'Closer Time'),
   JSON_OBJECT('Call Id', '63304', 'CallDate', '2026-09-08 10:14:53', 'SCENARIO', 'Complaint',
     'SUB SCENARIO 1', 'Wrong Product Delivered/ Missing Item', 'BBB Oder ID', 'BBB2553146',
     'Call Created', 'DialDesk - MAS60037'),
   1);
