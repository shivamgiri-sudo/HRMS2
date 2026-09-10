-- Dalmia Cement's own "Dalmia July'26.xlsx" MIS workbook's "DD Raw" sheet
-- (Disposition Detail) -- a dealer/customer lead management log, found
-- while auditing the same workbook as sql/1730's IB CDR Raw. No DB backing
-- exists anywhere (same cross-schema check as sql/1730). Real, current
-- data: 1568 rows, 2026-07-01 to 2026-07-14.
--
-- Row identity: the sheet's own "Call Id" is unique across all 1568 real
-- rows with zero collisions and zero blanks.
--
-- Dropped as 100% empty across all 1568 rows: "SUB SCENARIO 4", "Call Sub
-- Action", "Call Action Remarks", "Follow Up Date", "Case Close By", "TAT",
-- "Due Date", "Call Status".
CREATE TABLE IF NOT EXISTS dalmia_dd_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  call_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  in_call_from VARCHAR(30) NULL,
  scenario VARCHAR(50) NULL,
  sub_scenario_1 VARCHAR(100) NULL,
  sub_scenario_2 VARCHAR(100) NULL,
  sub_scenario_3 VARCHAR(100) NULL,
  caller_type VARCHAR(50) NULL,
  suggestion_feedback TEXT NULL,
  status VARCHAR(30) NULL,
  nftr_ftr VARCHAR(20) NULL,
  source_of_lead VARCHAR(50) NULL,
  mobile_no VARCHAR(30) NULL,
  alternate_number VARCHAR(30) NULL,
  pincode VARCHAR(20) NULL,
  no_of_bags VARCHAR(50) NULL,
  region VARCHAR(100) NULL,
  customer_name VARCHAR(150) NULL,
  firm_name VARCHAR(150) NULL,
  gstin_number VARCHAR(30) NULL,
  city VARCHAR(100) NULL,
  district VARCHAR(100) NULL,
  state VARCHAR(100) NULL,
  customer_remarks TEXT NULL,
  email_id VARCHAR(150) NULL,
  when_cement_required VARCHAR(100) NULL,
  call_date DATETIME NULL,
  call_action VARCHAR(100) NULL,
  closer_date DATETIME NULL,
  call_created VARCHAR(150) NULL,
  closer_time DATETIME NULL,
  type_of_leads VARCHAR(50) NULL,
  leads VARCHAR(50) NULL,
  mt VARCHAR(50) NULL,
  converted VARCHAR(50) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dalmia_dd_raw_call_id (process_id, call_id),
  KEY idx_dalmia_dd_raw_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'DALMIA_DD_RAW';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'DALMIA_DD_RAW', 'Dalmia Cement — DD Raw (Disposition Detail)', 'dalmia_dd_raw',
   'Dalmia Cement''s own DD Raw sheet: dealer/customer lead management log (no DB backing exists).',
   JSON_ARRAY('Call Id', 'CallDate'),
   JSON_ARRAY('IN CALL FROM', 'SCENARIO', 'SUB SCENARIO 1', 'SUB SCENARIO 2', 'SUB SCENARIO 3', 'Caller Type',
     'Suggestion/Feedback', 'Status', 'NFTR/FTR', 'Source of Lead', 'Mobile No', 'Alternate Number', 'Pincode',
     'No. Of Bags', 'Region', 'Customer Name', 'Firm Name', 'GSTIN NUMBER', 'City', 'District', 'State',
     'Customer Remarks', 'E-Mail ID', 'When cement is Required', 'Call Action', 'Closer Date', 'Call Created',
     'Closer Time', 'Type Of Leads', 'Leads', 'MT', 'Converted'),
   JSON_OBJECT('Call Id', '158792', 'CallDate', '2026-07-01 10:12:47', 'IN CALL FROM', '8658087241',
     'SCENARIO', 'Contact', 'Status', 'Closed', 'NFTR/FTR', 'FTR', 'Source of Lead', 'Inbound'),
   1);
