-- Migration 2170: Blabli Blu sales upload quality (BB-02 / BB-03 / BB-04).
--   bla_bli_blu_sales_upload_reject: one row per rejected field of an Overall Sales upload -- row number, field,
--     uploaded value, reason code, readable reason, required format and whether it is a business (fix the file) or a
--     technical (system / database) error. severity 'warning' marks a secondary column that could not be read on a
--     row that was still accepted (stored blank, never silently). upload_batch_row.error_messages keeps the readable sentence for the
--     Bulk Upload Hub; this table is what the dashboard groups and filters.
--   bla_bli_blu_sales_upload_date: per upload and sales date, how many orders the dashboard had before the import,
--     how many the file carried, how many of those replaced an existing order, and the count after. Variance =
--     file count - existing count. Drives the "Data quality / correction status" view (1-3 Aug re-import).
-- Additive: new tables only, no data statements.

CREATE TABLE IF NOT EXISTS bla_bli_blu_sales_upload_reject (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  upload_batch_id  CHAR(36)      NOT NULL,
  row_no           INT           NOT NULL,
  field_name       VARCHAR(64)   NOT NULL,
  uploaded_value   VARCHAR(255)  NULL,
  reason_code      VARCHAR(40)   NOT NULL,
  reason           VARCHAR(500)  NOT NULL,
  required_format  VARCHAR(255)  NULL,
  category         VARCHAR(16)   NOT NULL,
  severity         VARCHAR(8)    NOT NULL DEFAULT 'reject',
  report_month     CHAR(7)       NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bbb_sales_reject_batch (upload_batch_id, row_no),
  KEY idx_bbb_sales_reject_code (reason_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bla_bli_blu_sales_upload_date (
  upload_batch_id  CHAR(36)      NOT NULL,
  report_date      DATE          NOT NULL,
  existing_count   INT           NOT NULL DEFAULT 0,
  upload_count     INT           NOT NULL DEFAULT 0,
  updated_count    INT           NOT NULL DEFAULT 0,
  inserted_count   INT           NOT NULL DEFAULT 0,
  after_count      INT           NOT NULL DEFAULT 0,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (upload_batch_id, report_date),
  KEY idx_bbb_sales_upload_day (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
