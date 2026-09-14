-- 1101_team_attendance_page_path_fix.sql
--
-- The Team Attendance page is unreachable, in two independent ways at once, and has been
-- since it was built. This corrects the database half; the router half is corrected in the
-- same change (src/config/routes/workforce.routes.tsx, src/lib/pageRoutePageCodes.ts,
-- src/components/layout/navConfig.tsx).
--
-- WHAT IS ACTUALLY WRONG
--
--   1. page_catalog.TEAM_ATTENDANCE points at '/team/attendance'.
--      No such route is mounted anywhere in src/config/routes. ModuleLauncher navigates users
--      straight to page_catalog.page_path, so every wfm, trainer, manager and tq_head user
--      who has this grant lands on "Oops! Page not found". This is the same defect that
--      WORKFORCE_COMMAND_CENTER had, and which page-catalog-route-drift.contract.test.ts was
--      written to catch.
--
--   2. The route that DOES exist, '/wfm/team-attendance', gates on TEAM_ATTENDANCE_MONTH —
--      a page code that appears in no migration at all. The page gate denies unknown codes
--      rather than erroring, so the page reads as "you do not have access" to everyone,
--      including super_admin. Two codes, one page, and neither path works.
--
-- WHY CONSOLIDATE ONTO TEAM_ATTENDANCE RATHER THAN SEED TEAM_ATTENDANCE_MONTH
--   Seeding the second code would leave both alive and require inventing grants for it —
--   deciding who may see the page, which is a business decision this migration has no
--   standing to make. TEAM_ATTENDANCE already carries the grants the organisation actually
--   issued (wfm, trainer and manager in 102_role_page_access_seed.sql, tq_head in the RBAC
--   matrix, super_admin via 309). Pointing the route at that code honours the decision
--   already on record instead of creating a second, competing source of truth for it —
--   the same reasoning as 1097_page_code_alias_grant_reconciliation.sql, which retired an
--   alias rather than blessing it.
--
-- NET EFFECT ON ACCESS
--   The page is currently reachable by NOBODY. After this, it is reachable by users who both
--   hold the TEAM_ATTENDANCE grant AND already pass the route's own ProtectedRoute role list
--   (super_admin, admin, hr, wfm, manager, assistant_manager, tl, team_leader,
--   process_manager, branch_head). In practice that is wfm and manager; trainer and tq_head
--   hold the grant but are not in the route's role list, so they remain excluded exactly as
--   they are today. No grant is created, widened or removed here.
--
-- Idempotent: a targeted UPDATE keyed on page_code, guarded so re-running is a no-op and so
-- it cannot clobber a path someone has since corrected by hand.

START TRANSACTION;

UPDATE page_catalog
   SET page_path = '/wfm/team-attendance'
 WHERE page_code = 'TEAM_ATTENDANCE'
   AND page_path = '/team/attendance';

COMMIT;

-- Rollback:
--   UPDATE page_catalog
--      SET page_path = '/team/attendance'
--    WHERE page_code = 'TEAM_ATTENDANCE'
--      AND page_path = '/wfm/team-attendance';
-- This restores the previous value, which pointed at an unmounted route — the rollback
-- reinstates the 404 rather than a working state, and is offered only for completeness.
