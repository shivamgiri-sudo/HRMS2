-- 1661_restrict_audit_security_access_control_to_super_admin.sql
--
-- Owner's decision, 2026-09-03: AUDIT_LOG, SECURITY_CENTER and ACCESS_CONTROL are super-admin
-- only. Every other role's view grant on those three pages is revoked here, and the matching
-- routes in platform.routes.tsx are narrowed to roles={['super_admin']} in the same change.
--
-- WHY BOTH ENDS. The route roles decide whether the URL resolves; role_page_access decides whether
-- the Gate renders the page and whether the sidebar shows the link. Narrowing only the route would
-- leave the nav entry visible to anyone holding a grant, and revoking only the grant would leave
-- the URL reachable up to the Gate's denial screen. Neither half is sufficient on its own.
--
-- WHAT IS REVOKED (measured live immediately before writing this file):
--   ACCESS_CONTROL  : admin, branch_admin, payroll_head
--   AUDIT_LOG       : admin, branch_admin, it_head, payroll_head
--   SECURITY_CENTER : admin, branch_admin, it_head, payroll_head
--
-- super_admin keeps access without needing a row at all: access.service.ts elevates it to every
-- active page_catalog code regardless of role_page_access, so these three stay reachable for it
-- even though this migration touches nothing belonging to it.
--
-- SOFT REVOKE, NOT DELETE. active_status = 0 leaves the row and its history in place, so the
-- decision is reversible by flipping one column and is visible to anyone auditing why a role lost
-- a page. No row is removed and no other page is touched.
--
-- Rollback:
--   UPDATE role_page_access SET active_status = 1
--    WHERE page_code IN ('AUDIT_LOG','SECURITY_CENTER','ACCESS_CONTROL')
--      AND role_key IN ('admin','branch_admin','it_head','payroll_head');

USE mas_hrms;

UPDATE role_page_access
   SET active_status = 0
 WHERE page_code IN ('AUDIT_LOG', 'SECURITY_CENTER', 'ACCESS_CONTROL')
   AND role_key <> 'super_admin'
   AND active_status = 1;

-- Verification (expect super_admin only, or no rows at all, per page):
-- SELECT page_code, role_key, can_view, active_status
--   FROM role_page_access
--  WHERE page_code IN ('AUDIT_LOG','SECURITY_CENTER','ACCESS_CONTROL')
--    AND active_status = 1
--  ORDER BY page_code, role_key;
