-- Migration 1961: BBB (Bla Bli Blu) upload rules -- Today_Only_Data_Upload_Logic_Requirement.
--   Received Data: one row per date + mobile number; Fresh/NC derived from the previous 1-3 days; an upload batch
--   can be trashed and restored (soft delete). Sales: keep the previous version of an order when it is replaced.
-- Idempotent: every structural step checks information_schema first.
-- No UNIQUE index on purpose: a failed startup migration stops the server, so uniqueness is enforced in the
-- upload code (under a named lock) and the non-unique index below only makes that check fast.

SET @db = DATABASE();

SELECT COUNT(*) INTO @has_live FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bla_dash_received' AND COLUMN_NAME = 'live_key';
SET @sql = IF(@has_live = 0,
  "ALTER TABLE bla_dash_received
     ADD COLUMN source_data_type VARCHAR(32) NULL,
     ADD COLUMN live_key BIGINT UNSIGNED NOT NULL DEFAULT 0,
     ADD COLUMN deleted_at DATETIME NULL,
     ADD COLUMN deleted_by VARCHAR(64) NULL",
  "SELECT 1");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @has_idx1 FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bla_dash_received' AND INDEX_NAME = 'idx_bla_recv_day_number';
SET @sql = IF(@has_idx1 = 0,
  "ALTER TABLE bla_dash_received ADD KEY idx_bla_recv_day_number (report_date, phone, live_key)", "SELECT 1");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @has_idx2 FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bla_dash_received' AND INDEX_NAME = 'idx_bla_recv_number_day';
SET @sql = IF(@has_idx2 = 0,
  "ALTER TABLE bla_dash_received ADD KEY idx_bla_recv_number_day (phone, report_date)", "SELECT 1");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- NO bulk data statements here, on purpose. The first version of this file also trashed existing same-day
-- duplicates and renamed the 'NC Data' label across all 126,612 rows; on the production database that UPDATE ran for
-- minutes, the deploy's health wait expired and the site was down ~7 minutes (2026-09-30 20:02-20:09 IST) until the
-- pipeline rolled back. A startup migration must only do instant, structural work.
--   * The duplicate clean-up DID complete on production in that run (114 rows trashed with
--     deleted_by = 'migration-1961-duplicate', 0 duplicates left), so it is not repeated.
--   * The label rename is dropped: legacy rows keep the file's 'NC Data' with source_data_type NULL. Rows uploaded
--     from now on, and any date the rules re-derive, store 'Fresh' / 'NC'. Readers test data_type = 'Fresh' only.

-- Live rows only, for anything that reads the table generically (the analytics catalogue dataset).
CREATE OR REPLACE VIEW bla_dash_received_active AS
  SELECT id, upload_batch_id, report_date, lob, data_type, source_data_type, workable, call_answer,
         same_day_attempt, final_dispo, emp_id, emp_name, phone, created_by, created_at
    FROM bla_dash_received
   WHERE live_key = 0;

UPDATE analytics_dataset SET source_table = 'bla_dash_received_active'
 WHERE code = 'bla_bli_blu_received_data' AND source_table = 'bla_dash_received';

-- Previous versions of a sales order, written just before an upload replaces it or a batch delete reverts it.
CREATE TABLE IF NOT EXISTS bla_bli_blu_overall_sales_history (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  process_id       CHAR(36)     NULL,
  order_id         VARCHAR(64)  NOT NULL,
  action           VARCHAR(24)  NOT NULL,
  previous_batch   CHAR(36)     NULL,
  replaced_by_batch CHAR(36)    NULL,
  row_json         JSON         NOT NULL,
  created_by       VARCHAR(64)  NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bbb_sales_hist_order (order_id),
  KEY idx_bbb_sales_hist_batch (replaced_by_batch)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
