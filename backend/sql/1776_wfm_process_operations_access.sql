-- Migration 1776: grant wfm and branch_wfm view access to Process Operations.
--
-- The Onfido process dashboard now lives only inside Process Operations
-- (/onfido-process/dashboard redirects there). wfm held ONFIDO_PROCESS_DASHBOARD
-- (migration 1675) but not PROCESS_OPERATIONS (1693), so moving the dashboard
-- would have taken Onfido away from WFM. Owner ruling 2026-09-15: WFM users see
-- Process Operations, including Onfido, branch-scoped.
--
-- Same rights as every other PROCESS_OPERATIONS grant: view + export, nothing
-- else (the page defines nothing). Rows are still filtered per viewer by
-- readableProcessIds: a WFM user sees only processes in their own
-- user_assignment_scope (all / branch / process); with no assignment, nothing.
-- Replay-safe: uq_role_page (role_key, page_code) + ON DUPLICATE KEY UPDATE.

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  ('wfm',        'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1),
  ('branch_wfm', 'PROCESS_OPERATIONS', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = 1, can_export = 1, active_status = 1;
