-- Exit Clearance Task Board — dedicated per-role pages.
--
-- manager/hr/payroll/trainer own 5 of the 9 exit_clearance_task areas (manager handover;
-- hr exit-interview + compliance/NDA; payroll F&F readiness; trainer LMS closure) but had
-- no dedicated page to close their task — only a read-only drawer inside Exit Command
-- Center. admin and wfm already have provisioning-style pages (PROVISIONING_ADMIN,
-- PROVISIONING_WFM_ALIGNMENT from migration 268) that gain a new "Exit Clearance" section
-- instead of a new page — see NativeITProvisioningTracker.tsx.
--
-- All 4 role_keys used below (manager, hr, payroll, trainer) already exist in
-- workforce_role_catalog — nothing to insert there.

INSERT INTO page_catalog (page_code, page_name, module, page_path, description, active_status) VALUES
('PROVISIONING_MANAGER_HANDOVER', 'Manager Handover Clearance', 'Provisioning', '/provisioning/manager-handover', 'Exit clearance queue for manager handover tasks', 1),
('PROVISIONING_HR_EXIT',          'HR Exit Clearance',          'Provisioning', '/provisioning/hr-exit',          'Exit clearance queue for HR exit-interview and compliance/NDA tasks', 1),
('PROVISIONING_PAYROLL_EXIT',     'Payroll Exit Clearance',     'Provisioning', '/provisioning/payroll-exit',     'Exit clearance queue for payroll hold / F&F readiness tasks', 1),
('PROVISIONING_TRAINER_EXIT',     'Trainer Exit Clearance',     'Provisioning', '/provisioning/trainer-exit',     'Exit clearance queue for LMS/certification closure tasks', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name),
  module = VALUES(module),
  page_path = VALUES(page_path),
  description = VALUES(description),
  active_status = 1;

-- can_create = 0 everywhere: nobody manually creates clearance tasks from these queue
-- pages — generation stays admin/hr-only via the existing POST /:id/clearance/generate
-- endpoint (and the automatic LWD trigger). admin/hr/super_admin get full CRUD as the
-- existing overrides on PROVISIONING_ADMIN/PROVISIONING_WFM_ALIGNMENT already do.
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
('manager',     'PROVISIONING_MANAGER_HANDOVER', 1, 0, 1, 0, 1, 1),
('hr',          'PROVISIONING_MANAGER_HANDOVER', 1, 0, 1, 0, 1, 1),
('admin',       'PROVISIONING_MANAGER_HANDOVER', 1, 0, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_MANAGER_HANDOVER', 1, 0, 1, 1, 1, 1),

('hr',          'PROVISIONING_HR_EXIT', 1, 0, 1, 0, 1, 1),
('admin',       'PROVISIONING_HR_EXIT', 1, 0, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_HR_EXIT', 1, 0, 1, 1, 1, 1),

('payroll',     'PROVISIONING_PAYROLL_EXIT', 1, 0, 1, 0, 1, 1),
('hr',          'PROVISIONING_PAYROLL_EXIT', 1, 0, 1, 0, 1, 1),
('admin',       'PROVISIONING_PAYROLL_EXIT', 1, 0, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_PAYROLL_EXIT', 1, 0, 1, 1, 1, 1),

('trainer',     'PROVISIONING_TRAINER_EXIT', 1, 0, 1, 0, 1, 1),
('hr',          'PROVISIONING_TRAINER_EXIT', 1, 0, 1, 0, 1, 1),
('admin',       'PROVISIONING_TRAINER_EXIT', 1, 0, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_TRAINER_EXIT', 1, 0, 1, 1, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit = VALUES(can_edit),
  can_delete = VALUES(can_delete),
  can_export = VALUES(can_export),
  active_status = 1;
