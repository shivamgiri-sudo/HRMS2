-- 1303_client_billing_page_access.sql
--
-- Makes the Client Billing workspace (/finance/client-billing) reachable, and grants it.
--
-- WHY GRANTS ARE ISSUED HERE
-- ---------------------------
-- Same reasoning as 1066_billability_page_access.sql, whose header this migration follows
-- structurally: without a role_page_access row here, the page is invisible to everyone
-- except super_admin, because useWorkforceAccess bypasses the page set for super_admin
-- alone and every other role is resolved from role_page_access joined to page_catalog
-- (access.service.ts getAccessMe). FINANCE_COST_CENTRES is the cautionary example named in
-- both 1066 and 1129 — it shipped with a route and no catalog row and was invisible to
-- everyone but super_admin for weeks.
--
-- Role list matches backend/src/modules/client-billing/client-billing.routes.ts's live
-- ALLOWED_ROLES exactly, re-read at the time this file was written (2026-08-19):
--   const ALLOWED_ROLES = ["admin", "finance", "finance_head", "accounts_head"];
-- Deliberately NOT granted: super_admin is not in this list as an explicit row because
-- super_admin already receives every active page_catalog entry unconditionally (the
-- all-active rule noted above) — but it is included below anyway, matching 1066's own
-- practice of granting super_admin an explicit row for clarity/consistency with can_export
-- and future audit queries over role_page_access, and because super_admin is also accepted
-- by every backend endpoint here as a superset that always passes requireRole.
--
-- can_delete is 0 for every role: every row in client_invoice/client_credit_note is
-- effective-dated and workflow-gated (proforma -> approved/rejected, draft -> approved) —
-- the correct way to withdraw a document is to reject/supersede it, which preserves the
-- audit trail (client_invoice_audit_log), not delete the row. No client-billing route in
-- client-billing.routes.ts exposes a DELETE verb at all.
--
-- Idempotent: page_catalog.page_code is unique and role_page_access has a composite unique
-- key on (role_key, page_code), so re-running updates and inserts nothing twice.
--
-- ── Deployment ──────────────────────────────────────────────────────────────
-- Registering this file in runPendingMigrations.ts's MIGRATION_MANIFEST array (and
-- regenerating the lock file) applies it at the next pm2 restart — do that only with
-- explicit user sign-off, per CLAUDE.md's migration-approval rule. As of this commit it is
-- registered but has NOT been applied to production.

START TRANSACTION;

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('FINANCE_CLIENT_BILLING', 'Client Billing', '/finance/client-billing', 'finance',
   'Create, list, approve/reject and download client proforma invoices, invoices and credit notes through the client-billing replica.',
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
  (UUID(), 'super_admin',  'FINANCE_CLIENT_BILLING', 1, 1, 1, 0, 1, 1),
  (UUID(), 'admin',        'FINANCE_CLIENT_BILLING', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance',      'FINANCE_CLIENT_BILLING', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance_head', 'FINANCE_CLIENT_BILLING', 1, 1, 1, 0, 1, 1),
  (UUID(), 'accounts_head','FINANCE_CLIENT_BILLING', 1, 1, 1, 0, 1, 1)
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
--    WHERE page_code = 'FINANCE_CLIENT_BILLING';
--   UPDATE page_catalog SET active_status = 0
--    WHERE page_code = 'FINANCE_CLIENT_BILLING';
