-- Migration: 449_pre_cdr_daily_summary.sql
-- Purpose: precomputed day x TL rollup of db_masmis.Pre_cdr, so the Housing Premium
--          Overview tab (housing-premium-dashboard.service.ts, getHousingPremiumOverview)
--          reads from a small aggregate table (~1 row per day per TL) instead of
--          re-summing all of Pre_cdr's raw rows on every page load.
-- Date: 2026-09-29
-- Issue: Pre_cdr has grown to 210,740+ rows for a single month. Even with the indexed
--        report_date_iso column (migration 448) and the query collapsed from 8 down to 4
--        (getHousingPremiumOverview's byTl loop), a "month to date" range still matches
--        ~100% of the table's current rows, so MySQL's optimizer correctly chooses a full
--        scan over the index -- confirmed live via EXPLAIN, ~15-20s per query even after
--        both prior fixes. A precomputed rollup, kept in sync on every insert (see
--        upload_housing_premium_cdr.py and pre-cdr-bulk.service.ts), is the only way to
--        make this genuinely fast at any table size, not just today's.
-- Scope: only the Overview tab's org-wide and per-TL figures read from this table. Every
--        other Housing Premium tab (Day Wise, Agent Wise, Slot Wise, Team Details) needs
--        per-agent or per-hour granularity this table doesn't have, and keeps reading
--        Pre_cdr directly, unchanged. No other process's dashboard is touched by this.

CREATE TABLE IF NOT EXISTS db_masmis.pre_cdr_daily_summary (
  report_date_iso DATE NOT NULL,
  tl_name VARCHAR(150) NOT NULL DEFAULT '',
  connected INT NOT NULL DEFAULT 0,
  not_connected INT NOT NULL DEFAULT 0,
  unique_connected INT NOT NULL DEFAULT 0,
  present_count INT NOT NULL DEFAULT 0,
  talk_seconds BIGINT NOT NULL DEFAULT 0,
  row_count INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (report_date_iso, tl_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-time (and safe-to-rerun) backfill: recompute every date x TL from the current raw
-- data and overwrite. Rerunning this is always correct -- it reflects exactly what Pre_cdr's
-- raw rows say for each date x TL at the moment it runs, regardless of how many times it runs.
INSERT INTO db_masmis.pre_cdr_daily_summary
  (report_date_iso, tl_name, connected, not_connected, unique_connected, present_count, talk_seconds, row_count)
SELECT
  report_date_iso, COALESCE(NULLIF(tl_name, ''), '') AS tl_name,
  SUM(status = 'Answered') AS connected,
  SUM(status = 'No Answered') AS not_connected,
  SUM(status = 'Answered' AND unique_count = '1') AS unique_connected,
  SUM(call_count = '1') AS present_count,
  SUM(talk_duration + 0) AS talk_seconds,
  COUNT(*) AS row_count
FROM db_masmis.Pre_cdr
WHERE report_date_iso IS NOT NULL
GROUP BY report_date_iso, tl_name
ON DUPLICATE KEY UPDATE
  connected = VALUES(connected), not_connected = VALUES(not_connected),
  unique_connected = VALUES(unique_connected), present_count = VALUES(present_count),
  talk_seconds = VALUES(talk_seconds), row_count = VALUES(row_count);

SELECT '✓ Migration 449_pre_cdr_daily_summary.sql complete' AS status;
