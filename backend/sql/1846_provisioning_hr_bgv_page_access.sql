-- Migration 1846: seed the page catalog row and role grants for PROVISIONING_HR_BGV.
-- The HR BGV-initiation screen (/provisioning/hr-bgv) shipped referencing this page code in
-- routes, nav and rbacPageMatrix (roles hr, branch_hr) with no catalog row or grants, which
-- also fails page-access-deployment.contract.test.ts and blocks the deploy gate.
-- Additive and idempotent. ROLLBACK: UPDATE role_page_access SET active_status = 0 WHERE page_code = 'PROVISIONING_HR_BGV';

INSERT INTO page_catalog (page_code, page_name, module, page_path, description, active_status) VALUES
('PROVISIONING_HR_BGV', 'HR BGV Initiation', 'Provisioning', '/provisioning/hr-bgv', 'HR queue to initiate background verification and record the red/green result', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name),
  module = VALUES(module),
  page_path = VALUES(page_path),
  description = VALUES(description),
  active_status = 1;

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
('hr',          'PROVISIONING_HR_BGV', 1, 0, 1, 0, 1, 1),
('branch_hr',   'PROVISIONING_HR_BGV', 1, 0, 1, 0, 1, 1),
('admin',       'PROVISIONING_HR_BGV', 1, 0, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_HR_BGV', 1, 0, 1, 1, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit = VALUES(can_edit),
  can_delete = VALUES(can_delete),
  can_export = VALUES(can_export),
  active_status = 1;
