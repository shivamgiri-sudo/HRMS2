-- Bla Bli Blu's own "B-3 Dashboard" workbook family's "Overall Sales Raw"
-- sheet (BLA BLI BLU_Master_Dashboard Aug'26.xlsb, 2401 rows / 2400
-- non-blank, confirmed live 2026-09-10) is agent-attributed order-level
-- sales data with no DB backing anywhere -- checked against Shivamgiri,
-- dialer_db, db_masmis, db_external and mas_hrms per the discipline
-- adopted from the Finnable correction (db_masmis.bvo_order_export is a
-- similarly-shaped order export but for an entirely different brand,
-- "BVO", with no agent/MAS linkage -- not a match).
--
-- Row identity: the sheet's own "OrderID" column (e.g. "#BBB2484825") is
-- unique across all 2400 real non-blank rows with zero collisions and zero
-- blanks. 23 real EMP IDs sampled all resolve to real employees.employee_
-- code rows with matching names (e.g. MAS61416=ARUN JOSHI, MAS61459=
-- GUNGUN GAUTAM, matching the identity already confirmed for the CDR Raw
-- sheet, sql/1728).
--
-- alternate_number is VARCHAR(100), not a phone-number-sized column,
-- because one of the 9 real non-blank values in this sparse column is a
-- free-text remark ("Upgrade Email Chanel DND number") rather than a
-- number -- kept verbatim since it is genuine source data, not discarded.
--
-- Scoped to the sheet's real, unambiguous columns. Dropped: "Campagin" (a
-- header typo of "Campaign", always NULL in all 2400 rows -- a dead
-- duplicate column, not real data); "Diff" (always equals Order Creation
-- time minus Call Date & Time, a trivially re-derivable helper column, not
-- primary data); "For Unique sales" (always 1.0 across every row -- a
-- SUMPRODUCT-style helper flag for the sheet's own unique-count formula,
-- carries no information); "E-mail ID" (100% blank across all 2400 rows).
CREATE TABLE IF NOT EXISTS bla_bli_blu_overall_sales_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  order_id VARCHAR(50) NOT NULL,
  report_date DATE NOT NULL,
  week_label VARCHAR(20) NULL,
  emp_code VARCHAR(20) NULL,
  emp_name VARCHAR(150) NULL,
  customer_number VARCHAR(30) NULL,
  alternate_number VARCHAR(100) NULL,
  payment_status VARCHAR(30) NULL,
  amount DECIMAL(12,2) NULL,
  campaign VARCHAR(50) NULL,
  calling_status VARCHAR(50) NULL,
  discount_code VARCHAR(50) NULL,
  item_count DECIMAL(8,2) NULL,
  current_status VARCHAR(50) NULL,
  lineitem_sku VARCHAR(100) NULL,
  new_sold_line_item VARCHAR(255) NULL,
  new_sold_line_item_category VARCHAR(100) NULL,
  lead_line_item VARCHAR(100) NULL,
  source_channel VARCHAR(50) NULL,
  business_type VARCHAR(50) NULL,
  order_creation_time DATETIME NULL,
  call_date_time DATETIME NULL,
  call_duration_seconds INT NULL,
  call_attempt_count INT NULL,
  source_created_by VARCHAR(150) NULL,
  recording_link VARCHAR(500) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bla_bli_blu_sales_order (process_id, order_id),
  KEY idx_bla_bli_blu_sales_date (report_date),
  KEY idx_bla_bli_blu_sales_emp (emp_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'BLA_BLI_BLU_OVERALL_SALES';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'BLA_BLI_BLU_OVERALL_SALES', 'Bla Bli Blu — Overall Sales Raw', 'bla_bli_blu_overall_sales_raw',
   'Bla Bli Blu''s own Overall Sales Raw sheet: agent-attributed order-level sales (no DB backing exists).',
   JSON_ARRAY('OrderID', 'Date'),
   JSON_ARRAY('Week', 'EMP ID', 'Emp_Name', 'Customer Number', 'Alternate number', 'Payment Status', 'Amount',
     'Campaign', 'Calling Status', 'Discount Code', 'Count', 'Current Status', 'Lineitem sku',
     'New sold line item', 'New sold line item Categoty', 'Lead_Line_Item', 'Source', 'Business',
     'Order Creation time', 'Call Date & Time', 'Call Duration', 'Countifs of calls', 'Created By', 'Recording Link'),
   JSON_OBJECT('OrderID', '#BBB2484825', 'Date', '2026-08-01', 'EMP ID', 'MAS61416', 'Emp_Name', 'ARUN JOSHI',
     'Payment Status', 'Paid', 'Amount', '1041', 'Campaign', 'Inbound', 'Calling Status', 'Sale Done'),
   1);
