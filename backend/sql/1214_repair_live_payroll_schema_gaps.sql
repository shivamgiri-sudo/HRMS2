-- 1214_repair_live_payroll_schema_gaps.sql
--
-- ⚠️ NOT IN THE MANIFEST. Authored for review; it will not run until someone adds it to
--    MIGRATION_MANIFEST in runPendingMigrations.ts. Registering it there means it executes on the
--    next backend start, which is a production schema change and needs explicit approval.
--
-- WHAT THIS REPAIRS
--
-- Four objects that three migrations declared, that `schema_migrations` records as applied with
-- success = 1, and that do not exist in mas_hrms. Verified live 2026-08-13 against
-- information_schema, not inferred from the files.
--
--   salary_prep_run.incentives_applied_at    declared by 398 and again by 404
--   salary_prep_line.payslip_emailed         declared by 402
--   salary_prep_line.payslip_emailed_at      declared by 402
--   idx_spl_payslip_gen                      declared by 402
--
-- WHY THEY ARE MISSING
--
-- All three files were written `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and 402 also
-- `CREATE INDEX IF NOT EXISTS`. That is MariaDB syntax; MySQL 8.0.42 rejects it with
-- ER_PARSE_ERROR. It is the same fault that got 1064 dropped, left 1110 unlisted, half-applied 246
-- and caused the 1006 outage. All three were recorded applied on 2026-07-20, before the runner
-- gained its per-statement error handling, so the parse error was classified at file level and the
-- row was written anyway.
--
-- WHY IT MATTERS NOW — these are reachable, not dormant
--
--   incentives.service.ts:291   UPDATE salary_prep_run SET incentives_applied_at = NOW()
--   payroll.routes.ts:542       SELECT incentives_applied_at FROM salary_prep_run
--     This is the guard against silently wiping applied incentives on recalculate. It throws
--     ER_BAD_FIELD_ERROR today, so the guard does not exist.
--
--   payroll-more.routes.ts:1124 UPDATE salary_prep_line SET payslip_emailed = 1 ...
--   payroll-more.routes.ts:1145 SUM(CASE WHEN COALESCE(payslip_emailed,0) = 1 ...)
--     Both endpoints are mounted (app.ts:360) and both 500:
--       POST /api/payroll/runs/:id/email-payslips
--       GET  /api/payroll/runs/:id/bulk-payslip-summary
--
-- DELIBERATELY NOT REPAIRED HERE
--
--   pulse_check.employee_id / submitted_at / mood_rating / ... (migration 1000)
--     Not schema drift. pulse_check is the QUESTION master; answers belong in pulse_response,
--     which already exists and which people-experience.service.ts now reads (commit 3f74496b).
--     Adding those columns would create a second response store. 1000 should be retired.
--
--   ats_onboarding_bridge.bridge_status / updated_at (migration 508)
--     bridge_status is an output ALIAS — ats.service.ts:587 selects `ob.status AS bridge_status`.
--     A real column would be a rival source of truth for a value `status` already holds.
--
--   idx_spr_incentives_applied (also declared by 404)
--     Outside the approved four-object scope. Nothing queries salary_prep_run by that column, so
--     it buys nothing today; raise it separately if wanted.
--
-- SAFETY
--
-- Additive only: two nullable columns, one NOT NULL column with a DEFAULT (so existing rows take
-- it without a rewrite of meaning), and one index. No data is written, no existing column altered,
-- nothing dropped.
--
-- Every object is guarded individually through information_schema + PREPARE, per the idiom used by
-- 181 files in this directory — NOT one multi-object ALTER. That is the whole point: 509 lost its
-- tail because eleven columns went in a single all-or-nothing statement that failed
-- ER_DUP_FIELDNAME on one of them. Here an object that already exists cannot suppress the repair
-- of the ones after it.
--
-- Idempotent: re-running is a no-op on every statement.
--
-- ROLLBACK
--   ALTER TABLE salary_prep_run  DROP COLUMN incentives_applied_at;
--   ALTER TABLE salary_prep_line DROP COLUMN payslip_emailed, DROP COLUMN payslip_emailed_at;
--   DROP INDEX idx_spl_payslip_gen ON salary_prep_line;

-- ── 1. salary_prep_run.incentives_applied_at ────────────────────────────────
SET @col_exists := (
  SELECT COUNT(1) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'salary_prep_run'
     AND column_name = 'incentives_applied_at'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE salary_prep_run ADD COLUMN incentives_applied_at DATETIME NULL COMMENT ''When incentives were applied to this run; guards against silent incentive wipe on recalculate''',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2. salary_prep_line.payslip_emailed ─────────────────────────────────────
SET @col_exists := (
  SELECT COUNT(1) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'salary_prep_line'
     AND column_name = 'payslip_emailed'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN payslip_emailed TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''Payslip email dispatched for this line''',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 3. salary_prep_line.payslip_emailed_at ──────────────────────────────────
SET @col_exists := (
  SELECT COUNT(1) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'salary_prep_line'
     AND column_name = 'payslip_emailed_at'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN payslip_emailed_at DATETIME NULL COMMENT ''When the payslip email was dispatched''',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 4. idx_spl_payslip_gen ──────────────────────────────────────────────────
-- Guarded against STATISTICS separately from the columns: the columns can exist while the index
-- does not, if an earlier run stopped between them.
SET @idx_exists := (
  SELECT COUNT(1) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'salary_prep_line'
     AND index_name = 'idx_spl_payslip_gen'
);
SET @ddl := IF(@idx_exists = 0,
  'CREATE INDEX idx_spl_payslip_gen ON salary_prep_line (run_id, payslip_generated)',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
