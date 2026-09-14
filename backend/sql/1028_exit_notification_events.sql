-- 1028_exit_notification_events.sql
--
-- Registers the exit/resignation events. These are the first phase-2 catalogue events to
-- be built; NOTIFICATION_CATALOGUE.md section 6.7 named them, this gives them recipient
-- specs and a kill switch.
--
-- Same discipline as 1022: every row lands enabled=0, dispatch_mode='shadow', with a
-- backfill floor armed. Nothing sends on apply.
--
-- WHY THIS MATTERS BEYOND ADDING EVENTS
-- exit.service.ts:12 owns one of the four private nodemailer transporters the audit
-- found, and its resignation mail has three defects the gateway fixes:
--   * it sends to employees.email — the PERSONAL address — for a workflow notification;
--   * it copies nobody, so HR never learns of a resignation by mail;
--   * `if (!emp?.mgr_email) return;` drops the notification silently when an employee has
--     no manager. 165 of 1,152 active employees are in exactly that state.
-- Routing through the gateway makes each of those a recorded, reportable drop instead.
--
-- Additive and idempotent (INSERT IGNORE on a unique event_code). NOT EXECUTED against
-- production (CLAUDE.md rule 4).
--
-- Depends on: 1022_notification_event_registry.sql

SET NAMES utf8mb4;

INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, description, sensitivity, is_critical, recipient_spec, cooldown_minutes) VALUES

-- To the manager who must action it; HR copied so a resignation is never invisible to them.
('resignation_submitted', 'exit', 'Resignation submitted',
 'Employee has submitted a resignation request awaiting manager review', 'conf', 1,
 '{"to":[{"kind":"reporting_manager"}],"cc":[{"kind":"branch_hr"}]}', 1440),

-- Back to the employee once a decision is made, with the manager copied.
('resignation_decision', 'exit', 'Resignation accepted or rejected',
 'Manager or HR has decided on a resignation request', 'conf', 1,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"reporting_manager"}]}', 1440),

-- Clearance owners: the departments holding an open checklist item.
('exit_clearance_pending', 'exit', 'Exit clearance pending',
 'Clearance items remain open as the last working day approaches', 'conf', 0,
 '{"to":[{"kind":"branch_hr"}],"cc":[{"kind":"reporting_manager"}]}', 2880),

-- Advance warning so access revocation and asset return are not same-day scrambles.
('exit_lwd_approaching', 'exit', 'Last working day approaching',
 'Confirmed last working day is near; access, assets and clearance need closing', 'conf', 0,
 '{"to":[{"kind":"reporting_manager"}],"cc":[{"kind":"branch_hr"}]}', 10080),

-- Revocation is the one that most needs to reach everyone who was told about the exit.
('resignation_revoked', 'exit', 'Resignation revoked',
 'Employee or manager withdrew a resignation before acceptance', 'conf', 1,
 '{"to":[{"kind":"reporting_manager"}],"cc":[{"kind":"branch_hr"}]}', 1440);

-- Arm the backfill floor so a first worker run cannot see historical exits.
UPDATE notification_event_config
   SET backfill_floor_at = NOW()
 WHERE module = 'exit' AND backfill_floor_at IS NULL;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT event_code, sensitivity, enabled, dispatch_mode, backfill_floor_at IS NOT NULL AS floored
--   FROM notification_event_config WHERE module='exit' ORDER BY event_code;
--   -- expect 5 rows, enabled=0, dispatch_mode='shadow', floored=1
--
-- No exit event is 'fin', so none carries the official-email-only restriction. That is
-- deliberate: a resignation notice is confidential workflow, not financial data. The one
-- financial exit event, full_final_ready, is already registered by 1022 under the payroll
-- module and IS 'fin' — and is the single documented event allowed to reach a personal
-- address, because by then the official mailbox is disabled.
-- SELECT event_code, sensitivity FROM notification_event_config WHERE event_code='full_final_ready';
