-- Onfido process KPI/Quality/Operations dashboard — new page, additive only.
-- Reads onfido_db (a separate physical database, populated via the Bulk Upload Hub's
-- 7 Onfido report templates); this migration only touches mas_hrms's access-control
-- tables so the page is reachable and gated like every other dashboard.

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'ONFIDO_PROCESS_DASHBOARD', 'Onfido Process Dashboard', '/onfido-process/dashboard', 'Quality', 1);

INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  (UUID(), 'super_admin',     'ONFIDO_PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',           'ONFIDO_PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'ceo',             'ONFIDO_PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'coo',             'ONFIDO_PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'manager',         'ONFIDO_PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'process_manager', 'ONFIDO_PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'team_leader',     'ONFIDO_PROCESS_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_head',     'ONFIDO_PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'qa',              'ONFIDO_PROCESS_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'quality_analyst', 'ONFIDO_PROCESS_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'wfm',             'ONFIDO_PROCESS_DASHBOARD', 1, 0, 0, 0, 1, 1);
