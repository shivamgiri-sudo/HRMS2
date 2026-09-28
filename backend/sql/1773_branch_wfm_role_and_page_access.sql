-- Migration 1773: Add branch_wfm to workforce_role_catalog and grant
-- OPERATIONS_DASHBOARD / PROCESS_KPI_DASHBOARD / PROCESS_DATA_SOURCE page
-- access to both wfm and branch_wfm roles.
-- Safe to replay (INSERT IGNORE on catalog, WHERE NOT EXISTS on page_access).

-- 1. Register branch_wfm in the role catalog so it appears in the Access Control UI.
INSERT IGNORE INTO workforce_role_catalog (role_key, role_name, description, active_status)
VALUES ('branch_wfm', 'Branch WFM', 'WFM analyst scoped to a specific branch', 1);

-- 2. Grant wfm and branch_wfm view access to process-performance pages.
--    WHERE NOT EXISTS guards prevent duplicate rows on re-run (no unique key on this table).
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'wfm', 'OPERATIONS_DASHBOARD', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='wfm' AND page_code='OPERATIONS_DASHBOARD');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'wfm', 'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='wfm' AND page_code='PROCESS_KPI_DASHBOARD');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'wfm', 'PROCESS_DATA_SOURCE', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='wfm' AND page_code='PROCESS_DATA_SOURCE');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_wfm', 'OPERATIONS_DASHBOARD', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_wfm' AND page_code='OPERATIONS_DASHBOARD');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_wfm', 'PROCESS_KPI_DASHBOARD', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_wfm' AND page_code='PROCESS_KPI_DASHBOARD');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_wfm', 'PROCESS_DATA_SOURCE', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_wfm' AND page_code='PROCESS_DATA_SOURCE');
