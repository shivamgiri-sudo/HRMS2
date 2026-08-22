-- 1548_unlinked_grn_review_page_access.sql
-- Registers the Unlinked GRN Review page (/finance/unlinked-grn-review) in the page catalog
-- and grants role-based access.
--
-- Built 2026-08-22 after a full-FY remediation found ~1,505 approved vendor/imprest GRNs that
-- had never been linked to a budget line (see hrms2-grn-cost-allocation-budget-blind-spot
-- memory). Most were fixed by hand; this page is the permanent, always-checkable answer to
-- "how would I know if this happens again" — a live view of every GRN still missing a link,
-- classified by why, instead of someone having to ask for a one-off database query.
--
-- Same narrow role set as FINANCE_ANNUAL_BUDGET_SUMMARY (migration 1537) — an all-branches
-- financial-exposure view, view/export only, no write capability on this page at all.

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES (
  'FINANCE_UNLINKED_GRN_REVIEW',
  'Unlinked GRN Review',
  '/finance/unlinked-grn-review',
  'finance',
  'Every approved GRN not yet linked to a budget line, classified by why, so the gap that caused the FY2026-27 remediation cannot recur unnoticed.',
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
  (UUID(), 'super_admin',    'FINANCE_UNLINKED_GRN_REVIEW', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',          'FINANCE_UNLINKED_GRN_REVIEW', 1, 0, 0, 0, 1, 1),
  (UUID(), 'finance_head',   'FINANCE_UNLINKED_GRN_REVIEW', 1, 0, 0, 0, 1, 1),
  (UUID(), 'accounts_head',  'FINANCE_UNLINKED_GRN_REVIEW', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

SELECT '1548_unlinked_grn_review_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'FINANCE_UNLINKED_GRN_REVIEW';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'FINANCE_UNLINKED_GRN_REVIEW';
