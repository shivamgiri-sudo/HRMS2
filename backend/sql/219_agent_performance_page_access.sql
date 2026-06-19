-- 219_agent_performance_page_access.sql
-- Add AGENT_PERFORMANCE page to page_catalog and grant access to appropriate roles

USE mas_hrms;

INSERT INTO page_catalog (page_code, page_name, module, page_path, description) VALUES
('AGENT_PERFORMANCE', 'Agent Performance', 'Operations', '/agent-performance', 'Agent performance metrics and analytics')
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name),
  module = VALUES(module),
  page_path = VALUES(page_path),
  description = VALUES(description);

-- Grant access to roles matching performance-dashboard ALLOWED_ROLES
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
('admin',           'AGENT_PERFORMANCE', 1,1,1,1,1),
('hr',              'AGENT_PERFORMANCE', 1,1,1,1,1),
('ceo',             'AGENT_PERFORMANCE', 1,1,1,1,1),
('qa',              'AGENT_PERFORMANCE', 1,1,1,1,1),
('analyst',         'AGENT_PERFORMANCE', 1,1,1,1,1),
('manager',         'AGENT_PERFORMANCE', 1,1,1,1,1),
('process_manager', 'AGENT_PERFORMANCE', 1,1,1,1,1),
('branch_head',     'AGENT_PERFORMANCE', 1,1,1,1,1),
('super_admin',     'AGENT_PERFORMANCE', 1,1,1,1,1)
ON DUPLICATE KEY UPDATE can_view=1, can_create=1, can_edit=1, can_delete=1, can_export=1;
