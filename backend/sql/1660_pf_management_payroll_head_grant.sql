-- 1660_pf_management_payroll_head_grant.sql
--
-- Grants PAYROLL_PF_MANAGEMENT to payroll_head and payroll_branch — the two roles the ESI
-- registration-documents API is actually written for, and which could not open the page holding it.
--
-- THE MISMATCH. /payroll/pf-management admitted admin, super_admin, payroll_hr and payroll, while
-- esi-reg-docs.routes.ts guards every ESI endpoint with ESI_ROLES = payroll_branch, payroll_head,
-- super_admin. The only role in both was super_admin, which produced failure in both directions:
--
--   * payroll_head (2 live users) is trusted by the API but was refused by the route and had no
--     page grant, so the people the feature was built for could not reach it at all;
--   * payroll_hr (4 users) and payroll (2 users) could open the page and were shown an "ESI Reg.
--     Docs" tab whose every download returned 403.
--
-- The second half is fixed in the UI (PfManagement.tsx now renders that tab only for ESI_ROLES, so
-- a control that never worked is no longer advertised). This migration fixes the first half.
--
-- SCOPE AND RESTRAINT. The API's own guard is treated as the statement of intent, so the grant is
-- exactly ESI_ROLES minus super_admin (already covered by the all-active elevation in
-- access.service.ts). Deliberately NOT widening ESI_ROLES to payroll_hr/payroll: ESI registration
-- documents carry employee statutory and identity data, and who may pull them is a policy decision
-- for the payroll owner, not something to settle in a migration. If that widening is wanted later,
-- it belongs in esi-reg-docs.routes.ts first, with this grant following it.
--
-- payroll_branch currently has zero users; it is granted anyway so the page and the API agree, and
-- the role works the day someone is assigned it.
--
-- can_view/can_export only. No can_create/can_edit/can_delete: the ESI tab reads and downloads, and
-- the PF tabs' own write paths are guarded separately by their own endpoints.
--
-- Purely additive: INSERT ... ON DUPLICATE KEY UPDATE against role_page_access. No DDL, no DELETE,
-- no existing grant altered, no page_catalog change. Re-running writes the same two rows.
--
-- Rollback:
--   UPDATE role_page_access SET active_status = 0
--    WHERE page_code = 'PAYROLL_PF_MANAGEMENT' AND role_key IN ('payroll_head','payroll_branch');

USE mas_hrms;

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'payroll_head',   'PAYROLL_PF_MANAGEMENT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'payroll_branch', 'PAYROLL_PF_MANAGEMENT', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

-- Verification (expect payroll_head and payroll_branch present with can_view = 1):
-- SELECT role_key, can_view, can_export, active_status
--   FROM role_page_access
--  WHERE page_code = 'PAYROLL_PF_MANAGEMENT' ORDER BY role_key;
