-- Migration 1779: Grant WFM_ROSTER_LIVE_MONITORING (Roster Console Live Monitoring tab)
-- page access to branch_wfm, process_manager and operations_manager.
--
-- Owner-specified access list, 2026-09-16: "branch WFM, Branch head, Process manager
-- (respective process), Operations manager (respective process) and super admin
-- (All branch)". branch_head already held the grant; super_admin needs no row (every
-- active page is auto-granted to super_admin in access.service.ts).
--
-- Process/branch scoping is enforced in code, not by this migration: roster-intelligence
-- .routes.ts now resolves each caller's real user_assignment_scope via
-- resolveDashboardScopeForRequest and passes branchIds/processIds into
-- detectUnplannedAbsences / generateManagerDailyDigests, which previously ran completely
-- unscoped (every branch_head/wfm caller already saw every branch's data — a pre-existing
-- gap, not something this migration introduces). wfm and super_admin keep the unrestricted
-- access the 2026-09-14 ruling (migration 1766) already gave them.
--
-- Safe to replay: WHERE NOT EXISTS guards, no unique key on this table.

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_wfm', 'WFM_ROSTER_LIVE_MONITORING', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_wfm' AND page_code='WFM_ROSTER_LIVE_MONITORING');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'process_manager', 'WFM_ROSTER_LIVE_MONITORING', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='process_manager' AND page_code='WFM_ROSTER_LIVE_MONITORING');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'operations_manager', 'WFM_ROSTER_LIVE_MONITORING', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='operations_manager' AND page_code='WFM_ROSTER_LIVE_MONITORING');
