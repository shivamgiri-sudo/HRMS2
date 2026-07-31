-- 1031_leave_submitted_approver_chain.sql
--
-- Stops leave submissions from notifying nobody.
--
-- THE PROBLEM (measured against production 2026-08-01 via scripts/shadow-expectation.ts)
-- leave_submitted resolves `to: [{kind:'reporting_manager'}]`. Of 1,152 active employees,
-- only 917 have a reachable one:
--     165  no reporting_manager_id (and no manager_id) at all
--      62  point at a manager row that is missing or inactive
--       8  manager exists and is active but has no email on record
--     ---
--     235  (20.4%) resolve to NOBODY
--
-- By branch the distribution is very uneven, which is why an average hides it:
--     Delhi Office            0/51    0%   <- not one employee has a reachable approver
--     HEAD OFFICE            13/25   52%
--     NOIDA                 310/406  76%
--     NOIDA-2               322/362  89%
--     AHMEDABAD-JALDARSHAN  247/271  91%
--
-- For those 235 the resolver throws EMPTY_TO, the gateway records a suppressed claim, and
-- the leave request sits unseen. The failure IS recorded — it is not silent to an operator
-- reading notification_dispatch_claim — but it is silent to the employee waiting for a
-- decision, which is the part that matters.
--
-- THE FIX
-- Switch the selector to `approver_chain`: reporting_manager -> branch_head -> branch HR,
-- stopping at the first that yields. This mirrors the existing `wfm_chain` selector, which
-- exists for exactly the same reason (branch_wfm_spoc_config is empty in production).
--
-- Escalating to the branch is strictly better than telling no one, and it degrades to HR
-- rather than to silence. It does NOT excuse the data problem: the right end state is every
-- employee having a real reporting manager, and the notification-undeliverable-recipients
-- report remains the worklist for that. This makes the system behave sanely until then.
--
-- SENSITIVITY: leave_submitted is 'int'. Widening the audience to a branch head or branch HR
-- exposes nothing they are not already entitled to see — both already approve leave. No
-- financial or PII content is carried. A 'fin' event would NOT be given a chain like this.
--
-- ADDITIVE and reversible. Rollback is the commented UPDATE at the foot of this file.

SET NAMES utf8mb4;

UPDATE notification_event_config
   SET recipient_spec = JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'approver_chain')))
 WHERE event_code = 'leave_submitted';

-- leave_pending_branch_head deliberately keeps its explicit branch_head selector: that event
-- exists precisely BECAUSE the branch head is the intended approver, so a chain that could
-- fall back to the reporting manager would defeat it.

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT event_code, recipient_spec FROM notification_event_config
--  WHERE event_code = 'leave_submitted';
--   expect: {"to": [{"kind": "approver_chain"}]}
--
-- Then re-run the harness and compare against the pre-change numbers above:
--   npx tsx scripts/shadow-expectation.ts
--   expect leave_submitted deliverability to rise from ~52% of the sample toward ~100%,
--   with the residue being employees whose branch has neither a head nor scoped HR.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- UPDATE notification_event_config
--    SET recipient_spec = JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'reporting_manager')))
--  WHERE event_code = 'leave_submitted';
