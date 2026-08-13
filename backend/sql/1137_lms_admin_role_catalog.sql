-- 1137_lms_admin_role_catalog.sql
--
-- Seeds workforce_role_catalog with 'lms_admin' — a role lms.service.ts's
-- hasLmsAdminRole() has checked for since that function was written, but which was never
-- actually added to the catalog. Because assignRole() (access.service.ts) validates against
-- this catalog before writing user_roles, the role could never be granted to anyone through
-- the normal admin flow — confirmed live 2026-08-13 while diagnosing Harneet Kaur's
-- "LMS access is not assigned for the admin portal" error (MAS47782, T&Q Head, otherwise
-- exactly the kind of role that should hold this).
--
-- Additive only — INSERT ... ON DUPLICATE KEY UPDATE, safe to re-run.
-- No PII, no encryption keys involved (unlike 1136's blind-index migration) — this is static
-- reference data, safe to apply automatically at next boot via MIGRATION_MANIFEST.

INSERT INTO workforce_role_catalog (role_key, role_name, description, active_status)
VALUES (
  'lms_admin',
  'LMS Administrator',
  'Administrative access to the LMS Admin portal (course/content/assessment/certification management in the integrated LMS)',
  1
)
ON DUPLICATE KEY UPDATE
  role_name = VALUES(role_name),
  description = VALUES(description),
  active_status = 1;

SELECT '1137_lms_admin_role_catalog.sql applied successfully' AS migration_status;
