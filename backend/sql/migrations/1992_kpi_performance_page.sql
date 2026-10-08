-- Migration 1992: page code for the KPI Live Performance page (/kpi/performance).
-- The API scopes every request to the caller (self / team / branch / process / org), so the page itself is open to every
-- signed-in role; access is granted per role below plus the common user list in rbacPageMatrix. Purely additive: INSERT IGNORE.

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status)
VALUES (UUID(), 'KPI_PERFORMANCE', 'KPI Live Performance', '/kpi/performance', 'KPI', 1);

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), r.role_key, 'KPI_PERFORMANCE', 1, 0, 0, 0, 0, 1
  FROM (
    SELECT 'employee' AS role_key UNION ALL SELECT 'agent' UNION ALL SELECT 'trainee'
    UNION ALL SELECT 'team_leader' UNION ALL SELECT 'team_lead' UNION ALL SELECT 'tl' UNION ALL SELECT 'manager'
    UNION ALL SELECT 'assistant_manager' UNION ALL SELECT 'process_manager' UNION ALL SELECT 'operations_manager'
    UNION ALL SELECT 'qa' UNION ALL SELECT 'quality_analyst' UNION ALL SELECT 'qa_manager' UNION ALL SELECT 'quality_lead'
    UNION ALL SELECT 'branch_qa' UNION ALL SELECT 'tq_head' UNION ALL SELECT 'wfm' UNION ALL SELECT 'wfm_spoc'
    UNION ALL SELECT 'rta' UNION ALL SELECT 'branch_wfm' UNION ALL SELECT 'ho_wfm' UNION ALL SELECT 'ho_rta'
    UNION ALL SELECT 'branch_head' UNION ALL SELECT 'branch_manager' UNION ALL SELECT 'bm' UNION ALL SELECT 'operations_head'
    UNION ALL SELECT 'ho_operations' UNION ALL SELECT 'ceo' UNION ALL SELECT 'coo' UNION ALL SELECT 'management'
    UNION ALL SELECT 'trainer' UNION ALL SELECT 'hr' UNION ALL SELECT 'admin' UNION ALL SELECT 'super_admin'
  ) r;
