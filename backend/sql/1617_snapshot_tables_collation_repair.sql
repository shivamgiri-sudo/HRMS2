-- Migration: 1617_snapshot_tables_collation_repair.sql
-- Purpose: Convert upload_deduction_snapshot and qual_incentive_snapshot from
--          utf8mb4_0900_ai_ci to utf8mb4_unicode_ci, so they can be joined to
--          employees at all.
-- Date: 2026-08-26
--
-- Issue: 1547 created both tables with MySQL 8's server default
--        utf8mb4_0900_ai_ci while mas_hrms, and employees, are utf8mb4_unicode_ci
--        (verified live 2026-08-26 via information_schema). Both tables carry an
--        employee_code VARCHAR, and deduction-snapshot.routes.ts joins on it twice
--        (around lines 232 and 271):
--
--            LEFT JOIN employees e ON e.employee_code = q.employee_code
--
--        Comparing two differently-collated VARCHARs is not a warning in MySQL, it
--        is a hard error. Reproduced against production, both tables:
--
--            ER_CANT_AGGREGATE_2COLLATIONS: Illegal mix of collations
--            (utf8mb4_unicode_ci,IMPLICIT) and (utf8mb4_0900_ai_ci,IMPLICIT)
--
--        So those endpoints have been 500ing for every request, not degrading.
--
--        1547 is already recorded applied (success=1) and the tables hold real data
--        — 13,175 and 3,372 rows measured live — so correcting 1547's own text only
--        helps a rebuilt database. This file is the forward fix for every environment
--        where 1547 has already run. That is this repo's established two-part pattern:
--        fix the seed for fresh builds, add a forward migration for existing ones.
--
-- Safety: CONVERT TO CHARACTER SET rewrites the table, so each statement is guarded on
--        the CURRENT collation and is a no-op once applied — re-running costs one
--        information_schema lookup. Both tables are small. utf8mb4_unicode_ci and
--        utf8mb4_0900_ai_ci are both case- and accent-insensitive over the same utf8mb4
--        repertoire, so no row can collide or change meaning; only the sort/compare rules
--        change, which is the entire point. No column is added, dropped or retyped, and
--        no row is deleted.

-- ============================================================================
-- 1. upload_deduction_snapshot
-- ============================================================================

SET @uds_collation = (
  SELECT TABLE_COLLATION
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'upload_deduction_snapshot'
);

SET @sql = IF(@uds_collation IS NOT NULL AND @uds_collation <> 'utf8mb4_unicode_ci',
  'ALTER TABLE upload_deduction_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''upload_deduction_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 2. qual_incentive_snapshot
-- ============================================================================

SET @qis_collation = (
  SELECT TABLE_COLLATION
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'qual_incentive_snapshot'
);

SET @sql = IF(@qis_collation IS NOT NULL AND @qis_collation <> 'utf8mb4_unicode_ci',
  'ALTER TABLE qual_incentive_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''qual_incentive_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 1617_snapshot_tables_collation_repair.sql complete' AS status;
