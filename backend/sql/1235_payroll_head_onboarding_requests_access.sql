-- Migration 1235: grant payroll_head the ATS_ONBOARDING_REQUESTS page.
--
-- User request: "resend onboarding link" should be reachable by branch payroll HR (the
-- branch_hr role — verified it already holds this page grant, live, active), super_admin
-- (already has it) and payroll_head (did not have it). Backend access (requireRole on
-- POST /send-token/:candidateId and GET /requests, plus the row-scope check on both) is
-- granted in the same change to ats.onboarding.routes.ts — this migration only covers the
-- frontend page gate (WorkforcePageGate on ATS_ONBOARDING_REQUESTS), which blocks the page
-- before the backend fix would ever matter.
--
-- payroll_head is also added to backend/src/shared/rbacPageMatrix.ts's ROLE_SPECIFIC_PAGE_CODES
-- in the same change, so a future run of apply-rbac-page-matrix.mjs treats this grant as
-- intended rather than drift to be refused/revoked.
--
-- Additive only: does not touch any other role's grants. Guarded on ON DUPLICATE KEY UPDATE,
-- same pattern as migration 270.

-- Mirrors branch_hr's existing grant on this page (can_view=1, can_create=1, can_edit=1,
-- can_delete=0, can_export=0) rather than hr's view-only row — payroll_head is meant to
-- actually perform the resend action, not just see the list.
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES ('payroll_head', 'ATS_ONBOARDING_REQUESTS', 1, 1, 1, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit = VALUES(can_edit),
  active_status = 1;
