-- KPI Studio page catalog entry and role grants.
--
-- The Studio backend, its six tables and its UI components have existed since
-- 2026-09-02, and 1644-1646 were applied to production on 2026-09-03. What was
-- never present is any way to REACH it: the router was not mounted in app.ts,
-- no page wrapped the builder components, and no page_catalog row existed — so
-- WorkforcePageGate had nothing to grant against even once a route was added.
-- This migration supplies only the access-control rows; it creates no tables.
--
-- Grants mirror kpi-studio.routes.ts's own lists exactly, so the page gate and
-- the API agree rather than drifting:
--   CONFIG_ROLES = admin, hr, process_manager, qa, tq_head   -> view + write
--   VIEW_ROLES   = CONFIG_ROLES + manager, branch_head, ceo, team_leader -> view
-- super_admin is never listed in the router because requireRole short-circuits
-- for it, but page_catalog IS read for super_admin, so it is granted here.
--
-- Authoring a formula decides what appears on somebody's appraisal, which is why
-- write is not granted to the wider viewer set.

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'KPI_STUDIO', 'KPI Studio', '/kpi-studio', 'Performance', 1);

INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  (UUID(), 'super_admin',     'KPI_STUDIO', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',           'KPI_STUDIO', 1, 1, 1, 1, 1, 1),
  (UUID(), 'hr',              'KPI_STUDIO', 1, 1, 1, 0, 1, 1),
  (UUID(), 'process_manager', 'KPI_STUDIO', 1, 1, 1, 0, 1, 1),
  (UUID(), 'qa',              'KPI_STUDIO', 1, 1, 1, 0, 1, 1),
  (UUID(), 'tq_head',         'KPI_STUDIO', 1, 1, 1, 0, 1, 1),
  (UUID(), 'manager',         'KPI_STUDIO', 1, 0, 0, 0, 1, 1),
  (UUID(), 'branch_head',     'KPI_STUDIO', 1, 0, 0, 0, 1, 1),
  (UUID(), 'ceo',             'KPI_STUDIO', 1, 0, 0, 0, 1, 1),
  (UUID(), 'team_leader',     'KPI_STUDIO', 1, 0, 0, 0, 0, 1);
