-- 1532_finance_masters_page_access.sql
-- Registers the Finance Masters page (/finance/masters) in the page catalog and grants
-- role-based access.
--
-- WHO GETS WHAT:
--   super_admin, finance_head — full write (add/edit expense heads, sub-heads, approve vendors)
--   branch_admin              — view only (can see master data, cannot edit)
--
-- The page hosts: Expense Heads, Sub-Heads, Vendor→Head Mapping, Vendor Approvals (finance_head+).
-- Gate role gating follows the same principle as FINANCE_COST_CENTRES (1129):
-- granting a wider role here than the API allows would show a page whose every write 403s.

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES (
  'FINANCE_MASTERS',
  'Finance Masters',
  '/finance/masters',
  'finance',
  'Master data control for expense heads/sub-heads, vendor approval queue and vendor-to-head mapping.',
  1
)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',  'FINANCE_MASTERS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance_head', 'FINANCE_MASTERS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'branch_admin', 'FINANCE_MASTERS', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

SELECT '1532_finance_masters_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'FINANCE_MASTERS';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'FINANCE_MASTERS';
