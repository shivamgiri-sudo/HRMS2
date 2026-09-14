-- 432_workforce_role_catalog_ops_coo_qa_recruitment.sql
-- Close a pre-existing RBAC catalog gap discovered during Call Master / KPI
-- cockpit integration planning (2026-08-21): `operations_manager`, `coo`,
-- `quality_analyst`, and `recruitment_hr` are already treated as first-class
-- canonical roles by backend/src/platform/policy/roles.ts (Role enum +
-- normalizeRoleInputs/expandRoles), already have dashboard definitions in
-- shared/dashboardAccessRegistry.ts, and already have page-matrix entries in
-- shared/rbacPageMatrix.ts — but none of the four exist in
-- workforce_role_catalog, whose FK constrains user_roles.role_key. No user
-- can ever be assigned these roles today, so every route guard and dashboard
-- branch that checks for them is unreachable dead code, not a security hole
-- (fail-closed: absence just means "nobody can have this role" today).
--
-- This migration only adds the missing catalog rows so these roles become
-- assignable. It does not touch role_page_access, does not reassign any
-- existing user, and does not run the RBAC-matrix applier (that script can
-- revoke live grants absent from the matrix — see rbac_matrix_applied_grants,
-- 430_rbac_matrix_applied_grants.sql — and must be run separately/deliberately
-- by whoever actually assigns these roles to real employees).
--
-- Additive only — uses ON DUPLICATE KEY, mirrors 295_it_head_role.sql.

INSERT INTO workforce_role_catalog (role_key, role_name, description, active_status)
VALUES
  ('operations_manager', 'Operations Manager',
   'Cross-process operations oversight; named explicitly in CLAUDE.md role list. Already wired into dashboardAccessRegistry.ts, rbacPageMatrix.ts, and platform/policy/roles.ts.',
   1),
  ('coo', 'COO',
   'Chief Operating Officer; peer executive role to CEO. Already included in MANAGEMENT_ROLES (platform/policy/roles.ts) and multiple dashboard/page definitions.',
   1),
  ('quality_analyst', 'Quality Analyst',
   'QA/T&Q individual-contributor tier, distinct from qa (per qa-audit.routes.ts: quality_analyst can review but not author QA forms). Already a canonical Role in platform/policy/roles.ts.',
   1),
  ('recruitment_hr', 'Recruitment HR',
   'Named explicitly in CLAUDE.md role list and platform/policy/roles.ts (Role.RECRUITMENT_HR). NOTE: shared/dashboardAccessRegistry.ts currently aliases recruitment_hr -> recruiter for dashboard purposes while rbacPageMatrix.ts gives it its own page entry — pre-existing inconsistency, left as-is here; flagged for a separate decision, not resolved by this migration.',
   1)
ON DUPLICATE KEY UPDATE
  role_name = VALUES(role_name),
  description = VALUES(description),
  active_status = 1;

SELECT '432_workforce_role_catalog_ops_coo_qa_recruitment.sql applied successfully' AS migration_status;
