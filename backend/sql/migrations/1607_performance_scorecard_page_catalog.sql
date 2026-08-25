-- Task 8 of employee-performance-scorecard plan: page_catalog + role_page_access seed
-- for PERFORMANCE_SCORECARD_COMMAND_CENTER, consumed by WorkforcePageGate in a later
-- frontend task.
--
-- Schema verified live 2026-08-25 against page_catalog/role_page_access via
-- `SELECT * FROM page_catalog WHERE page_code = 'PIP_MANAGEMENT'` and the equivalent
-- role_page_access query:
--   page_catalog: id CHAR(36) PK DEFAULT (uuid()), page_code VARCHAR(100) UNIQUE NOT NULL,
--     page_name VARCHAR(255) NOT NULL, page_path VARCHAR(255) NULL, module VARCHAR(100) NULL,
--     description TEXT NULL, active_status TINYINT(1) NOT NULL DEFAULT 1,
--     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP (no updated_at column).
--   role_page_access: id CHAR(36) PK DEFAULT (uuid()), role_key VARCHAR(100) NOT NULL,
--     page_code VARCHAR(100) NOT NULL, can_view/can_create/can_edit/can_delete/can_export
--     TINYINT(1) NOT NULL DEFAULT 0, active_status TINYINT(1) NOT NULL DEFAULT 1,
--     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP (no updated_at column).
--
-- Role list is the CURRENT, live PERFORMANCE_SCORECARD.allowedRoleKeys from
-- backend/src/shared/dashboardAccessRegistry.ts (read fresh 2026-08-25, matches the
-- brief's corrected list exactly — admin and wfm are deliberately excluded per the
-- 2026-08-22 incident documented in
-- backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts).
--
-- can_view only (matches the read-only "command center" surface this page gates);
-- can_create/can_edit/can_delete/can_export left at their table default of 0.
-- Purely additive, idempotent (WHERE NOT EXISTS guards), no existing table touched.

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status, created_at)
SELECT UUID(), 'PERFORMANCE_SCORECARD_COMMAND_CENTER', 'Performance Scorecard Command Center', '/performance-scorecard/command-center', 'performance', 'Employee performance scorecard command center dashboard', 1, NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM page_catalog WHERE page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'
);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), roles.role_key, 'PERFORMANCE_SCORECARD_COMMAND_CENTER', 1, 0, 0, 0, 0, 1, NOW()
FROM (
  SELECT 'manager' AS role_key UNION ALL SELECT 'process_manager' UNION ALL SELECT 'assistant_manager'
  UNION ALL SELECT 'branch_head' UNION ALL SELECT 'branch_manager' UNION ALL SELECT 'team_leader' UNION ALL SELECT 'tl'
  UNION ALL SELECT 'hr' UNION ALL SELECT 'hr_admin' UNION ALL SELECT 'ho_hr' UNION ALL SELECT 'branch_hr' UNION ALL SELECT 'process_hr'
  UNION ALL SELECT 'ceo' UNION ALL SELECT 'coo' UNION ALL SELECT 'management' UNION ALL SELECT 'super_admin'
) roles
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access
  WHERE role_key = roles.role_key AND page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'
);
