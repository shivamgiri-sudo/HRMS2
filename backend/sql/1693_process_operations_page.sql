-- Process Operations: the page that reads every metric a process actually has.
--
-- The Client Process KPI Dashboard scores a fixed registry of client-facing
-- targets. Metrics wired through KPI Studio are not on that list, so 57 metric
-- codes were holding real values with no page reading them. This registers the
-- page that does.
--
-- Read-only, and every number on it is scope-filtered per viewer inside the
-- service, so viewing is granted as widely as the other performance dashboards.
-- No create/edit/delete rights exist to grant: the page defines nothing.

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'PROCESS_OPERATIONS', 'Process Operations', '/process-operations', 'Performance', 1);

INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  (UUID(), 'super_admin',        'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',              'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'ceo',                'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'coo',                'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'manager',            'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'process_manager',    'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'operations_manager', 'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'branch_head',        'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'qa',                 'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'quality_analyst',    'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'tq_head',            'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'hr',                 'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'team_leader',        'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1);
