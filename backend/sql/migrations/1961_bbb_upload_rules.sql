-- Migration 1961: BBB (Bla Bli Blu) upload rules -- Today_Only_Data_Upload_Logic_Requirement.
--   Received Data: one row per date + mobile number; Fresh/NC derived from the previous 1-3 days; an upload batch
--   can be trashed and restored (soft delete). Sales: keep the previous version of an order when it is replaced.
-- Idempotent: every structural step checks information_schema first, every data step is safe to repeat.
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

-- Existing same-day duplicates: keep the newest row of each (date, number), move the others to the trash.
-- live_key = 0 means "live"; a trashed row carries its own id there, so a live row is always identifiable.
UPDATE bla_dash_received r
  JOIN (SELECT report_date, phone, MAX(id) AS keep_id
          FROM bla_dash_received
         WHERE live_key = 0 AND phone IS NOT NULL AND phone <> ''
         GROUP BY report_date, phone
        HAVING COUNT(*) > 1) d
    ON d.report_date = r.report_date AND d.phone = r.phone
   SET r.live_key = r.id, r.deleted_at = NOW(), r.deleted_by = 'migration-1961-duplicate'
 WHERE r.live_key = 0 AND r.id <> d.keep_id;

-- Keep what the file said, and store the status under the two names the rule uses: Fresh / NC.
UPDATE bla_dash_received
   SET source_data_type = data_type,
       data_type = CASE WHEN data_type LIKE 'NC%' THEN 'NC' ELSE data_type END
 WHERE source_data_type IS NULL AND data_type IS NOT NULL;

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
