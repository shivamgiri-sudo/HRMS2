-- Make the Billability & Seat Cost screen reachable, and grant it.
--
-- WHY GRANTS ARE ISSUED HERE, WHEN 604 DELIBERATELY DID NOT
-- ---------------------------------------------------------
-- 604 declined to issue grants for a self-service page, on the grounds that the role
-- matrix is the single source of truth for who sees what. That reasoning holds for
-- pages whose audience is already covered by an existing grant pattern.
--
-- This is the opposite case: the audience was named explicitly as a business
-- instruction -- super admin, finance, payroll head and payroll branch -- and without
-- a grant only super_admin would ever see the page, because useWorkforceAccess bypasses
-- the page set for super_admin alone and every other role is resolved from
-- role_page_access joined to page_catalog (access.service.ts getAccessMe).
--
-- FINANCE_COST_CENTRES is the cautionary example: it has a route, a page and a
-- pageCode, and zero rows in role_page_access -- so it is invisible to everyone except
-- super_admin, and has been silently so.
--
-- Deliberately NOT granted: admin, finance_head, accounts_head, ceo, coo. Sibling
-- finance pages grant some of those, but widening a permission boundary that was
-- specified precisely is not a decision to make silently. Adding them later is one row
-- each.
--
-- can_delete is reserved to super_admin. Every row in these tables is effective-dated
-- and approval-gated: the correct way to withdraw a rule is to end-date or inactivate
-- it, which preserves why a locked period computed what it did. Deleting the row
-- destroys that history.
--
-- Idempotent: page_catalog.page_code is unique and role_page_access has a composite
-- unique key on (role_key, page_code), so re-running updates and inserts nothing twice.

START TRANSACTION;

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('FINANCE_BILLABILITY_SEAT_COST', 'Billability & Seat Cost', '/finance/billability', 'finance',
   'Which roles the client pays for on each process, the seat rate received per billable employee, and how non-billable support staff cost is split across the cost centres they serve.',
   1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',    'FINANCE_BILLABILITY_SEAT_COST', 1, 1, 1, 1, 1, 1),
  (UUID(), 'finance',        'FINANCE_BILLABILITY_SEAT_COST', 1, 1, 1, 0, 1, 1),
  (UUID(), 'payroll_head',   'FINANCE_BILLABILITY_SEAT_COST', 1, 1, 1, 0, 1, 1),
  (UUID(), 'payroll_branch', 'FINANCE_BILLABILITY_SEAT_COST', 1, 1, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

COMMIT;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0
--    WHERE page_code = 'FINANCE_BILLABILITY_SEAT_COST';
--   UPDATE page_catalog SET active_status = 0
--    WHERE page_code = 'FINANCE_BILLABILITY_SEAT_COST';
