-- Retire role keys that are pure aliases of another role, so one job has one set of rights.
--
-- Measured live 2026-10-01 before writing this: each role below has ZERO active user_roles rows and every
-- page it grants is already granted to its canonical role (checked per pair; "extras" = 0), so retiring it
-- changes nobody's effective access:
--   tl              -> team_leader        (48 of 48 grants also on team_leader)
--   it_admin        -> it                 (40 of 40)
--   quality_analyst -> qa                 (50 of 50; qa is the key the live QA user holds and the routes list)
--   quality         -> quality_analyst/qa (22 of 22)
--   accounts        -> accounts_head      (stray catalog row, 1 grant)
--   payroll_admin   -> payroll            (platform/policy/roles.ts already treats payroll_admin as payroll). Its one
--                      holder (MAS00175) is also super_admin and payroll_hr, so dropping the row loses nothing.
--
-- NOT merged here because a merge changes real users' access:
--   recruitment_hr, payroll -> payroll_hr (payroll is named alone in hundreds of route role lists and payroll_hr
--   is not its alias there), manager <-> process_manager.
--
-- Reversible: the retired grant rows are copied to role_page_access_retired_1988 first, and are only
-- deactivated (active_status = 0), never deleted. To undo, set active_status = 1 for the keys below
-- in role_page_access and workforce_role_catalog.
CREATE TABLE IF NOT EXISTS role_page_access_retired_1988 LIKE role_page_access;
CREATE TABLE IF NOT EXISTS user_roles_retired_1988 LIKE user_roles;

-- payroll_admin: deactivate the assignment only for a holder who keeps super_admin or payroll_hr.
INSERT INTO user_roles_retired_1988
SELECT u.* FROM user_roles u
 WHERE u.role_key = 'payroll_admin' AND u.active_status = 1
   AND EXISTS (SELECT 1 FROM user_roles k WHERE k.user_id = u.user_id AND k.active_status = 1
                  AND k.role_key IN ('super_admin', 'payroll_hr'))
   AND NOT EXISTS (SELECT 1 FROM user_roles_retired_1988 b WHERE b.id = u.id);

UPDATE user_roles u
   SET u.active_status = 0
 WHERE u.role_key = 'payroll_admin' AND u.active_status = 1
   AND EXISTS (SELECT 1 FROM (SELECT user_id, role_key, active_status FROM user_roles) k
                WHERE k.user_id = u.user_id AND k.active_status = 1 AND k.role_key IN ('super_admin', 'payroll_hr'));

INSERT INTO role_page_access_retired_1988
SELECT g.* FROM role_page_access g
 WHERE g.role_key IN ('tl', 'it_admin', 'quality_analyst', 'quality', 'accounts', 'payroll_admin')
   AND NOT EXISTS (SELECT 1 FROM role_page_access_retired_1988 b WHERE b.id = g.id);

-- Safety net: a role is skipped if anyone has been assigned it since the measurement above.
UPDATE role_page_access g
   SET g.active_status = 0
 WHERE g.role_key IN ('tl', 'it_admin', 'quality_analyst', 'quality', 'accounts', 'payroll_admin')
   AND NOT EXISTS (SELECT 1 FROM user_roles u WHERE u.role_key = g.role_key AND u.active_status = 1);

UPDATE workforce_role_catalog c
   SET c.active_status = 0
 WHERE c.role_key IN ('tl', 'it_admin', 'quality_analyst', 'quality', 'accounts', 'payroll_admin')
   AND NOT EXISTS (SELECT 1 FROM user_roles u WHERE u.role_key = c.role_key AND u.active_status = 1);

-- Catalog labels that named the wrong thing in the role picker.
UPDATE workforce_role_catalog SET role_name = 'Branch IT' WHERE role_key = 'branch_it' AND role_name = 'Branch Finance';
UPDATE workforce_role_catalog SET role_name = 'Manager'   WHERE role_key = 'manager'   AND role_name = 'Process Manager';
