-- Migration 1645: Grant bgv-status report visibility to HR-variant roles
-- (branch_hr, hr_admin, ho_hr, process_hr, recruitment_hr).
--
-- Previously only the plain 'hr' role could open /reports?code=bgv-status.
-- All five variant roles are branch/process scoped in the service layer, so
-- granting can_view=1 here does not widen data access — the API already
-- enforces row scope per the actor's branch_id.

INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by)
VALUES
  ('branch_hr',     'bgv-status', 1, 1, 1),
  ('hr_admin',      'bgv-status', 1, 1, 1),
  ('ho_hr',         'bgv-status', 1, 1, 1),
  ('process_hr',    'bgv-status', 1, 0, 1),
  ('recruitment_hr','bgv-status', 1, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view   = VALUES(can_view),
  can_export = VALUES(can_export);
