-- Migration 269: Align HRMS2 lifecycle provisioning route access
-- Additive page catalog and role grants only. No production data changes.

INSERT INTO workforce_role_catalog (role_key, role_name, description, active_status) VALUES
('super_admin', 'Super Administrator', 'Unrestricted system administration access', 1),
('admin', 'System Administrator', 'System administrator access', 1),
('hr', 'HR Manager', 'HR lifecycle access', 1),
('wfm', 'WFM Analyst', 'Workforce management access', 1),
('it', 'IT Provisioning', 'IT provisioning access', 1),
('branch_admin', 'Branch Admin', 'Branch administration access', 1)
ON DUPLICATE KEY UPDATE
  role_name = VALUES(role_name),
  description = COALESCE(VALUES(description), description),
  active_status = 1;

INSERT INTO page_catalog (page_code, page_name, module, page_path, description, active_status) VALUES
('PROVISIONING_WFM_ALIGNMENT', 'WFM Alignment', 'Provisioning', '/provisioning/wfm-alignment', 'WFM process and roster alignment tasks', 1),
('PROVISIONING_IT', 'IT Provisioning', 'Provisioning', '/provisioning/it', 'IT email, domain, and asset provisioning tasks', 1),
('PROVISIONING_ADMIN', 'Admin Provisioning', 'Provisioning', '/provisioning/admin', 'Admin biometric and ID card provisioning tasks', 1),
('PROVISIONING_APPOINTMENT_LETTER', 'Appointment Letter', 'Provisioning', '/provisioning/appointment-letter', 'Appointment letter e-sign tracking', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name),
  module = VALUES(module),
  page_path = VALUES(page_path),
  description = VALUES(description),
  active_status = 1;

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
('wfm', 'PROVISIONING_WFM_ALIGNMENT', 1, 1, 1, 0, 1, 1),
('admin', 'PROVISIONING_WFM_ALIGNMENT', 1, 1, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_WFM_ALIGNMENT', 1, 1, 1, 1, 1, 1),

('it', 'PROVISIONING_IT', 1, 1, 1, 0, 1, 1),
('admin', 'PROVISIONING_IT', 1, 1, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_IT', 1, 1, 1, 1, 1, 1),

('branch_admin', 'PROVISIONING_ADMIN', 1, 1, 1, 0, 1, 1),
('hr', 'PROVISIONING_ADMIN', 1, 1, 1, 0, 1, 1),
('admin', 'PROVISIONING_ADMIN', 1, 1, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_ADMIN', 1, 1, 1, 1, 1, 1),

('hr', 'PROVISIONING_APPOINTMENT_LETTER', 1, 1, 1, 0, 1, 1),
('admin', 'PROVISIONING_APPOINTMENT_LETTER', 1, 1, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_APPOINTMENT_LETTER', 1, 1, 1, 1, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit = VALUES(can_edit),
  can_delete = VALUES(can_delete),
  can_export = VALUES(can_export),
  active_status = 1;
