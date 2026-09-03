-- 1659_reactivate_gated_pages_locked_from_everyone.sql
--
-- Re-activates four page_catalog rows that are inactive while their pages are still routed,
-- gated and present in the navigation — so the menu entry is visible, and opening it denies
-- everyone, including super_admin.
--
-- WHY SUPER_ADMIN IS AFFECTED AT ALL. access.service.ts elevates super_admin to every page in
-- `activePageCodes` with full CRUD, overriding role_page_access entirely. That elevation is built
-- from page_catalog rows where active_status = 1, so an INACTIVE catalog row is the one and only
-- way a page can be closed to super_admin. Verified live 2026-09-03: super_admin holds grants on
-- 277 of 281 page codes, and the four it "lacks" (VENDOR_BANK_DETAILS, PAYROLL_TDS_PART_A,
-- SALARY_DISPUTE, plus HELPDESK_KB at can_view = 0) are all irrelevant precisely because the
-- elevation overrides them. The real lockout is here, in page_catalog.
--
-- WHY THESE FOUR AND NOT THE OTHER FIFTEEN. Production has 19 inactive catalog rows. Each was
-- checked against `<Gate pageCode="...">` in src/config/routes/ and against navConfig.tsx:
--
--   reactivated here (live route + live nav entry, component present):
--     BENEFITS        /benefits        NativeBenefitsClaims    1,379 lines
--     CLIENT_MASTER   /client-master   EnhancedClientMaster    1,231 lines
--     LEAVE_TYPES     /leave-types     NativeLeaveTypeConfig     521 lines
--     PROCESS_CONFIG  /process-config  NativeProcessConfig       872 lines
--
--   deliberately LEFT INACTIVE (no live Gate references them today, so an inactive row is
--   retirement rather than drift, and reactivating would resurrect pages nobody routed):
--     ADVANCED_REPORTS, APPOINTMENT_ESIGN, BRANCH_HEAD_DASHBOARD, COMPLIANCE_DASHBOARD,
--     EMPLOYEE_DASHBOARD, FINANCE_HEAD_DASHBOARD, HELPDESK, KPI_DASHBOARD, MANAGER_DASHBOARD,
--     OPERATIONS_HEAD_DASHBOARD, PAYROLL_DASHBOARD, PERFORMANCE_DASHBOARD,
--     PROCESS_MANAGER_DASHBOARD, PROVISIONING_DASHBOARD, QA_CALIBRATION
--
-- This is the same drift 1113 fixed for MODULE_LAUNCHER/ORG_CHART/ORG_MASTERS/CUSTOMIZATION_MANAGER
-- and is diagnosed the same way: a deliberate retirement names its codes in the migration that
-- performs it, and none of the retirement migrations (601, 1022, 1025, 1097/1105, 1108) names these
-- four.
--
-- SCOPE. Data only: one UPDATE against page_catalog.active_status. No DDL, no DELETE, no
-- role_page_access change, and no new grant to any non-super_admin role — each of these pages keeps
-- exactly the role grants it already has, so this restores reachability without widening access.
-- Idempotent: re-running sets the same four rows to the value they already hold.
--
-- Rollback:
--   UPDATE page_catalog SET active_status = 0
--    WHERE page_code IN ('BENEFITS','CLIENT_MASTER','LEAVE_TYPES','PROCESS_CONFIG');

USE mas_hrms;

UPDATE page_catalog
   SET active_status = 1
 WHERE page_code IN ('BENEFITS', 'CLIENT_MASTER', 'LEAVE_TYPES', 'PROCESS_CONFIG')
   AND active_status = 0;

-- Verification (expect four rows, all active_status = 1):
-- SELECT page_code, page_name, page_path, active_status
--   FROM page_catalog
--  WHERE page_code IN ('BENEFITS','CLIENT_MASTER','LEAVE_TYPES','PROCESS_CONFIG');
