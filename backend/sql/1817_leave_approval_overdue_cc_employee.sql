-- 1817_leave_approval_overdue_cc_employee.sql
--
-- The leave_approval_overdue notification was originally configured with
-- cc: branch_hr (copied from leave_submitted's shape). Owner directive 2026-09-18:
-- reminders should go To the reporting manager and Cc the employee only — branch HR
-- should not receive every pending-approval reminder for their branch.
--
-- Additive UPDATE only. Idempotent: running twice leaves the row in the correct state.

UPDATE notification_event_config
   SET recipient_spec = '{"to":[{"kind":"reporting_manager"}],"cc":[{"kind":"employee"}]}'
 WHERE event_code = 'leave_approval_overdue';

-- Verification:
-- SELECT event_code, recipient_spec FROM notification_event_config WHERE event_code = 'leave_approval_overdue';
--   expect: {"to":[{"kind":"reporting_manager"}],"cc":[{"kind":"employee"}]}
