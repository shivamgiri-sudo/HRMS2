-- Capacity Dashboard: let Finance Head, Finance, Branch Admin and Operations Manager open the page.
-- (They can also change a mandate through PATCH /api/workforce-mandate/:id, scoped by the API.)
-- Purely additive; INSERT IGNORE so replays and existing grants are untouched.
INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'finance_head',       'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'finance',            'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_admin',       'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'operations_manager', 'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1);
