-- Branch WFM: open RM Change Approvals (/wfm-manager-approvals, page code WFM_ROSTER).
-- Rows are branch-scoped by the API (rm-change.routes.ts); branch_head already holds WFM_ROSTER.
-- Purely additive; INSERT IGNORE so replays and existing grants are untouched.
INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'branch_wfm', 'WFM_ROSTER', 1, 0, 1, 0, 0, 1);
