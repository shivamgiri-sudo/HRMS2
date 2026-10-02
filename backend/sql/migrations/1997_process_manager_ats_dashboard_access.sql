-- ATS Command Center: let process managers open the page (view only).
--
-- branch_head already holds ATS_DASHBOARD; process_manager did not, so a process manager could not reach
-- /ats/command-center at all. They now get the scoped version of the page, whose every number comes from the
-- row-scoped candidate endpoints (own branch and assigned processes only), so this widens what they can OPEN,
-- not what data they can see.
--
-- Purely additive; INSERT IGNORE so replays and any existing grant are untouched. To undo, set active_status = 0
-- on this role_page_access row.
INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'process_manager', 'ATS_DASHBOARD', 1, 0, 0, 0, 0, 1);
