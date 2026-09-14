-- 601_retire_unimplemented_dashboard_pages.sql
--
-- Marks dashboard page codes inactive when no dashboard implements them.
--
-- Background: page_catalog advertises 27 *_DASHBOARD page codes and role_page_access
-- grants them, but the application implements exactly 12 role dashboards. The extra
-- codes are either duplicates of a page that is served under a different code, or were
-- never built. Because WorkforcePageGate consults role_page_access, these grants read
-- as real entitlements — heads were granted "FINANCE_HEAD_DASHBOARD" and landed
-- nowhere.
--
-- This does NOT delete anything (rows stay for audit) and does NOT revoke any grant:
-- it only flips page_catalog.active_status to 0 so the codes stop being offered.
-- Reverse by setting active_status back to 1.
--
-- Codes deliberately LEFT ACTIVE because a real page serves them:
--   ATS_DASHBOARD            -> /ats/command-center
--   LMS_MANAGEMENT_DASHBOARD -> /lms/management-dashboard
--   LMS_PROGRESS_DASHBOARD   -> /lms/progress-dashboard
--   TAT_DASHBOARD            -> /governance/tat-dashboard
--
-- NOT EXECUTED AUTOMATICALLY. Review, then run against the target schema.

UPDATE page_catalog
   SET active_status = 0
 WHERE page_code IN (
   -- Superseded: the page exists, but is served under a different page_code.
   'KPI_DASHBOARD',              -- served by OPERATIONS_KPI (/operations-kpi)
   'EMPLOYEE_DASHBOARD',         -- served by EMPLOYEE_MANAGEMENT (/employees)
   'PAYROLL_DASHBOARD',          -- served by PAYROLL (/payroll)
   'PROVISIONING_DASHBOARD',     -- served by PROVISIONING_ADMIN and PROVISIONING_IT
   'OPERATIONS_HEAD_DASHBOARD',  -- served by OPERATIONS_DASHBOARD
   'MANAGER_DASHBOARD',          -- served by MANAGEMENT_DASHBOARD
   'PROCESS_MANAGER_DASHBOARD',  -- served by MANAGEMENT_DASHBOARD
   'BRANCH_HEAD_DASHBOARD',      -- served by MANAGEMENT_DASHBOARD / OPERATIONS_DASHBOARD

   -- Never implemented anywhere, and no backing data exists that PAYROLL_HR_DASHBOARD
   -- does not already cover.
   'FINANCE_HEAD_DASHBOARD',
   'COMPLIANCE_DASHBOARD',
   'PERFORMANCE_DASHBOARD'
 );

-- Verification (run after applying):
--   SELECT page_code, active_status FROM page_catalog
--    WHERE page_code LIKE '%DASHBOARD%' ORDER BY active_status DESC, page_code;
-- Expect 16 active: the 12 implemented role dashboards plus the 4 listed above.
