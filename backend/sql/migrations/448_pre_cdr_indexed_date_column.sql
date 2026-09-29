-- Migration: 448_pre_cdr_indexed_date_column.sql
-- Purpose: Add an indexed DATE column to db_masmis.Pre_cdr, backfilled from the
--          existing report_date text column, so date-range queries stop doing a
--          full-table STR_TO_DATE conversion on every row.
-- Date: 2026-09-29
-- Issue: db_masmis.Pre_cdr.report_date is text in "M/D/YY" form (e.g. "9/24/26").
--        Every date-range query in housing-premium-dashboard.service.ts filters
--        via STR_TO_DATE(report_date, '%c/%e/%y') in a derived-table WHERE clause
--        -- a computed expression, so MySQL cannot use an index and must convert
--        + scan EVERY row of Pre_cdr on every call. Confirmed live 2026-09-29:
--        Pre_cdr has grown to 210,740 rows (this session's CDR backfills plus the
--        new daily automation), and a single such query now takes ~11.2s; the
--        Housing Premium Overview tab fires 4 of these in parallel (org-wide +
--        one per TL), which now exceeds the frontend's 30s timeout. This adds a
--        real, indexed DATE column so the WHERE clause can use an index instead.
--        Purely additive: report_date (text) is untouched and still the primary
--        source every existing reader (this dashboard's own remaining queries,
--        the uploader scripts, any other consumer) can keep using unchanged.

-- ============================================================================
-- 1. Add report_date_iso, idempotently.
-- ============================================================================

SET @col_exists = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'db_masmis'
     AND TABLE_NAME = 'Pre_cdr'
     AND COLUMN_NAME = 'report_date_iso'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE db_masmis.Pre_cdr ADD COLUMN report_date_iso DATE NULL AFTER report_date',
  'SELECT ''report_date_iso column already exists on db_masmis.Pre_cdr'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 2. Backfill from the existing text column -- only where currently NULL, so a
--    re-run is a no-op and never overwrites a value a future writer has set.
-- ============================================================================

UPDATE db_masmis.Pre_cdr
   SET report_date_iso = STR_TO_DATE(report_date, '%c/%e/%y')
 WHERE report_date_iso IS NULL
   AND report_date IS NOT NULL
   AND report_date <> '';

-- ============================================================================
-- 3. Index it, idempotently.
-- ============================================================================

SET @idx_exists = (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = 'db_masmis'
     AND TABLE_NAME = 'Pre_cdr'
     AND INDEX_NAME = 'idx_pre_cdr_date_iso'
);

SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_pre_cdr_date_iso ON db_masmis.Pre_cdr (report_date_iso)',
  'SELECT ''idx_pre_cdr_date_iso already exists on db_masmis.Pre_cdr'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 448_pre_cdr_indexed_date_column.sql complete' AS status;
