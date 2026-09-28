-- 1860_team_roster_page_access.sql
-- Registers the "Team Roster" page (/wfm/team-roster). The page is for anyone who has people
-- reporting to them (64 of the 78 real managers hold ONLY the employee role, so the grant goes
-- to employee as well) and for the WFM approvers. The grant is only the door: every endpoint
-- behind it resolves the caller's reporting tree / WFM scope server-side, and the page itself
-- shows "no team members" to an employee who has none. Roles absent from workforce_role_catalog
-- are skipped (INSERT ... SELECT from the catalog) rather than failing on the role FK.
-- Idempotent: ON DUPLICATE KEY UPDATE on both tables. Mirrors 1848 / 1851.

INSERT INTO page_catalog (page_code, page_name, module, page_path, description, active_status) VALUES
('WFM_TEAM_ROSTER', 'Team Roster', 'WFM', '/wfm/team-roster',
 'Reporting managers fill and change their team roster; manager then WFM approval before it is applied', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name),
  module = VALUES(module),
  page_path = VALUES(page_path),
  description = VALUES(description),
  active_status = 1;

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT c.role_key, 'WFM_TEAM_ROSTER', 1, 1, 1, 0, 0, 1
  FROM workforce_role_catalog c
 WHERE c.role_key IN ('employee', 'manager', 'process_manager', 'assistant_manager', 'team_leader', 'tl',
                      'branch_head', 'operations_manager', 'wfm', 'wfm_spoc', 'wfm_analyst', 'branch_wfm',
                      'ho_wfm', 'hr', 'admin', 'super_admin')
ON DUPLICATE KEY UPDATE
  can_view = 1, can_create = 1, can_edit = 1, active_status = 1;
