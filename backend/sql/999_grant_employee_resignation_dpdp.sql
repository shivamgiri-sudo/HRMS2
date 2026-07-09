-- Migration: Grant role access for missing nav pages
-- Purpose: Enable access for pages added to sidebar in nav audit
-- Date: 2026-07-09
-- Related Frontend Commit: 3ac94e91 (added 6 nav entries)

-- ================================================================
-- EMPLOYEE SELF-SERVICE PAGES
-- ================================================================

-- Grant employee role access to My Resignation page
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES (UUID(), 'employee', 'RESIGNATION_MY_REQUEST', 1, 1, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view = 1,
  can_create = 1,
  active_status = 1;

-- Grant employee role access to DPDP Withdrawal page
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES (UUID(), 'employee', 'DPDP_WITHDRAWAL', 1, 1, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view = 1,
  can_create = 1,
  active_status = 1;

-- ================================================================
-- APPOINTMENT E-SIGN PAGE (HR/Admin function)
-- ================================================================

-- Grant admin role access to Appointment E-sign page
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES (UUID(), 'admin', 'APPOINTMENT_ESIGN', 1, 1, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view = 1,
  can_create = 1,
  can_edit = 1,
  active_status = 1;

-- Grant hr role access to Appointment E-sign page
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES (UUID(), 'hr', 'APPOINTMENT_ESIGN', 1, 1, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view = 1,
  can_create = 1,
  can_edit = 1,
  active_status = 1;

-- Note: super_admin already has APPOINTMENT_ESIGN access from prior migration

-- ================================================================
-- OTHER PAGES (role-based only, no pageCode gates)
-- ================================================================
-- These pages use roles array in navConfig, no database grants needed:
-- - Employee Reactivation: roles ["hr","admin","super_admin","branch_head","payroll_head"]
-- - BGV API Monitor: roles ["admin","hr","super_admin"]
-- - Cheque Validation: roles ["payroll","payroll_head","super_admin","finance"]

-- ================================================================
-- VERIFICATION QUERIES (optional, comment out in production)
-- ================================================================
-- SELECT role_key, page_code, can_view, can_create, active_status
-- FROM role_page_access
-- WHERE page_code IN ('RESIGNATION_MY_REQUEST', 'DPDP_WITHDRAWAL', 'APPOINTMENT_ESIGN')
-- ORDER BY page_code, role_key;
