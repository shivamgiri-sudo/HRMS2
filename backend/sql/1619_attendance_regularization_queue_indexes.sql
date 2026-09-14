-- 1619_attendance_regularization_queue_indexes.sql
--
-- Removes the full-table filesort behind the Attendance Regularization approval page.
--
-- ── Why ─────────────────────────────────────────────────────────────────────────────────
-- attendance_regularization carries no index on created_at, which is the ORDER BY of the
-- list endpoint (GET /api/wfm/regularizations). Measured against live mas_hrms on
-- 2026-08-27, 136,924 rows / 46.7 MB data / 59.9 MB index:
--
--   EXPLAIN SELECT ar.id FROM attendance_regularization ar
--    ORDER BY ar.created_at DESC LIMIT 100;
--     --> type=ALL  key=NULL  rows=136,924  Extra='Using filesort'      1,572 ms
--
-- The whole table is scanned and sorted to return 100 rows. Adding created_at lets the
-- optimiser walk the index backwards and stop after the limit, with no sort at all.
--
-- The status-filtered form of the same query already resolves through idx_reg_status
-- (type=range, rows=12, 133 ms), so the second composite below is for growth rather than
-- for today's numbers: it lets a status-filtered HISTORY page skip the sort once the open
-- statuses stop being a dozen rows. Leading with status keeps it usable for the equality
-- predicate the endpoint always applies.
--
-- ── Safety ──────────────────────────────────────────────────────────────────────────────
-- Server is MySQL 8.0.42 / InnoDB, so both adds run as online DDL: concurrent reads AND
-- writes continue and the table is not rebuilt. ALGORITHM=INPLACE and LOCK=NONE are stated
-- explicitly rather than left to the default so that if this server ever cannot do it
-- online the statement ERRORS instead of silently falling back to a blocking table copy.
-- Same reasoning as 429_attendance_daily_record_covering_index.sql.
--
-- Additive only: two secondary indexes, no column, constraint or row is touched, and a
-- replay is a no-op. Both adds are guarded on INFORMATION_SCHEMA.STATISTICS rather than
-- written as CREATE INDEX IF NOT EXISTS, which is MariaDB-only syntax that MySQL 8.0.42
-- rejects outright — the defect that had earlier migrations recorded as applied while
-- their DDL never ran.
--
-- Size is immaterial: roughly 4 MB of new index against 59.9 MB already present, and
-- ingest is low relative to the read volume this fixes.
--
-- THE REAL RISK IS TIMING, NOT THE CHANGE. Online DDL still takes a short exclusive
-- metadata lock at the start and end; if it lands behind a long-running query on this
-- table everything touching the table queues behind it. Checked immediately before
-- writing this: 3 non-sleeping threads, 0 past 10 seconds.

-- ── 1. created_at, for the unfiltered "All requests" ordering ────────────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'attendance_regularization'
       AND INDEX_NAME   = 'idx_ar_created_at') = 0,
  'ALTER TABLE attendance_regularization ADD INDEX idx_ar_created_at (created_at), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT ''idx_ar_created_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. (status, created_at), for a status-filtered page in date order ────────
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'attendance_regularization'
       AND INDEX_NAME   = 'idx_ar_status_created') = 0,
  'ALTER TABLE attendance_regularization ADD INDEX idx_ar_status_created (status, created_at), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT ''idx_ar_status_created already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1619_attendance_regularization_queue_indexes.sql applied — idx_ar_created_at + idx_ar_status_created' AS migration_status;
