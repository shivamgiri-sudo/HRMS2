-- Client Process KPI Dashboard (per-client/process SLA targets, 4-level drilldown) —
-- new page, additive only. Reads mas_hrms's own kpi_daily_actual/kpi_metric_master;
-- this migration only touches access-control tables so the page is reachable and
-- gated the same way every other performance dashboard is (same viewer set as
-- OPERATIONS_DASHBOARD / process-performance.routes.ts).

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'PROCESS_KPI_DASHBOARD', 'Process KPI Dashboard', '/performance/process-kpi-dashboard', 'Performance', 1);

INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  (UUID(), 'super_admin',        'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',              'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'ceo',                'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'coo',                'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'manager',            'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'process_manager',    'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'operations_manager', 'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'branch_head',        'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 1, 1),
  (UUID(), 'qa',                 'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'quality_analyst',    'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'tq_head',            'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 0, 1);
