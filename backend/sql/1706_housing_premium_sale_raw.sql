-- Housing Premium's "Sale Raw" (per its own SOP: "Open the Sale Raw Google
-- Sheet... paste the data into the Sale Raw sheet", no exact columns given,
-- no DB backing) -- a real sample was found and read directly via Chrome:
-- "Housing Premium MIS Dashboard Aug'26 (1).xlsb", sheet "Sale Raw".
--
-- Two different date-like columns exist in the source: "Created_At" (a much
-- earlier date -- 2026-01-08 in the sample row, likely the original lead's
-- creation date) and "Date" (2026-08-01, matching the "Aug'26" filename --
-- confirmed as the real sale/reporting date). report_date here is the
-- latter; created_at is kept as an optional secondary field, not the
-- reporting anchor.
CREATE TABLE IF NOT EXISTS housing_premium_sale_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  order_id VARCHAR(50) NOT NULL,
  report_date DATE NOT NULL,
  created_at_orig DATE NULL,
  agent_name VARCHAR(255) NULL,
  tl_name VARCHAR(255) NULL,
  partner_name VARCHAR(255) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  order_value DECIMAL(12,2) NULL,
  target DECIMAL(12,2) NULL,
  week_label VARCHAR(20) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_housing_premium_sale_raw (process_id, order_id, source_reference),
  KEY idx_housing_premium_sale_raw_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'HOUSING_PREMIUM_SALE_RAW';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES
(UUID(), 'HOUSING_PREMIUM_SALE_RAW', 'Housing Premium Sale Raw',
 'housing_premium_sale_raw',
 'Per-order sales data for Housing Premium (per its SOP: "Sale Raw" sheet -- no exact columns given there, no DB backing). Columns taken verbatim from the live "Housing Premium MIS Dashboard Aug''26 (1).xlsb" workbook, Sale Raw sheet.',
 JSON_ARRAY('Order_ID','Date','Amount'),
 JSON_ARRAY('Created_At','Agent_Name','TL_Name','Partner_Name','Order_Value','Target','Week'),
 JSON_OBJECT(
   'Order_ID','637616401253',
   'Date','2026-08-01',
   'Created_At','2026-01-08',
   'Agent_Name','Kushal Upadhyay',
   'TL_Name','Arbaz Khan',
   'Partner_Name','Mas Callnet',
   'Amount','1074',
   'Order_Value','1074',
   'Target','1528',
   'Week','Week-1'
 ), 1);
