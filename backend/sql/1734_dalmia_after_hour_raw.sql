-- Dalmia Cement's own "Dalmia July'26.xlsx" MIS workbook's "After Hour
-- Data" sheet -- a log of customer calls received outside working hours,
-- found while auditing the same workbook as sql/1730-1733. No DB backing
-- exists anywhere (same cross-schema check). Real, current data: 634
-- rows, 2026-07-01 to 2026-07-14. Only 3 columns; "Number " is identical
-- to "Contact No" in every sampled row (a duplicate re-typed column), so
-- only "Contact No" is kept.
--
-- Row identity: (Date, Contact No) is unique across all 634 real rows
-- with zero collisions.
CREATE TABLE IF NOT EXISTS dalmia_after_hour_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  call_datetime DATETIME NOT NULL,
  report_date DATE NOT NULL,
  contact_number VARCHAR(30) NOT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dalmia_after_hour_raw (process_id, call_datetime, contact_number),
  KEY idx_dalmia_after_hour_raw_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'DALMIA_AFTER_HOUR';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'DALMIA_AFTER_HOUR', 'Dalmia Cement — After Hour Calls', 'dalmia_after_hour_raw',
   'Dalmia Cement''s own After Hour Data sheet: customer calls received outside working hours (no DB backing exists).',
   JSON_ARRAY('Date', 'Contact No'),
   JSON_ARRAY(),
   JSON_OBJECT('Date', '2026-07-01 19:08:17', 'Contact No', '8235592747'),
   1);
