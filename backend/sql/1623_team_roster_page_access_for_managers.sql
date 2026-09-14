-- 1623 — My Team (TEAM_ROSTER) reaches the people who actually manage teams
--
-- NOT YET EXECUTED. This is an additive grant against production RBAC data and needs the
-- owner's explicit approval before it runs (CLAUDE.md: no SQL on production without it).
--
-- WHY
-- The My Team page is gated twice, and the two gates disagree with each other and with
-- reality. Counted live on 2026-08-27:
--
--   78   active employees have at least one active direct report
--   64   of those 78 hold ONLY the `employee` role
--   11   process_manager · 4 branch_head · 3 manager · 3 assistant_manager · 1 team_leader
--
--   role_page_access for TEAM_ROSTER granted to exactly: wfm, branch_wfm, super_admin
--   — three roles that appear nowhere in the page's own MANAGER_ROLES list.
--
-- So a real manager with 160 pending leave requests from her own reports was refused at the
-- door, while the page-code grant admitted roles the page itself then turned away.
--
-- WHAT THIS DOES
-- Grants TEAM_ROSTER view to the manager-shaped roles the page already expects, so the
-- page-code gate and the page's own gate finally describe the same audience. Read-only:
-- can_view = 1 and nothing else.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- It does not widen what anyone SEES. Every endpoint behind the page scopes rows through
-- resolveTeamScope() / assertCanViewMember(), both bound to the reporting line. A grant here
-- opens the page; it does not open other people's teams.
--
-- It also does not fix the 64 managers who hold only `employee`. Granting TEAM_ROSTER to
-- `employee` would hand the page to all 1,120 active staff, which is wrong. Those managers
-- are reached instead by the front-end change shipped alongside this file: MyTeamPage admits
-- anyone whose GET /employees/me reports is_manager = 1 (EXISTS a direct report). The right
-- long-term fix is a proper manager role assigned to those 64 people — a people-data
-- decision, not a migration.
--
-- ROLLBACK
--   UPDATE role_page_access SET active_status = 0
--    WHERE page_code = 'TEAM_ROSTER'
--      AND role_key IN ('manager','process_manager','team_leader','assistant_manager','branch_head','hr');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), r.role_key, 'TEAM_ROSTER', 1, 0, 0, 0, 0, 1, NOW()
  FROM (
    SELECT 'manager'           AS role_key UNION ALL
    SELECT 'process_manager'            UNION ALL
    SELECT 'team_leader'                UNION ALL
    SELECT 'assistant_manager'          UNION ALL
    SELECT 'branch_head'                UNION ALL
    SELECT 'hr'
  ) r
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access existing
    WHERE existing.role_key = r.role_key
      AND existing.page_code = 'TEAM_ROSTER'
 );

-- Re-activate rather than duplicate, for any of the six that exist but were switched off.
UPDATE role_page_access
   SET can_view = 1, active_status = 1
 WHERE page_code = 'TEAM_ROSTER'
   AND role_key IN ('manager','process_manager','team_leader','assistant_manager','branch_head','hr');
