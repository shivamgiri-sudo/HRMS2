-- Seed QUALITY_DASHBOARD page access for all relevant roles.
-- Required because WorkforcePageGate was blocking users whose role
-- existed but had no explicit row in role_page_access.
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES
  ('super_admin',       'QUALITY_DASHBOARD', 1, 0, 0, 0, 1),
  ('admin',             'QUALITY_DASHBOARD', 1, 0, 0, 0, 1),
  ('ceo',               'QUALITY_DASHBOARD', 1, 0, 0, 0, 1),
  ('coo',               'QUALITY_DASHBOARD', 1, 0, 0, 0, 1),
  ('qa',                'QUALITY_DASHBOARD', 1, 0, 0, 0, 0),
  ('quality_analyst',   'QUALITY_DASHBOARD', 1, 0, 0, 0, 0),
  ('manager',           'QUALITY_DASHBOARD', 1, 0, 0, 0, 0),
  ('process_manager',   'QUALITY_DASHBOARD', 1, 0, 0, 0, 0),
  ('branch_head',       'QUALITY_DASHBOARD', 1, 0, 0, 0, 0),
  ('operations_manager','QUALITY_DASHBOARD', 1, 0, 0, 0, 0),
  ('team_leader',       'QUALITY_DASHBOARD', 1, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE can_view = 1;
