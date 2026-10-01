-- Holiday Work (/payroll/holiday-work, PAYROLL_HOLIDAY_WORK): open to Branch WFM (raise requests) and
-- Payroll Branch (raise + approve). The API confines both to their own branch(es) (payroll-more.routes.ts).
-- Purely additive; INSERT IGNORE so replays and existing grants are untouched.
INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'branch_wfm',     'PAYROLL_HOLIDAY_WORK', 1, 1, 0, 0, 0, 1),
  (UUID(), 'payroll_branch', 'PAYROLL_HOLIDAY_WORK', 1, 1, 1, 0, 0, 1);
