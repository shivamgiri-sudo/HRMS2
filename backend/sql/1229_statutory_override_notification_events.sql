-- 1229_statutory_override_notification_events.sql
--
-- Registers three notification events for the PF/ESIC voluntary opt-out workflow:
--
--   statutory_opt_out_submitted  — employee submits a request → Payroll HR + Payroll Head notified
--   statutory_opt_out_decided    — Payroll HO approves or rejects → employee notified
--   statutory_opt_out_revoked    — approved opt-out is revoked → employee notified
--
-- All land enabled=0, dispatch_mode='shadow'. Nothing sends on apply.
-- Idempotent via INSERT IGNORE on the unique event_code.
-- Backfill floor armed immediately — no historical opt-out events will be replayed.
--
-- sensitivity='conf': statutory opt-out decisions are confidential workflow, not financial data.
-- is_critical=1: missed notification of an opt-out decision directly affects deduction trust.
--
-- Depends on: 1022_notification_event_registry.sql
--
-- NOT EXECUTED against production (CLAUDE.md rule 4).

SET NAMES utf8mb4;

INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, description, sensitivity, is_critical, recipient_spec, cooldown_minutes) VALUES

-- Employee submits a PF or ESIC opt-out request — Payroll HR and Head must action it.
('statutory_opt_out_submitted', 'payroll', 'Statutory opt-out request submitted',
 'Employee has submitted a voluntary PF or ESIC opt-out request pending Payroll HO review',
 'conf', 1,
 '{"to":[{"kind":"role_scope","roleKeys":["payroll_hr"]}],"cc":[{"kind":"role_scope","roleKeys":["payroll_head"]}]}',
 60),

-- Payroll HO approves or rejects — employee must know their deduction status has changed.
('statutory_opt_out_decided', 'payroll', 'Statutory opt-out decision',
 'Payroll HO has approved or rejected a voluntary PF or ESIC opt-out request',
 'conf', 1,
 '{"to":[{"kind":"employee","emailPolicy":"official_only"}]}',
 60),

-- Approved opt-out is revoked — employee must know deductions will resume.
('statutory_opt_out_revoked', 'payroll', 'Statutory opt-out revoked',
 'An approved PF or ESIC opt-out has been revoked; deductions will resume from the next payroll run',
 'conf', 1,
 '{"to":[{"kind":"employee","emailPolicy":"official_only"}]}',
 60);

-- Arm the backfill floor so a first worker run cannot replay historical opt-out requests.
UPDATE notification_event_config
   SET backfill_floor_at = NOW()
 WHERE event_code IN ('statutory_opt_out_submitted', 'statutory_opt_out_decided', 'statutory_opt_out_revoked')
   AND backfill_floor_at IS NULL;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT event_code, sensitivity, is_critical, enabled, dispatch_mode, backfill_floor_at IS NOT NULL AS floored
--   FROM notification_event_config
--  WHERE event_code IN ('statutory_opt_out_submitted','statutory_opt_out_decided','statutory_opt_out_revoked')
--  ORDER BY event_code;
-- expect 3 rows, enabled=0, dispatch_mode='shadow', floored=1
