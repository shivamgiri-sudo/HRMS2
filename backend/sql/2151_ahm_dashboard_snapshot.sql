-- AHM dashboard snapshot: pre-computed dashboard payloads, so viewers never pay the live
-- aggregation cost (~20-45s against db_masmis.ahm_dump_raw's 162k+ rows, confirmed live --
-- EXPLAIN shows a full table scan is correct today because one week's worth of data IS
-- essentially the whole table; this will ease as more weeks accumulate, but the dashboard
-- should not wait on that). A background worker (ahm-snapshot.worker.ts, started behind
-- AHM_SNAPSHOT_SCHEDULER_ENABLED) refreshes the common ranges every few minutes; getAhmDashboard()
-- also upserts here on any ad-hoc range a viewer requests, so a repeat view of ANY range is
-- instant and survives a backend restart (unlike the in-memory cache it replaces).
--
-- Lives in mas_hrms, not db_masmis: this is derived/computed application state, not raw
-- upstream data, and the app user has full rights here -- no DBA step needed, unlike
-- 1875_ahm_dump_raw.sql itself. ADDITIVE ONLY.
CREATE TABLE IF NOT EXISTS ahm_dashboard_snapshot (
  cache_key    VARCHAR(100)  NOT NULL PRIMARY KEY,
  from_date    DATE          NOT NULL,
  to_date      DATE          NOT NULL,
  region       VARCHAR(10)   NULL,
  payload      LONGTEXT      NOT NULL,
  compute_ms   INT           NOT NULL,
  computed_at  DATETIME      NOT NULL,
  KEY idx_ahm_snapshot_range (from_date, to_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
