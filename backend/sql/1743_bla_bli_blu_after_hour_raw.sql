-- Bla Bli Blu's real "afterhrdata Inbound.xls" export -- calls/contacts
-- received outside working hours, an HTML-table export from the same
-- local folder as sql/1739/1742. Just (Date, Contact No) -- a bare
-- after-hours contact log, same shape as Dalmia Cement's own
-- dalmia_after_hour_raw (sql/1734) built earlier this session. 42 real
-- rows, all 2026-09-08. Zero DB backing anywhere.
--
-- Row identity: (contact_date, contact_number) is unique across all 42
-- real rows, zero collisions.
CREATE TABLE IF NOT EXISTS bla_bli_blu_after_hour_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  contact_date DATETIME NOT NULL,
  contact_number VARCHAR(30) NOT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bla_bli_blu_after_hour (process_id, contact_date, contact_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'BLA_BLI_BLU_AFTER_HOUR';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'BLA_BLI_BLU_AFTER_HOUR', 'Bla Bli Blu — After Hour Data', 'bla_bli_blu_after_hour_raw',
   'Bla Bli Blu''s real after-hours contact log (no DB backing exists).',
   JSON_ARRAY('Date', 'Contact No'),
   JSON_ARRAY(),
   JSON_OBJECT('Date', '2026-09-08 19:03:59', 'Contact No', '+919355380180'),
   1);
