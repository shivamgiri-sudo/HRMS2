-- Migration: seed the admin role_page_access grants for the two UAT admin pages
-- Date: 2026-08-08
--
-- WHY THIS EXISTS
--   1095_uat_feedback_intake.sql seeds page_catalog rows for the four UAT page codes, and
--   backend/src/shared/rbacPageMatrix.ts lists UAT_TRIAGE_CONSOLE and UAT_RELEASE_BOARD under
--   the admin role. Neither of those makes the pages openable.
--
--   getUserPageAccess() in backend/src/modules/access/access.service.ts resolves a user's pages
--   from three places, and only three:
--     - super_admin  -> every ACTIVE page_catalog row (access.service.ts:341)
--     - anyone else  -> their role_page_access rows, plus COMMON_USER_PAGE_CODES (:352-355)
--   rbacPageMatrix.ts is NOT read at runtime for role grants. It is the source the applier
--   script projects into role_page_access, so a code code listed there but never applied is
--   documentation, not access.
--
--   The result, verified against the live database on 2026-08-08:
--     role_page_access rows for page_code LIKE 'UAT!_%'  ->  0
--     admin's other grants in that same table            ->  48
--   So on deploy, super_admin would see all four UAT pages (all-active rule) and every
--   employee would see UAT_FEEDBACK (it is in COMMON_USER_PAGE_CODES) — but no admin could
--   open the triage console or the release board at all. The pages would ship unreachable by
--   the exact population meant to run them.
--
-- WHY NOT JUST RUN THE APPLIER
--   backend/scripts/apply-rbac-page-matrix.mjs --apply DEACTIVATES every grant that is absent
--   from the matrix. There are 132 live grants in that category. Running it to add two rows
--   would silently revoke them. This migration adds exactly two rows and revokes nothing.
--
-- WHY UAT_CHECKLIST_ADMIN IS NOT SEEDED HERE
--   Deliberate, and it matches the comment in rbacPageMatrix.ts. The checklist admin page
--   shows the guardrails that decide whether a change is acceptable; whoever can view them
--   should not be the same population that approves work evaluated under them. super_admin
--   reaches it through the all-active-pages rule and nobody else needs a grant.
--
-- WHY INSERT IGNORE RATHER THAN ON DUPLICATE KEY UPDATE
--   The repo's older seeds (999_grant_employee_resignation_dpdp.sql) use ON DUPLICATE KEY
--   UPDATE ... active_status = 1, which re-activates a grant on every re-run. Migrations
--   1105/1107/1108 exist precisely to RETIRE grants, so resurrecting a deliberately revoked
--   row is a real outcome here, not a hypothetical. INSERT IGNORE inserts when the row is
--   absent and does nothing when it is present, which keeps a later revocation a decision
--   somebody made rather than one this file quietly reverses. uq_role_page is the unique key
--   that makes that work.
--
-- Idempotent: re-running inserts nothing the second time.

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'admin', pc.page_code, 1, 1, 1, 0, 1, 1
  FROM page_catalog pc
 WHERE pc.page_code IN ('UAT_TRIAGE_CONSOLE', 'UAT_RELEASE_BOARD')
   AND pc.active_status = 1;

-- Verification (expects 2 rows):
--   SELECT role_key, page_code, can_view, active_status
--     FROM role_page_access
--    WHERE page_code IN ('UAT_TRIAGE_CONSOLE','UAT_RELEASE_BOARD') AND active_status = 1;
