-- Migration: 1618_payroll_branch_readiness_collation.sql
-- Purpose: Convert payroll_branch_readiness to utf8mb4_unicode_ci so it can be
--          joined to branch_master without a per-query CONVERT() workaround.
-- Date: 2026-08-26
--
-- Issue: payroll_branch_readiness is utf8mb4_0900_ai_ci while mas_hrms and
--        branch_master are utf8mb4_unicode_ci (verified live 2026-08-26). Joining
--        branch_id to branch_master.id is therefore a hard error, not a warning:
--
--            ER_CANT_AGGREGATE_2COLLATIONS errno=1267
--            Illegal mix of collations (utf8mb4_unicode_ci,IMPLICIT)
--            and (utf8mb4_0900_ai_ci,IMPLICIT) for operation '='
--
--        Observed live in the worker log immediately after deploy:
--            [payroll-window-cron] startup run failed
--        payroll-window.cron.ts (around line 136) joins plainly and dies on every
--        startup run, so the payroll window cron has not been completing.
--
--        payroll-branch-readiness.service.ts already works around the same clash
--        at two of its own joins with
--            LEFT JOIN branch_master b ON CONVERT(b.id USING utf8mb4) = CONVERT(r.branch_id USING utf8mb4)
--        i.e. the problem was hit before and patched per-query rather than at its
--        source, which is why one call site was fixed and the cron was not. Fixing
--        the table removes the need for either. Those CONVERT() joins are left in
--        place deliberately - they keep working against a converted table, and
--        rewriting working payroll code is not this migration's job.
--
-- Scope: this table only. A sweep found 58 of 1,009 tables carrying
--        utf8mb4_0900_ai_ci, several of them large (wfh_attendance_snapshot
--        ~267k rows, field_attendance_snapshot ~106k, migration_log ~90k). Those
--        are a separate, scheduled piece of work - converting them rewrites each
--        table and deserves its own window. This file fixes the one that is
--        actively failing, and is small: ~146 rows.
--
-- Safety: guarded on the table's CURRENT collation, so it is a no-op once applied.
--        utf8mb4_0900_ai_ci and utf8mb4_unicode_ci are both case- and
--        accent-insensitive over the same utf8mb4 repertoire, so no row can
--        collide or change meaning; only sort/compare rules change. No column is
--        added, dropped or retyped, and no row is deleted.

SET @pbr_collation = (
  SELECT TABLE_COLLATION
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'payroll_branch_readiness'
);

SET @sql = IF(@pbr_collation IS NOT NULL AND @pbr_collation <> 'utf8mb4_unicode_ci',
  'ALTER TABLE payroll_branch_readiness CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''payroll_branch_readiness already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 1618_payroll_branch_readiness_collation.sql complete' AS status;
