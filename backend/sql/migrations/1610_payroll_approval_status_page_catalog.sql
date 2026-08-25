-- Migration 1610: Register PAYROLL_APPROVAL_STATUS_VIEW in page_catalog and seed
-- role_page_access grants (can_view only) for the roles who need it: branch_head and
-- payroll_hr (the actual ask — they had no way to see which onboarded employees are still
-- unapproved by Payroll Head, or what was assigned once approved), plus payroll_head/admin/
-- super_admin who already have full access via the main Salary Review Queue.
--
-- Purely additive; WHERE NOT EXISTS makes it idempotent. Column names match 1607's
-- verified-against-live-schema pattern (page_code/page_name, not page_key/page_label).

INSERT INTO page_catalog (page_code, page_name, module, description, created_at)
SELECT
  'PAYROLL_APPROVAL_STATUS_VIEW',
  'Salary Approval Status',
  'payroll',
  'Read-only view of which onboarded employees are pending/approved/rejected by Payroll Head, and what package/date was assigned once approved',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM page_catalog WHERE page_code = 'PAYROLL_APPROVAL_STATUS_VIEW'
);

INSERT INTO role_page_access (role_key, page_code, can_view, can_edit, can_delete, can_export, created_at)
SELECT r.role_key, 'PAYROLL_APPROVAL_STATUS_VIEW', 1, 0, 0, 0, NOW()
FROM (
  SELECT 'branch_head'  AS role_key UNION ALL
  SELECT 'payroll_hr'               UNION ALL
  SELECT 'payroll_head'             UNION ALL
  SELECT 'admin'                    UNION ALL
  SELECT 'super_admin'
) r
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access
   WHERE role_key = r.role_key
     AND page_code = 'PAYROLL_APPROVAL_STATUS_VIEW'
);
