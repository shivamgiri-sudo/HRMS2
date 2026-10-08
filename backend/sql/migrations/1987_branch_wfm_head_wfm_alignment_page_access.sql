-- WFM Alignment queue (/provisioning/wfm-alignment): open to Branch WFM and Branch Head.
-- The API confines them to their own branch(es) (it-provisioning.routes.ts, assertTaskInScope).
-- Purely additive; INSERT IGNORE so replays and existing grants are untouched.
INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'branch_wfm',  'PROVISIONING_WFM_ALIGNMENT', 1, 0, 1, 0, 0, 1),
  (UUID(), 'branch_head', 'PROVISIONING_WFM_ALIGNMENT', 1, 0, 1, 0, 0, 1);
