-- Migration 1653: grant ATS_BGV / ATS_BGV_REPORT page access to the HR-variant roles
-- migration 1645's own comments in backend/src/shared/rbacPageMatrix.ts already declared
-- as intended (branch_hr, hr_admin, ho_hr, process_hr, recruitment_hr) — but that intent
-- was never actually written into role_page_access, the table WorkforcePageGate's
-- canViewPage() reads at runtime. Migration 1645 itself only touched role_report_permissions
-- (a different table, for the Report Library's "bgv-status" report code), so the BGV
-- Verification Center page (/ats/bgv, pageCode ATS_BGV) stayed invisible to every one of
-- these roles despite their backend API access (bgv-verification.routes.ts) already being
-- granted for the same roles since that migration.
--
-- Additive and idempotent: ON DUPLICATE KEY UPDATE re-activates a grant that already exists
-- but was previously deactivated, and touches no other role/page pair.
INSERT INTO role_page_access
  (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('branch_hr',      'ATS_BGV',        1, 1, 1, 0, 1, 1),
  ('branch_hr',      'ATS_BGV_REPORT', 1, 1, 1, 0, 1, 1),
  ('hr_admin',       'ATS_BGV',        1, 1, 1, 0, 1, 1),
  ('hr_admin',       'ATS_BGV_REPORT', 1, 1, 1, 0, 1, 1),
  ('ho_hr',          'ATS_BGV',        1, 1, 1, 0, 1, 1),
  ('ho_hr',          'ATS_BGV_REPORT', 1, 1, 1, 0, 1, 1),
  ('process_hr',     'ATS_BGV',        1, 1, 1, 0, 1, 1),
  ('process_hr',     'ATS_BGV_REPORT', 1, 1, 1, 0, 1, 1),
  ('recruitment_hr', 'ATS_BGV',        1, 1, 1, 0, 1, 1),
  ('recruitment_hr', 'ATS_BGV_REPORT', 1, 1, 1, 0, 1, 1),
  -- payroll_hr: not in rbacPageMatrix.ts's ATS_BGV list, but the backend API already grants
  -- it view access on GET/POST /report (bgv-verification.routes.ts) and the frontend page's
  -- ALLOWED list now includes it too (src/pages/NativeBGVVerificationCenter.tsx) — added here
  -- so all three layers (API, page-level check, page_access grant) agree for this role.
  ('payroll_hr',     'ATS_BGV',        1, 0, 1, 0, 1, 1),
  ('payroll_hr',     'ATS_BGV_REPORT', 1, 0, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit = VALUES(can_edit),
  can_delete = VALUES(can_delete),
  can_export = VALUES(can_export),
  active_status = 1;
