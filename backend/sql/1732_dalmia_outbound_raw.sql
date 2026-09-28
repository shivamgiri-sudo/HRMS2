-- Dalmia Cement's own "Dalmia July'26.xlsx" MIS workbook's "Outbound "
-- sheet -- a website/careers enquiry log (Contact/Dealership/Careers
-- enquiries assigned for outbound follow-up calling), found while
-- auditing the same workbook as sql/1730-1731. No DB backing exists
-- anywhere (same cross-schema check). Real, current data: 529 rows,
-- 2026-07-01 to 2026-07-13.
--
-- Row identity: the sheet's own "ID" is unique across all 529 real rows
-- with zero collisions.
CREATE TABLE IF NOT EXISTS dalmia_outbound_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  source_row_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  customer_name VARCHAR(150) NULL,
  email VARCHAR(150) NULL,
  mobile VARCHAR(30) NULL,
  enquiry_for VARCHAR(100) NULL,
  message TEXT NULL,
  enquiry_date VARCHAR(50) NULL,
  status VARCHAR(50) NULL,
  remarks TEXT NULL,
  source_of_lead VARCHAR(50) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dalmia_outbound_raw_id (process_id, source_row_id),
  KEY idx_dalmia_outbound_raw_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'DALMIA_OUTBOUND_RAW';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'DALMIA_OUTBOUND_RAW', 'Dalmia Cement — Outbound Enquiry Raw', 'dalmia_outbound_raw',
   'Dalmia Cement''s own Outbound sheet: website/careers enquiry log for outbound follow-up (no DB backing exists).',
   JSON_ARRAY('ID', 'Calling Date'),
   JSON_ARRAY('Name', 'Email', 'Mobile', 'Enquiry For', 'Message', 'Date', 'Status', 'Remarks', 'Source of lead'),
   JSON_OBJECT('ID', '1', 'Calling Date', '2026-07-03', 'Name', 'Gyana Ranjan Dash', 'Enquiry For', 'Careers',
     'Status', 'Contact', 'Source of lead', 'Website'),
   1);
