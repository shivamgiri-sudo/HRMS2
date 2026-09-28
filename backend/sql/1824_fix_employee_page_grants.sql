-- Revoke admin/payroll-level page grants incorrectly held by the `employee` role.
--
-- The employee role accumulated several management-level page codes that expose
-- admin dashboards and payroll consoles to regular employees. This migration
-- soft-deletes (active_status = 0) those rows so the sidebar no longer offers
-- these pages and the route guards agree.
--
-- Pages being revoked:
--   PAYROLL_RUNNING_BREAKDOWN   — "Running Salary" live breakdown; payroll/admin only
--   ENGAGEMENT_COMMAND_CENTER   — Engagement command centre; HR admin view
--   PEOPLE_EXPERIENCE_COMMAND_CENTER — PX command centre; HR admin overview
--   EMPLOYEE_LIFECYCLE          — Employee lifecycle admin console; HR admin only
--   SALARY_REVISION             — Salary revision console; payroll_hr / payroll_head only
--
-- SALARY_REVISION: the standalone revoke_salary_revision_employee_grant.sql file was
-- never registered in the migration manifest and never applied — this migration
-- supersedes it for the numbered migration pipeline.
--
-- None of these pages have employee-facing route-level guards, so the back-end
-- already returns 403 on the API calls. This fix removes the front-end nav grant.

-- Diagnostic: show current state of these grants before the change
SELECT page_code, role_key, can_view, active_status
  FROM role_page_access
 WHERE page_code IN (
   'PAYROLL_RUNNING_BREAKDOWN',
   'ENGAGEMENT_COMMAND_CENTER',
   'PEOPLE_EXPERIENCE_COMMAND_CENTER',
   'EMPLOYEE_LIFECYCLE',
   'SALARY_REVISION'
 )
   AND LOWER(role_key) = 'employee';

-- Revoke
UPDATE role_page_access
   SET active_status = 0
 WHERE page_code IN (
   'PAYROLL_RUNNING_BREAKDOWN',
   'ENGAGEMENT_COMMAND_CENTER',
   'PEOPLE_EXPERIENCE_COMMAND_CENTER',
   'EMPLOYEE_LIFECYCLE',
   'SALARY_REVISION'
 )
   AND LOWER(role_key) = 'employee';

-- Confirm: all five rows now inactive
SELECT page_code, role_key, can_view, active_status
  FROM role_page_access
 WHERE page_code IN (
   'PAYROLL_RUNNING_BREAKDOWN',
   'ENGAGEMENT_COMMAND_CENTER',
   'PEOPLE_EXPERIENCE_COMMAND_CENTER',
   'EMPLOYEE_LIFECYCLE',
   'SALARY_REVISION'
 )
   AND LOWER(role_key) = 'employee';
