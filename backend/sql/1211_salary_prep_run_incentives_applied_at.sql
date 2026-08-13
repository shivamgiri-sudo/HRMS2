-- Migration 1211: create salary_prep_run.incentives_applied_at, which two live code paths
-- already depend on and which does not exist in production.
--
-- WHY THIS IS NEEDED
--   Migrations 398 and 404 both tried to add this column with `ADD COLUMN IF NOT EXISTS`,
--   which this server's MySQL 8.0.42 build rejects with ER_PARSE_ERROR at the `IF NOT EXISTS`
--   token — the same failure that took production down through migration 1006 on 2026-08-13.
--   398 is nevertheless RECORDED AS APPLIED in schema_migrations (2026-07-20 13:05:15) while
--   the column was never created. Verified live 2026-08-13:
--     SELECT COUNT(*) FROM information_schema.COLUMNS
--      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='salary_prep_run'
--        AND COLUMN_NAME='incentives_applied_at';   -> 0
--
-- WHAT IS BROKEN WITHOUT IT
--   1. POST /api/payroll/runs/:id/calculate — payroll.routes.ts runs
--        SELECT incentives_applied_at FROM salary_prep_run WHERE id = ?
--      unless force=true. Against the real schema that raises ER_BAD_FIELD_ERROR, which the
--      handler forwards to next(err), so the canonical calculate endpoint 500s. It is masked
--      today only because the readiness gate 409s first on all three active months — the
--      moment readiness is cleared, calculation fails instead.
--   2. POST /api/incentives/apply-to-run — incentives.service.ts applyToRun() ends with
--        UPDATE salary_prep_run SET incentives_applied_at = NOW() WHERE id = ?
--      which throws AFTER the function has already rewritten salary_prep_line, so the endpoint
--      500s having half-mutated payroll and never stamps the run. The double-count guard in (1)
--      can therefore never fire even once the column exists — that guard is fixed separately in
--      incentives.service.ts.
--
-- ADDITIVE AND IDEMPOTENT BY CONSTRUCTION
--   The column is nullable with no default, so creating it changes no existing row's meaning:
--   every current run reads NULL, which is exactly "incentives have not been applied", which is
--   true of all 66 of them (incentive_upload_batch is empty). No payroll figure is affected.
--   Both statements are guarded on information_schema and re-running this file is a true no-op,
--   including on any environment where 398/404 did somehow succeed.
--
-- ROLLBACK:
--   ALTER TABLE salary_prep_run DROP COLUMN incentives_applied_at;
--   (drop index idx_spr_incentives_applied first if present)

SET @c_incentives_applied_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'salary_prep_run'
     AND COLUMN_NAME = 'incentives_applied_at'
);
SET @sql = IF(@c_incentives_applied_at = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN incentives_applied_at DATETIME NULL COMMENT ''Set when an approved incentive batch was applied to this run; NULL means never applied''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @i_incentives_applied = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'salary_prep_run'
     AND INDEX_NAME = 'idx_spr_incentives_applied'
);
SET @sql = IF(@i_incentives_applied = 0,
  'CREATE INDEX idx_spr_incentives_applied ON salary_prep_run (incentives_applied_at)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
