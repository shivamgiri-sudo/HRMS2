-- Page access grant for Client Payment Management
-- Matches PAYMENT_READ_ROLES in client-payment-tracking.routes.ts

INSERT INTO workforce_role_page_access (role, page_code, can_view, can_edit)
SELECT r.role, 'FINANCE_CLIENT_PAYMENTS', 1, w.can_edit
FROM (SELECT 'super_admin' AS role UNION ALL
      SELECT 'admin' UNION ALL
      SELECT 'finance' UNION ALL
      SELECT 'finance_head' UNION ALL
      SELECT 'accounts_head' UNION ALL
      SELECT 'ceo' UNION ALL
      SELECT 'coo') r
CROSS JOIN (SELECT 1 AS can_edit) w
ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_edit = VALUES(can_edit);
