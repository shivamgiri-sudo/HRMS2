-- Migration 1007: Register PAYROLL_PROCESS_READINESS page catalog entry
-- Grants: payroll_head, super_admin, payroll, payroll_branch, branch_head, admin, hr, wfm, process_manager
--
-- ⚠️ FIXED 2026-08-14 — THIS MIGRATION TOOK PRODUCTION DOWN.
--
-- It wrote to `workforce_page_catalog` and `workforce_role_page_permissions`. Neither table has
-- ever existed in mas_hrms: verified live, and `CREATE TABLE workforce_page_catalog` appears in
-- no .sql file anywhere in this repo. The real tables are `page_catalog` and `role_page_access`.
--
-- Why it surfaced only now: 1007 sits directly behind 1006 in the manifest, and 1006 had been
-- failing for its own (unrelated, bookkeeping) reason. STOP_ON_FIRST_FAILURE meant the runner
-- never reached 1007, so this fault stayed invisible for as long as 1006 was broken. Repairing
-- 1006 advanced the queue by exactly one file and this threw
-- `Table 'mas_hrms.workforce_page_catalog' doesn't exist`, which blocked startup — the API never
-- bound its port, /api/health returned nothing, and pm2 still reported the process "online".
-- Rolled back to the previous artifact; no schema change had been applied.
--
-- COLUMN NAMES CHANGED TOO, not just the table names:
--   workforce_page_catalog.route_path  -> page_catalog.page_path
--   workforce_page_catalog.is_active   -> page_catalog.active_status
--   role_page_access additionally requires an explicit `id` (CHAR(36)); it has no auto key.
--
-- STILL `INSERT IGNORE`, DELIBERATELY. The intended rows are ALREADY PRESENT on production —
-- the catalog row exists and 10 role_page_access grants exist, applied out of band at some
-- point. IGNORE preserves whatever those live grants have been tuned to; ON DUPLICATE KEY UPDATE
-- would silently rewrite real access control to match a file written months ago. So on this
-- database the migration is a verified no-op that simply records itself as applied, and on a
-- rebuilt one it seeds the page correctly for the first time.
--
-- VERIFIED by replaying this exact file against TEMPORARY copies of page_catalog and
-- role_page_access on production 8.0.42, seeded with the current live rows: executed clean and
-- left 1 catalog row / 10 grants untouched; then against emptied copies, where it produced
-- exactly 1 and 10.
--
-- The filename is unchanged on purpose: renaming an applied migration makes schema_migrations
-- miss it and re-runs it in every environment that already had it.
--
-- ROLLBACK:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'PAYROLL_PROCESS_READINESS';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'PAYROLL_PROCESS_READINESS';

INSERT IGNORE INTO page_catalog
  (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('PAYROLL_PROCESS_READINESS', 'Process Payroll Readiness', '/payroll/process-readiness', 'payroll',
   'Process-level payroll readiness with WFM attendance declaration and process manager sign-off', 1);

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',     'PAYROLL_PROCESS_READINESS', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',           'PAYROLL_PROCESS_READINESS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'payroll_head',    'PAYROLL_PROCESS_READINESS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'payroll',         'PAYROLL_PROCESS_READINESS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'payroll_branch',  'PAYROLL_PROCESS_READINESS', 1, 0, 1, 0, 0, 1),
  (UUID(), 'branch_head',     'PAYROLL_PROCESS_READINESS', 1, 0, 1, 0, 0, 1),
  (UUID(), 'hr',              'PAYROLL_PROCESS_READINESS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'wfm',             'PAYROLL_PROCESS_READINESS', 1, 0, 1, 0, 0, 1),
  (UUID(), 'process_manager', 'PAYROLL_PROCESS_READINESS', 1, 0, 1, 0, 0, 1),
  (UUID(), 'finance',         'PAYROLL_PROCESS_READINESS', 1, 0, 0, 0, 1, 1);

SELECT '1007_payroll_process_readiness_page.sql applied successfully' AS migration_status;
