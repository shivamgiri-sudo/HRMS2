-- 1662_team_attendance_follows_reporting_line.sql
--
-- Owner's decision, 2026-09-03: Team Attendance belongs to whoever is set as reporting manager for
-- an employee — not to a role. This revokes the role-based view grants so the reporting line is the
-- only thing that opens the page.
--
-- WHERE ACCESS COMES FROM AFTER THIS. access.service.ts grants TEAM_ATTENDANCE to any caller with at
-- least one active direct report (`reporting_manager_id` or `manager_id`), and separately elevates
-- super_admin to every active page. Nothing else needs a row, and the rule is self-maintaining: a
-- new manager gets the page on next sign-in, and someone whose last reportee moves away loses it.
--
-- WHY A ROLE GRANT CANNOT EXPRESS THIS. Measured live: of the 66 people who actually hold reportees,
-- 63 carry only the `employee` role. Granting by role would therefore either hand the page to every
-- employee in the company or miss almost every real manager.
--
-- MEASURED IMPACT before writing this file — 39 users held the page through a role grant:
--   * 24 keep it, because they are reporting managers and the relationship rule covers them
--     (KAMAL SINGH 252 reportees, BILAL ANWAR 68, MOHD KASIM 55, and so on);
--   * 15 lose it, holding a role such as process_manager, team_leader, wfm, qa or branch_head while
--     nobody reports to them.
--
-- That second group is a real org fact, not missing data: 1,027 of 1,028 active employees have a
-- reporting manager recorded, so an empty reportee list means an empty team, not an unpopulated
-- field. This was checked precisely because revoking on incomplete data would have locked out
-- genuine managers.
--
-- IT Head is covered by the rule rather than by a role: PRATEEK HAJELA (it_head) has 2 reportees and
-- keeps the page; ANUP KUMAR, who also holds it_head but has none, does not — which is the intent.
--
-- SOFT REVOKE. active_status = 0 keeps every row and its history, so this reverses by flipping one
-- column and stays visible to anyone auditing why a role lost a page. No row is deleted, no other
-- page is touched, and super_admin's row is left alone.
--
-- Rollback:
--   UPDATE role_page_access SET active_status = 1
--    WHERE page_code = 'TEAM_ATTENDANCE' AND role_key <> 'super_admin';

USE mas_hrms;

UPDATE role_page_access
   SET active_status = 0
 WHERE page_code = 'TEAM_ATTENDANCE'
   AND role_key <> 'super_admin'
   AND active_status = 1;

-- Verification (expect super_admin only):
-- SELECT role_key, can_view, active_status
--   FROM role_page_access
--  WHERE page_code = 'TEAM_ATTENDANCE' AND active_status = 1;
