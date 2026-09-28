-- 1785_leave_exit_cc_wfm_payroll_not_hr.sql
--
-- Owner directive (2026-09-16): in leave-approval and exit/"employee has left" emails, do
-- not copy generic branch HR — copy the branch's WFM (via the existing wfm_chain selector:
-- branch WFM SPOC, falling back to the wfm role, falling back to branch HR only as a last
-- resort) and Payroll HR of that branch instead.
--
-- Scope, confirmed with the owner: leave_pending_branch_head currently seats branch_hr as a
-- joint To approver alongside branch_head (not a Cc-for-visibility case like the other
-- three) — owner confirmed this should also drop HR, leaving branch_head as sole approver
-- in To, with wfm_chain + payroll_hr added to Cc alongside the existing reporting_manager.
--
-- Four events touched, all via recipient_spec (JSON), no code change:
--   resignation_submitted, resignation_revoked, exit_lwd_approaching:
--     cc: [branch_hr] -> cc: [wfm_chain, payroll_hr]
--   leave_pending_branch_head:
--     to: [branch_head, branch_hr] -> to: [branch_head]
--     cc: [reporting_manager] -> cc: [reporting_manager, wfm_chain, payroll_hr]
--
-- resignation_decision and full_final_ready are untouched: neither has branch_hr in its
-- recipient_spec today (resignation_decision cc's reporting_manager only; full_final_ready
-- is a fin-sensitivity event with zero cc by the resolver's own FIN_HAS_CC rule).

UPDATE notification_event_config
   SET recipient_spec = JSON_OBJECT(
         'to', JSON_ARRAY(JSON_OBJECT('kind', 'reporting_manager')),
         'cc', JSON_ARRAY(JSON_OBJECT('kind', 'wfm_chain'), JSON_OBJECT('kind', 'payroll_hr'))
       ),
       updated_at = NOW()
 WHERE event_code IN ('resignation_submitted', 'resignation_revoked', 'exit_lwd_approaching');

UPDATE notification_event_config
   SET recipient_spec = JSON_OBJECT(
         'to', JSON_ARRAY(JSON_OBJECT('kind', 'branch_head')),
         'cc', JSON_ARRAY(
                 JSON_OBJECT('kind', 'reporting_manager'),
                 JSON_OBJECT('kind', 'wfm_chain'),
                 JSON_OBJECT('kind', 'payroll_hr')
               )
       ),
       updated_at = NOW()
 WHERE event_code = 'leave_pending_branch_head';

-- Verification:
-- SELECT event_code, recipient_spec FROM notification_event_config
--  WHERE event_code IN ('resignation_submitted','resignation_revoked','exit_lwd_approaching','leave_pending_branch_head');
--   -- expect no 'branch_hr' kind anywhere in any of the four rows
