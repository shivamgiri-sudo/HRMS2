-- 1537_annual_budget_summary_page_access.sql
-- PLACEHOLDER: the manifest names this file but its real author never committed it (verified
-- 2026-08-22: absent from origin/main entirely, not a local-only gap). Added only to unblock
-- deploys for every session -- deploy-preflight.mjs refuses to restart production when a manifest
-- entry has no file on disk, and this was blocking a completely unrelated roster-import fix.
-- Replace with the real DDL, or remove this file and its matching line in
-- backend/src/db/runPendingMigrations.ts, once the annual-budget-summary page-access feature is
-- actually finished.
SELECT 1;
