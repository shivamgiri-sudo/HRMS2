-- Migration: 1244_tds_slab_2025_26_new_regime_dedup.sql
-- Purpose: Deactivate 6 stale FY2024-25 new-regime slab rows mislabeled financial_year='2025-26',
--          then add UNIQUE(financial_year, regime, slab_from, active_status) to prevent recurrence.
-- Date: 2026-08-19
--
-- Background: taxEngine.service.ts's getSlabs() (fixed cd29c8d9, 2026-08-17) correctly refuses to
-- compute TDS when a slab band has more than one active row for the same (financial_year, regime,
-- slab_from) — a duplicated band would otherwise be taxed twice. payroll_tax_slab_master has held
-- exactly that condition live since at least 2026-07-20: financial_year='2025-26', regime='new' has
-- 13 active rows where only 7 bands exist. Harmless so far only because
-- salary_prep_run.tds_mode is 100% 'manual' (66/66 runs) — the auto path that calls getSlabs() has
-- never executed in production.
--
-- These are NOT exact duplicate rows (unlike 503_pt_slab_dedup.sql's case) — pulling the full band
-- picture (2026-08-19) shows two genuinely different slab schemes both tagged '2025-26'/'new':
--   - 7 rows inserted 2026-06-03 20:53:24: 0-4L 0%, 4-8L 5%, 8-12L 10%, 12-16L 15%, 16-20L 20%,
--     20-24L 25%, 24L+ 30%. This is the correct Budget 2025 new-regime structure for FY2025-26 —
--     confirmed two independent ways: (1) byte-identical to the FY2026-27 row set (also inserted
--     2026-06-03), consistent with this repo's own record that Budget 2026 left FY2025-26 bands
--     unchanged; (2) exactly matches the separately-maintained statutory_config.tds_slab_* fallback
--     rates (same 7 bands, same boundaries, same rates) used by the fallback calculator in
--     payrollCalculate.service.ts's calculateTds().
--   - 6 rows inserted 2026-07-20 12:41:09: 0-3L 0%, 3-7L 5%, 7-10L 10%, 10-12L 15%, 12-15L 20%,
--     15L+ 30%. These boundaries are the OLD Budget 2024 new-regime slabs (superseded by Budget
--     2025) — a stale FY2024-25 row set that appears to have been inserted six weeks later and
--     mislabeled '2025-26', not a real second opinion on the current year's rates.
--
-- Because the two cohorts disagree on rate_pct and slab_to, not just slab_from, a blind
-- MIN(id)/most-recent heuristic (the 503_pt_slab_dedup.sql approach) could pick the wrong cohort.
-- This deactivates the 6 specific 2026-07-20 row ids by explicit id list instead, after review and
-- explicit owner approval of exactly this cohort identification. No DELETE — active_status=0 is
-- fully reversible and is this table's own designed mechanism for "this slab set no longer
-- applies", matching how every other financial_year/regime combination already uses it.

-- ============================================================================
-- 1. Audit before — must show 13 active rows / 7 distinct slab_from values, confirming the
--    exact condition described above before anything is touched.
-- ============================================================================

SELECT financial_year, regime, slab_from, COUNT(*) AS active_row_count
  FROM payroll_tax_slab_master
 WHERE financial_year = '2025-26' AND regime = 'new' AND active_status = 1
 GROUP BY financial_year, regime, slab_from
HAVING COUNT(*) > 1;

-- ============================================================================
-- 2. Deactivate the 6 stale (Budget-2024-shaped) rows by explicit id (primary key) — not a
--    GROUP BY heuristic. financial_year/regime/active_status are a belt-and-braces guard so
--    this is a no-op (0 rows) if it is ever re-run after the data has already changed; a
--    created_at equality guard was tried and dropped — the driver's UTC-normalised read-back
--    ("2026-07-20T12:41:09.000Z") did not round-trip as an equal literal against this server's
--    session time zone, and the id list alone is already a fully deterministic primary-key
--    match with no ambiguity.
-- ============================================================================

UPDATE payroll_tax_slab_master
   SET active_status = 0
 WHERE id IN (
   '483bfbbb-8438-11f1-adb1-00155d0ab410', -- 0 - 3,00,000        @ 0%
   '483c01ad-8438-11f1-adb1-00155d0ab410', -- 3,00,000 - 7,00,000 @ 5%
   '483c037d-8438-11f1-adb1-00155d0ab410', -- 7,00,000 - 10,00,000 @ 10%
   '483c0500-8438-11f1-adb1-00155d0ab410', -- 10,00,000 - 12,00,000 @ 15%
   '483c0668-8438-11f1-adb1-00155d0ab410', -- 12,00,000 - 15,00,000 @ 20%
   '483c07cd-8438-11f1-adb1-00155d0ab410'  -- 15,00,000+          @ 30%
 )
   AND financial_year = '2025-26'
   AND regime = 'new'
   AND active_status = 1;

-- ============================================================================
-- 3. Audit after — must return zero rows. If this returns any row, the UNIQUE constraint
--    below will fail with ER_DUP_ENTRY, which is the correct outcome (stop, don't guess).
-- ============================================================================

SELECT financial_year, regime, slab_from, COUNT(*) AS active_row_count
  FROM payroll_tax_slab_master
 WHERE active_status = 1
 GROUP BY financial_year, regime, slab_from
HAVING COUNT(*) > 1;

-- ============================================================================
-- 4. Add the UNIQUE constraint idempotently (information_schema-guarded PREPARE/EXECUTE —
--    this MySQL 8.0.42 server rejects ADD CONSTRAINT ... IF NOT EXISTS with ER_PARSE_ERROR
--    while still recording the migration as applied; same pattern as 503/1224/1225/1227/
--    1228/1232). Includes active_status so a future correction can still insert a new active
--    row after first deactivating the old one, matching getSlabs()'s own ambiguity check
--    (only active rows are compared).
-- ============================================================================

SET @constraint_exists = (
  SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'payroll_tax_slab_master'
     AND CONSTRAINT_NAME = 'uq_tax_slab_fy_regime_from_active'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE payroll_tax_slab_master
   ADD CONSTRAINT uq_tax_slab_fy_regime_from_active
   UNIQUE (financial_year, regime, slab_from, active_status)',
  'SELECT ''uq_tax_slab_fy_regime_from_active constraint already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 1244_tds_slab_2025_26_new_regime_dedup.sql complete' AS status;
