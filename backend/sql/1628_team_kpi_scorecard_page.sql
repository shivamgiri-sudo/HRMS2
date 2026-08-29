-- 1628 — Team KPI Scorecard page catalog entry and role grants
--
-- NOT YET EXECUTED. Additive change against production RBAC data; needs the owner's
-- explicit approval before it runs (CLAUDE.md: no SQL on production without it).
--
-- WHAT THIS DOES
-- Registers TEAM_KPI_SCORECARD (route /kpi/my-team), the manager-facing page that lists
-- every direct report with their assigned KPIs and current achievement vs target, and
-- drills into any one of them. The page and route ship in the same change:
--   src/pages/KpiTeamScorecard.tsx
--   src/config/routes/performance.routes.tsx  (Gate pageCode="TEAM_KPI_SCORECARD")
--   src/components/layout/navConfig.tsx       (Performance > Team KPI Scorecard)
--   src/lib/pageRoutePageCodes.ts             ("/kpi/my-team" -> TEAM_KPI_SCORECARD)
--
-- The catalog row matters on its own: access.service.ts builds its permission map from the
-- ACTIVE page_catalog rows — including the super_admin elevation branch, which iterates
-- activePageCodes — so a code absent from the catalogue can be held by nobody and the gate
-- denies the whole organisation, super_admin included (see 1616 for the same defect).
--
-- Grants go to the manager-tier roles, read-only: can_view = 1 and nothing else. The matching
-- in-code mirror is backend/src/shared/rbacPageMatrix.ts, updated in the same change, so a
-- future run of scripts/apply-rbac-page-matrix.mjs treats these as intended rather than as
-- drift to revoke.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- It does not widen what anyone SEES. Both endpoints behind the page
-- (GET /api/kpi-master/team-summary, GET /api/kpi-master/live/:empId) scope rows through the
-- caller's own reporting line. A grant here opens the page; it does not open other people's
-- teams.
--
-- ROLLBACK
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'TEAM_KPI_SCORECARD';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'TEAM_KPI_SCORECARD';

-- page_catalog.page_code is UNIQUE, so re-running refreshes metadata and inserts nothing
-- twice. id is CHAR(36) DEFAULT (UUID()) and is left to the default.
INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES (
  'TEAM_KPI_SCORECARD',
  'Team KPI Scorecard',
  '/kpi/my-team',
  'KPI',
  'Manager view: direct-report KPI assignments and achievement vs target',
  1
)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

-- Grant view access to the manager-tier roles. Mirrors rbacPageMatrix.ts exactly.
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), r.role_key, 'TEAM_KPI_SCORECARD', 1, 0, 0, 0, 0, 1, NOW()
  FROM (
    SELECT 'manager'           AS role_key UNION ALL
    SELECT 'process_manager'              UNION ALL
    SELECT 'assistant_manager'            UNION ALL
    SELECT 'branch_head'                  UNION ALL
    SELECT 'branch_manager'               UNION ALL
    SELECT 'team_leader'                  UNION ALL
    SELECT 'tl'                           UNION ALL
    SELECT 'ho_hr'                        UNION ALL
    SELECT 'hr_admin'                     UNION ALL
    SELECT 'hr'                           UNION ALL
    SELECT 'ceo'                          UNION ALL
    SELECT 'coo'                          UNION ALL
    SELECT 'super_admin'
  ) r
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access existing
    WHERE existing.role_key  = r.role_key
      AND existing.page_code = 'TEAM_KPI_SCORECARD'
 );

-- Re-activate rather than duplicate, for any of the thirteen that exist but were switched off.
UPDATE role_page_access
   SET can_view = 1, active_status = 1
 WHERE page_code = 'TEAM_KPI_SCORECARD'
   AND role_key IN (
     'manager','process_manager','assistant_manager','branch_head','branch_manager',
     'team_leader','tl','ho_hr','hr_admin','hr','ceo','coo','super_admin'
   );

SELECT 'Migration 1628 applied: TEAM_KPI_SCORECARD page catalog + role_page_access' AS migration_status;

-- Verification after running:
--   SELECT page_code, page_path, active_status FROM page_catalog
--    WHERE page_code = 'TEAM_KPI_SCORECARD';
--   -- expected: 1 row, /kpi/my-team, active_status = 1
--
--   SELECT COUNT(*) AS roles_with_view FROM role_page_access
--    WHERE page_code = 'TEAM_KPI_SCORECARD' AND can_view = 1 AND active_status = 1;
--   -- expected: 13
