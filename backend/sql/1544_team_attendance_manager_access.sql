-- 1544_team_attendance_manager_access.sql
-- Grants TEAM_ATTENDANCE page access to the roles the page was actually built for.
--
-- TEAM_ATTENDANCE ("Team Attendance", /wfm/team-attendance) is the manager's whole-team,
-- whole-month attendance grid. Its nav entry (navConfig.tsx), its route guard
-- (workforce.routes.tsx's ProtectedRoute roles list) and its own API
-- (team-attendance-month.routes.ts's requireRole) all name manager, process_manager,
-- tl, team_leader, assistant_manager and branch_head as intended users.
--
-- role_page_access never granted it to any of them — verified live 2026-08-22: the only
-- role_key rows for page_code='TEAM_ATTENDANCE' were branch_qa, branch_wfm, qa, super_admin,
-- tq_head and wfm. Every manager/process_manager/tl/team_leader/assistant_manager/branch_head
-- login (79 of them at the time of this migration) hit "Access Denied" on the nav link, since
-- the frontend's page-code gate is what's actually enforced — the roles={...} prop on the
-- route and the nav item's own roles list are both cosmetic once a pageCode is present
-- (see hrms2-route-gating-mechanisms in project memory).
--
-- can_view only, matching the grant shape already used for qa/wfm/tq_head/branch_qa/branch_wfm
-- on this same page_code: there is no distinct "edit" capability on this screen itself —
-- writes happen through the flag/regularization endpoints, which are gated by their own
-- requireRole lists, not by can_create/can_edit here.

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'manager',            'TEAM_ATTENDANCE', 1, 0, 0, 0, 1, 1),
  (UUID(), 'process_manager',    'TEAM_ATTENDANCE', 1, 0, 0, 0, 1, 1),
  (UUID(), 'tl',                 'TEAM_ATTENDANCE', 1, 0, 0, 0, 1, 1),
  (UUID(), 'team_leader',        'TEAM_ATTENDANCE', 1, 0, 0, 0, 1, 1),
  (UUID(), 'assistant_manager',  'TEAM_ATTENDANCE', 1, 0, 0, 0, 1, 1),
  (UUID(), 'branch_head',        'TEAM_ATTENDANCE', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

SELECT '1544_team_attendance_manager_access.sql applied' AS migration_status;

-- Rollback:
--   DELETE FROM role_page_access
--    WHERE page_code = 'TEAM_ATTENDANCE'
--      AND role_key IN ('manager','process_manager','tl','team_leader','assistant_manager','branch_head');
