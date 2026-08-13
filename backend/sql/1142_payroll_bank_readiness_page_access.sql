-- 1142_payroll_bank_readiness_page_access.sql
--
-- Seeds the page_catalog row and role_page_access grants for PAYROLL_BANK_READINESS, the Bank
-- Payment Readiness page at /payroll/bank-readiness.
--
-- WHY THIS SHIPS IN THE SAME CHANGE AS THE PAGE
--   WorkforcePageGate resolves access from role_page_access. A route + component with no catalog
--   row is invisible to everyone except super_admin, who is elevated to all active page codes
--   unconditionally — so the page would look finished to whoever built it and be missing for
--   every actual user. FINANCE_COST_CENTRES sat in exactly that state long enough for two
--   separate migrations (1066, 1104) to cite it as the cautionary example without fixing it, and
--   1129 finally had to. Shipping the grant with the page is that lesson applied, not optional
--   polish.
--
-- GRANTS MIRROR THE ROUTER, NOT A WIDER WISH LIST
--   can_view matches READ_ROLES in bank-payment-readiness.routes.ts exactly. Granting a role the
--   page while the API refuses its calls is the defect the 2026-08 audit found on six screens, so
--   the two lists are kept identical by construction.
--
--   can_edit matches MANAGE_ROLES — the roles allowed to PATCH an exception's owner or status.
--   branch_head, branch_admin, payroll_branch and finance get view only: they must see and act on
--   their branch's exceptions, but reassigning ownership is a head-office decision.
--
--   can_export matches PAYROLL_EXPORT_ROLES (+ super_admin/admin), the same list the existing
--   NEFT/bank-file endpoints gate on. ⚠️ The flag alone does NOT release account numbers:
--   GET /payment-file additionally requires hasOrgWideScope(), an explicit
--   user_assignment_scope row with scope_type = 'all'. A role_page_access grant cannot bypass
--   that, and this migration must never be read as the thing that authorises the payment file.
--
--   can_create is 0 for everyone — nothing on this page creates a record; the exception rows are
--   an overlay written by PATCH. can_delete is 0 for everyone: an exception is resolved or
--   waived, never erased, because the reason someone could not be paid is audit history.
--
-- Additive and idempotent: two INSERT ... ON DUPLICATE KEY UPDATE statements against reference
-- data. No schema change, no existing grant on any other page touched.

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('PAYROLL_BANK_READINESS', 'Bank Payment Readiness', '/payroll/bank-readiness', 'payroll',
   'Classifies every active payable employee as READY / MISSING / INVALID / CONFLICT / PENDING_APPROVAL / BLOCKED, verifies accounts against confirmed salary credits in db_bill, and owns the exception queue that must reach zero before a salary payment file is generated.',
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
  -- MANAGE_ROLES + export: may reassign exceptions and pull the payment file.
  (UUID(), 'super_admin',    'PAYROLL_BANK_READINESS', 1, 0, 1, 0, 1, 1),
  (UUID(), 'admin',          'PAYROLL_BANK_READINESS', 1, 0, 1, 0, 1, 1),
  (UUID(), 'payroll_head',   'PAYROLL_BANK_READINESS', 1, 0, 1, 0, 1, 1),
  (UUID(), 'payroll',        'PAYROLL_BANK_READINESS', 1, 0, 1, 0, 1, 1),
  (UUID(), 'payroll_admin',  'PAYROLL_BANK_READINESS', 1, 0, 1, 0, 1, 1),
  (UUID(), 'finance_head',   'PAYROLL_BANK_READINESS', 1, 0, 1, 0, 1, 1),
  -- MANAGE_ROLES without export: HR clears exceptions but does not pull payment files.
  (UUID(), 'hr',             'PAYROLL_BANK_READINESS', 1, 0, 1, 0, 0, 1),
  -- Export without manage: finance pulls the file, head office owns the queue.
  (UUID(), 'finance',        'PAYROLL_BANK_READINESS', 1, 0, 0, 0, 1, 1),
  -- READ_ROLES only: see and work their own branch's exceptions.
  (UUID(), 'payroll_branch', 'PAYROLL_BANK_READINESS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_head',    'PAYROLL_BANK_READINESS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_admin',   'PAYROLL_BANK_READINESS', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

SELECT '1142_payroll_bank_readiness_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'PAYROLL_BANK_READINESS';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'PAYROLL_BANK_READINESS';
