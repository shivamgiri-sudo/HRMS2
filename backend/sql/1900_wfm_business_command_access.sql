-- Migration 1900: let WFM set Required HC (mandate seats) from the existing Business Command Center.
-- View only on the page; POST /api/business-command/workforce-mandates restricts a WFM-only caller
-- to processes in their assigned branch. Replay-safe: uq_role_page + ON DUPLICATE KEY UPDATE.

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  ('wfm',        'BUSINESS_COMMAND_CENTER', 1, 0, 0, 0, 0, 1),
  ('branch_wfm', 'BUSINESS_COMMAND_CENTER', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE can_view = 1, active_status = 1;
