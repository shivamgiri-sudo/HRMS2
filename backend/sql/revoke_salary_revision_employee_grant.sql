-- Revoke the `employee` grant on SALARY_REVISION.
--
-- /salary-revision is the Payroll Head salary-revision console. Its route file names six
-- roles (payroll_hr, payroll_head, branch_head, hr, admin, super_admin) and `employee` is
-- not among them — but role_page_access grants SALARY_REVISION to `employee`, held by
-- 1,440 of ~1,530 live users, and the page grant was until now the only check the UI made.
-- Anyone who pasted the URL opened the console.
--
-- No pay data leaked: salary-revision.routes.ts guards every endpoint with
-- requireRole(FIXER_ROLES / REVIEWER_ROLES), so the screen rendered empty and each call
-- 403'd. The page should still never have opened.
--
-- The route-level ceiling now blocks it in the UI as well (ProtectedRoute applies the
-- route's own roles list again). This statement removes the underlying grant so the
-- sidebar stops offering the item and the two layers finally agree.
--
-- hr_admin holds the same grant and is likewise absent from the route list, but it has 0
-- live users, so it is left alone here rather than bundled into a security fix.

-- Before: expect one row, role_key 'employee' (or 'Employee'), active_status 1.
SELECT page_code, role_key, can_view, active_status
  FROM role_page_access
 WHERE page_code = 'SALARY_REVISION' AND LOWER(role_key) = 'employee';

UPDATE role_page_access
   SET active_status = 0
 WHERE page_code = 'SALARY_REVISION'
   AND LOWER(role_key) = 'employee';

-- After: the same row, now active_status 0.
SELECT page_code, role_key, can_view, active_status
  FROM role_page_access
 WHERE page_code = 'SALARY_REVISION' AND LOWER(role_key) = 'employee';

-- Who keeps access afterwards: expect admin, branch_head, hr, hr_admin, payroll_head,
-- payroll_hr, super_admin.
SELECT GROUP_CONCAT(role_key ORDER BY role_key SEPARATOR ' ') AS remaining_roles
  FROM role_page_access
 WHERE page_code = 'SALARY_REVISION' AND can_view = 1 AND active_status = 1;
