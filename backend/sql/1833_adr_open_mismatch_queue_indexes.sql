-- 1833_adr_open_mismatch_queue_indexes.sql
--
-- Speeds up the WFM mismatch queue (GET /api/wfm/mismatches, /summary). The queue filters a
-- record_date window on two arms:
--   arm 1: mismatch_flag = 1 AND mismatch_resolved_at IS NULL
--   arm 2: attendance_status = 'week_off_worked' (already served by idx_adr_record_date_status)
-- Existing indexes lead with record_date alone or with the status; nothing covers the flag arm,
-- so it scanned every row in the date window. Idempotent (checks information_schema, whose
-- column values are UPPERCASE on mysql2).
--
-- NOT registered in MIGRATION_MANIFEST — register only once the owner approves applying it.
-- Run EXPLAIN on the queue query before/after; keep the index only if the plan improves.

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'attendance_daily_record'
    AND INDEX_NAME = 'idx_adr_mismatch_open'
);
SET @sql = IF(
  @idx = 0,
  'CREATE INDEX idx_adr_mismatch_open ON attendance_daily_record (mismatch_flag, record_date, mismatch_resolved_at)',
  'SELECT ''idx_adr_mismatch_open already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1833_adr_open_mismatch_queue_indexes.sql applied' AS migration_status;
