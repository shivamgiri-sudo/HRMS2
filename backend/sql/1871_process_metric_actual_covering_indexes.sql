-- 1871_process_metric_actual_covering_indexes.sql
-- Additive, idempotent covering indexes for the Process Operations page
-- (/process-operations): GET /api/process-operations/feeds and /processes.
--
-- Context: both endpoints aggregate process_metric_actual (~6.6k rows). The
-- real fix for the 10s+ load is the query rewrite (aggregate first, then join
-- the descriptive columns) shipped with this migration; these two indexes let
-- those aggregates read from the index alone instead of the table.
--
--   idx_pma_feed_cover (process_id, metric_key, score_date, actual_value)
--     feed-health.service.ts getFeedHealth: GROUP BY process_id, metric_key with
--     MAX(score_date), SUM(score_date >= ...) and an actual_value IS NOT NULL test.
--   idx_pma_source_date (source, score_date, process_id, metric_key)
--     process-operations.service.ts listProcesses "automated" count: filters
--     source = 'connector' and a score_date window, GROUP BY process_id.
--
-- No data is modified. Safe to re-run: each statement is skipped when the index
-- already exists. ALGORITHM=INPLACE, LOCK=NONE builds the index online; if the
-- server cannot honour that it raises an error and changes nothing.
--
-- Rollback (safe at any time — indexes affect speed, never correctness):
--   ALTER TABLE process_metric_actual DROP INDEX idx_pma_feed_cover;
--   ALTER TABLE process_metric_actual DROP INDEX idx_pma_source_date;

SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_metric_actual'
              AND INDEX_NAME = 'idx_pma_feed_cover');
SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_metric_actual');
SET @s = IF(@tbl > 0 AND @idx = 0,
  'ALTER TABLE process_metric_actual ADD INDEX idx_pma_feed_cover (process_id, metric_key, score_date, actual_value), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT "skip: process_metric_actual.idx_pma_feed_cover" AS note');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_metric_actual'
              AND INDEX_NAME = 'idx_pma_source_date');
SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_metric_actual');
SET @s = IF(@tbl > 0 AND @idx = 0,
  'ALTER TABLE process_metric_actual ADD INDEX idx_pma_source_date (source, score_date, process_id, metric_key), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT "skip: process_metric_actual.idx_pma_source_date" AS note');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;
