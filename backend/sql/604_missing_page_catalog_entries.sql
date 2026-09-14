-- 604_missing_page_catalog_entries.sql
--
-- Registers two page codes that the application references but no migration ever created.
--
--   EMPLOYEE_STAT_CARD      routed at /employee-stat-card and /employee-stat-card/:id
--                           (src/lib/pageRoutePageCodes.ts) and listed in
--                           COMMON_USER_PAGE_CODES, i.e. a page every employee should hold.
--   WFM_BRANCH_SPOC_CONFIG  routed at /wfm/branch-spoc-config.
--
-- Neither exists in page_catalog in production, so role_page_access can hold no grant for
-- them and the page gate can never allow either route. The pages are effectively
-- unreachable, and because the gate denies rather than errors, that reads as "you do not
-- have access" instead of "this page was never registered".
--
-- Idempotent: page_catalog.page_code is unique, so re-running updates the metadata and
-- inserts nothing twice.
--
-- Grants are deliberately NOT issued here. EMPLOYEE_STAT_CARD is a common self-service
-- page and is granted through the same role matrix that already drives the others; issuing
-- ad-hoc grants in this migration would create a second, competing source of truth for who
-- can see what. This migration only makes the codes grantable.

START TRANSACTION;

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('EMPLOYEE_STAT_CARD', 'Employee Stat Card', '/employee-stat-card', 'employee',
   'Per-employee summary card: attendance, KPI and lifecycle status at a glance.', 1),
  ('WFM_BRANCH_SPOC_CONFIG', 'Branch SPOC Configuration', '/wfm/branch-spoc-config', 'wfm',
   'Maps each branch to its WFM single point of contact for roster and attendance escalation.', 1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

COMMIT;

-- Rollback:
--   DELETE FROM page_catalog
--    WHERE page_code IN ('EMPLOYEE_STAT_CARD', 'WFM_BRANCH_SPOC_CONFIG');
-- Neither code had a row before this migration, so the delete restores the prior state.
