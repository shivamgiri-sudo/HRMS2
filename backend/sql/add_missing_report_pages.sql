-- =====================================================
-- Add Missing Report Pages - Phase 2
-- Date: 2026-07-14
-- Purpose: Add 2 critical missing report pages and
--          fix Employee Journey naming confusion
-- =====================================================

-- Insert missing page catalog entries
INSERT INTO page_catalog (page_code, page_name, module, active_status) VALUES
  -- LMS Progress Dashboard
  ('LMS_PROGRESS_DASHBOARD', 'LMS Progress Dashboard', 'Learning', 1),

  -- Compliance Audit Report (note: route exists as /compliance/audit-report)
  ('COMPLIANCE_AUDIT_REPORT', 'Compliance Audit Report', 'Compliance', 1)
ON DUPLICATE KEY UPDATE active_status = 1;

-- Grant default role permissions
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
  -- LMS Progress Dashboard - View access for managers, HR, admin
  ('admin', 'LMS_PROGRESS_DASHBOARD', 1, 0, 0, 0, 1),
  ('hr', 'LMS_PROGRESS_DASHBOARD', 1, 0, 0, 0, 1),
  ('manager', 'LMS_PROGRESS_DASHBOARD', 1, 0, 0, 0, 0),
  ('process_manager', 'LMS_PROGRESS_DASHBOARD', 1, 0, 0, 0, 0),
  ('super_admin', 'LMS_PROGRESS_DASHBOARD', 1, 0, 0, 0, 1),

  -- Compliance Audit Report - View access for admin, HR, super admin
  ('admin', 'COMPLIANCE_AUDIT_REPORT', 1, 0, 1, 0, 1),
  ('hr', 'COMPLIANCE_AUDIT_REPORT', 1, 0, 0, 0, 1),
  ('super_admin', 'COMPLIANCE_AUDIT_REPORT', 1, 0, 1, 0, 1)
ON DUPLICATE KEY UPDATE can_view = 1;

-- Note: Employee Journey pages (/employee-journey and /employee-stat-card)
-- do not require pageCode - they have no restrictions in App.tsx routes
-- Sidebar has been updated with clear naming to distinguish between:
-- - "Employee Stat Card" (current metrics dashboard)
-- - "Career Timeline" (career progression timeline)

-- Verification query (optional - run manually to verify)
-- SELECT pc.page_code, pc.page_name, pc.module, pc.active_status,
--        rpa.role_key, rpa.can_view, rpa.can_export
-- FROM page_catalog pc
-- LEFT JOIN role_page_access rpa ON pc.page_code = rpa.page_code
-- WHERE pc.page_code IN ('LMS_PROGRESS_DASHBOARD', 'COMPLIANCE_AUDIT_REPORT')
-- ORDER BY pc.page_code, rpa.role_key;
