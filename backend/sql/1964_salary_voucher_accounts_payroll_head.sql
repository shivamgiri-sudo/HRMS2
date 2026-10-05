-- Give accounts_head and payroll_head the Salary Voucher page (same read + export as finance_head).
-- Additive and idempotent.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'accounts_head', 'FINANCE_SALARY_VOUCHER', 1, 0, 0, 0, 1, 1),
  (UUID(), 'payroll_head',  'FINANCE_SALARY_VOUCHER', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view), can_export = VALUES(can_export), active_status = VALUES(active_status);

SELECT '1964_salary_voucher_accounts_payroll_head.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0
--    WHERE page_code = 'FINANCE_SALARY_VOUCHER' AND role_key IN ('accounts_head','payroll_head');
