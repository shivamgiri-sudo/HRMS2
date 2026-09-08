-- Migration 1690: make the Appointment Letter screen reachable by the roles that
-- are actually allowed to use it, and correct its catalog path.
--
-- WHY
--
-- As of 2026-09-08, zero appointment letters had ever been issued. One cause was
-- the eligibility gate (fixed in code, see appointmentLetterEligibility.service.ts).
-- The other is here: the people the backend designates as issuers cannot see the
-- screen.
--
-- appointmentLetter.routes.ts declares:
--   ISSUE_ROLES = super_admin, admin, payroll_hr, payroll_head, hr
--   VIEW_ROLES  = ISSUE_ROLES + payroll, branch_head
--
-- role_page_access for PROVISIONING_APPOINTMENT_LETTER held, live:
--   hr           active_status=1   ok
--   super_admin  active_status=1   ok (bypasses anyway)
--   payroll_hr   active_status=1   ok
--   branch_hr    active_status=1   -- NOT a backend VIEW_ROLE (see note below)
--   branch_head  active_status=1   ok
--   admin        active_status=0   <-- DEACTIVATED, though admin is an ISSUE_ROLE
--   payroll_head  (no row at all)  <-- MISSING, and this is the approving authority
--   payroll       (no row at all)  <-- MISSING, VIEW_ROLE
--
-- So the Payroll Head — the person whose approval the letter's salary now depends
-- on entirely — had no way to open the screen, and admin had been switched off.
--
-- Note the nav entry in navConfig.tsx also carries roles: ["hr","admin","super_admin"],
-- but that array is dead for this item: navigationAccess.ts:36 returns on pageCode
-- before it ever reads item.roles. This table is the only gate that matters, which
-- is why the fix is a migration and not a frontend edit.
--
-- branch_hr is granted the page but is NOT in the backend's VIEW_ROLES, so such a
-- user would see the menu item, open the screen and collect a 403 from every call
-- it makes. Deactivated below. This revokes nothing: `branch_hr` has **zero
-- holders** in user_roles (checked live 2026-09-08), so no working access exists
-- to take away.
--
-- It is also redundant by design. Branch-level HR is expressed in this system as
-- the `hr` role plus a branch-scoped user_assignment_scope row — that is exactly
-- what the branch RBAC on this router relies on ("a branch HR holds the same `hr`
-- role as a head-office HR"). A separate branch_hr role on this page is a second,
-- broken way to say the same thing.
--
-- ROLLBACK:
--   UPDATE role_page_access SET active_status = 0
--    WHERE page_code = 'PROVISIONING_APPOINTMENT_LETTER' AND role_key IN ('payroll_head','payroll');
--   UPDATE role_page_access SET active_status = 0
--    WHERE page_code = 'PROVISIONING_APPOINTMENT_LETTER' AND role_key = 'admin';
--   UPDATE role_page_access SET active_status = 1
--    WHERE page_code = 'PROVISIONING_APPOINTMENT_LETTER' AND role_key = 'branch_hr';
--   UPDATE page_catalog SET page_path = '/ats/joining-control-room?tab=appointment'
--    WHERE page_code = 'PROVISIONING_APPOINTMENT_LETTER';

-- ── 1. The catalog row points at a page that no longer serves this screen ─────
--
-- page_path was '/ats/joining-control-room?tab=appointment', a tab that predates
-- the dedicated queue. The live route is /provisioning/appointment-letter
-- (src/config/routes/compliance.routes.tsx). Module Launcher and every other
-- surface that deep-links from page_catalog was sending users to the old tab.
UPDATE page_catalog
   SET page_path = '/provisioning/appointment-letter',
       page_name = 'Appointment Letters'
 WHERE page_code = 'PROVISIONING_APPOINTMENT_LETTER';

-- ── 2. Grant the two missing roles ───────────────────────────────────────────
--
-- payroll_head issues AND is the approving authority for the salary the letter
-- prints. payroll is view-only per VIEW_ROLES; can_create/can_edit stay 0 so the
-- grant cannot be mistaken for issuing authority — the API enforces that
-- separately via requireRole(...ISSUE_ROLES), this only opens the door.
INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'payroll_head', 'PROVISIONING_APPOINTMENT_LETTER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'payroll',      'PROVISIONING_APPOINTMENT_LETTER', 1, 0, 0, 0, 1, 1);

-- INSERT IGNORE is a no-op when the row already exists, so re-run it as an
-- explicit reactivation for the case where a deactivated row is already present.
UPDATE role_page_access
   SET active_status = 1, can_view = 1
 WHERE page_code = 'PROVISIONING_APPOINTMENT_LETTER'
   AND role_key IN ('payroll_head', 'payroll');

-- ── 3. Re-activate admin ─────────────────────────────────────────────────────
--
-- admin is an ISSUE_ROLE in the router. The row exists with active_status = 0,
-- so INSERT IGNORE above would not have touched it.
UPDATE role_page_access
   SET active_status = 1, can_view = 1
 WHERE page_code = 'PROVISIONING_APPOINTMENT_LETTER'
   AND role_key = 'admin';

-- ── 4. Retire the branch_hr grant, which the API has never honoured ──────────
--
-- Zero holders live, and the router's VIEW_ROLES does not include it, so this
-- takes no working access from anyone — it removes a row that would hand a
-- 403-producing menu item to whoever is given the role next. Branch HR reaches
-- this screen as `hr` + a branch scope row, which is what the page's RBAC is
-- built around.
UPDATE role_page_access
   SET active_status = 0
 WHERE page_code = 'PROVISIONING_APPOINTMENT_LETTER'
   AND role_key = 'branch_hr';
