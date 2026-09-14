-- 1616_missing_page_catalog_entries_dispute_budget.sql
--
-- Registers two page codes the application gates on but no migration ever created.
-- Same class of defect as 604_missing_page_catalog_entries.sql, and fixed the same way.
--
--   SALARY_DISPUTE                 gates /payroll/salary-disputes (SalaryDisputeHub) in
--                                  src/config/routes/payroll.routes.tsx.
--   FINANCE_ANNUAL_BUDGET_SUMMARY  gates /finance/annual-budget-summary and is mapped in
--                                  src/lib/pageRoutePageCodes.ts.
--
-- Why this matters, and how the two differ:
--
--   SALARY_DISPUTE has no page_catalog row in production at all. access.service.ts builds
--   its permission map from the ACTIVE page_catalog rows — including the super_admin
--   elevation branch, which iterates activePageCodes — so a code absent from the catalogue
--   can be granted to nobody and held by nobody. canViewPage('SALARY_DISPUTE') is therefore
--   false for every user, super_admin included, and the Salary Dispute Hub renders the
--   access-denied gate for the whole organisation. Because the gate denies rather than
--   errors, it reads as "you do not have access" instead of "this page was never
--   registered", which is why it has gone unnoticed.
--
--   FINANCE_ANNUAL_BUDGET_SUMMARY does exist in production, with four role grants, but was
--   inserted straight into the database without a migration. It works today and is left
--   working here; the row is added so a rebuilt environment reproduces it instead of
--   silently losing a page that production has. This is environment drift, not an outage.
--
-- Both were caught by src/tests/page-access-deployment.contract.test.ts, whose
-- "keeps every referenced page code present in SQL migrations" case had been red.
--
-- Idempotent: page_catalog.page_code is unique, so re-running updates metadata and inserts
-- nothing twice.
--
-- Grants are deliberately NOT issued here, following 604's reasoning: role grants are
-- driven by the role matrix, and issuing ad-hoc grants in a migration would create a
-- second, competing source of truth for who can see what. This migration only makes the
-- codes grantable. FINANCE_ANNUAL_BUDGET_SUMMARY keeps the grants it already has.

START TRANSACTION;

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('SALARY_DISPUTE', 'Salary Dispute Hub', '/payroll/salary-disputes', 'payroll',
   'Raise, track and resolve employee salary disputes against a processed payroll run.', 1),
  ('FINANCE_ANNUAL_BUDGET_SUMMARY', 'Annual Budget Summary', '/finance/annual-budget-summary', 'finance',
   'Annual budget position by cost centre, with utilisation against approved allocation.', 1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

COMMIT;

-- Rollback:
--   DELETE FROM page_catalog WHERE page_code = 'SALARY_DISPUTE';
-- SALARY_DISPUTE had no row before this migration, so the delete restores the prior state.
-- FINANCE_ANNUAL_BUDGET_SUMMARY is NOT part of the rollback: its row predates this file and
-- deleting it would remove a page production is actively serving.
