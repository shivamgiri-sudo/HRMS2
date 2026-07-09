-- Migration: Grant employee role access to My Resignation and DPDP Withdrawal
-- Purpose: Enable employee self-service for resignation requests and DPDP consent withdrawal
-- Date: 2026-07-09

-- Grant employee role access to My Resignation page
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES (UUID(), 'employee', 'RESIGNATION_MY_REQUEST', 1, 1, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view = 1,
  can_create = 1,
  active_status = 1;

-- Grant employee role access to DPDP Withdrawal page
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES (UUID(), 'employee', 'DPDP_WITHDRAWAL', 1, 1, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view = 1,
  can_create = 1,
  active_status = 1;

-- Verification queries (comment out in production)
-- SELECT role_key, page_code, can_view, can_create, active_status
-- FROM role_page_access
-- WHERE page_code IN ('RESIGNATION_MY_REQUEST', 'DPDP_WITHDRAWAL')
-- AND role_key = 'employee';
