-- 603_dashboard_metric_snapshot_unique.sql
--
-- Makes one snapshot per (metric, scope, day) enforceable.
--
-- dashboard_metric_snapshot ships with idx_metric_scope, which is NON-UNIQUE. The nightly
-- writer would therefore append a second row on every re-run — a retry after a failure, a
-- manual catch-up, or two cron hosts firing together. getMetricTrend reads
-- `ORDER BY snapshot_date DESC LIMIT 1`, so duplicates do not error; they silently make the
-- comparison depend on insert order. A trend arrow that flips based on which duplicate
-- happens to sort first is worse than no arrow at all.
--
-- With this key the writer uses ON DUPLICATE KEY UPDATE and is safe to run repeatedly.
--
-- Safe to apply: the table is empty (0 rows), so the index cannot fail on existing
-- duplicates. Additive — the existing non-unique index is left in place, since it also
-- serves the ORDER BY and dropping it is not required for correctness.
--
-- scope_id is NULL for ORG-level rows. MySQL treats NULLs as distinct in a UNIQUE index,
-- so this key does NOT prevent duplicate ORG rows on its own. The writer therefore deletes
-- the ORG row for the day before inserting it; the key still covers BRANCH and PROCESS,
-- which are the high-volume cases. Documented rather than worked around with a sentinel
-- UUID, because a fake scope_id would leak into every query that joins on it.

START TRANSACTION;

CREATE UNIQUE INDEX uq_metric_scope_date
  ON dashboard_metric_snapshot (metric_code, scope_type, scope_id, snapshot_date);

COMMIT;

-- Rollback:
--   DROP INDEX uq_metric_scope_date ON dashboard_metric_snapshot;
