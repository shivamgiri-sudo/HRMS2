-- 2215_branch_health_snapshot.sql
--
-- Branch Head Health page: one row per branch per day holding the health score, its pillar breakdown and a
-- small set of headline metrics, so the page can draw a trend without recomputing history.
-- Written by the Branch Head Health route (INSERT ... ON DUPLICATE KEY UPDATE on branch_id + snap_date).
--
-- Additive only: one new table, no FK, no ALTER of any existing table.
-- REVERT: DROP TABLE IF EXISTS branch_health_snapshot;
CREATE TABLE IF NOT EXISTS branch_health_snapshot (
  id CHAR(36) NOT NULL PRIMARY KEY,
  branch_id CHAR(36) NOT NULL,
  snap_date DATE NOT NULL,
  score DECIMAL(5,2) NOT NULL,
  pillars_json JSON NULL,
  metrics_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bhs_branch_date (branch_id, snap_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
