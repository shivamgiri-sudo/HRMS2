-- Migration 1781: Corrective fix — re-revoke admin/hr from WFM_ROSTER_LIVE_MONITORING.
--
-- Self-inflicted regression, 2026-09-16: migration 1757_roster_command_center_console_page_codes.sql
-- was registered in runPendingMigrations.ts (this session) slightly before its own SQL file
-- was edited to drop a stale Live Monitoring role_page_access block (which still granted
-- super_admin/admin/hr/wfm, exactly what migration 1766 had already revoked admin/hr from on
-- 2026-09-14). A backend in this shared, always-restarting dev environment picked up the
-- registration and ran the not-yet-fixed file in that window, re-inserting admin ('hr' too)
-- with active_status=1 at 2026-09-16T07:53:58Z — confirmed via role_page_access.created_at
-- exactly matching 1757's schema_migrations.applied_at timestamp. 1757 is now tracked as
-- applied and will not re-run with its (already-corrected on disk) content, so the live rows
-- need their own direct fix here.
--
-- Restores the 2026-09-14 owner ruling (1766) + 2026-09-16 additions (1779): branch_head,
-- wfm, branch_wfm, process_manager, operations_manager only. super_admin's row is left
-- alone — harmless (auto-granted every active page regardless of this table).

USE mas_hrms;

UPDATE role_page_access
   SET active_status = 0
 WHERE page_code = 'WFM_ROSTER_LIVE_MONITORING'
   AND role_key IN ('admin', 'hr')
   AND active_status = 1;

-- Verification (expect branch_head, branch_wfm, operations_manager, process_manager,
-- super_admin, wfm):
-- SELECT role_key FROM role_page_access
--  WHERE page_code = 'WFM_ROSTER_LIVE_MONITORING' AND active_status = 1 ORDER BY role_key;
