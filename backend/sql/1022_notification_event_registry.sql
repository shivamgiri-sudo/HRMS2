-- 1022_notification_event_registry.sql
--
-- Phase 0 of the notification build: makes docs/peopleos-build/NOTIFICATION_CATALOGUE.md
-- machine-readable. Creates the event registry and seeds the 48 phase-1 events.
--
-- THIS MIGRATION SENDS NOTHING. Every row lands enabled=0, dispatch_mode='shadow'.
-- Nothing goes live as a side effect of applying it; going live is a deliberate UPDATE
-- per event, which is also the rollback (see the bottom of this file).
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS + INSERT IGNORE. Re-running changes
-- nothing and cannot overwrite an operator's enable/disable decisions.
--
-- NOT EXECUTED against production. Apply to isolated local/staging MySQL only
-- (CLAUDE.md rule 4 — live SQL execution is a hard gate).
--
-- Naming note: `sensitivity` drives two independent guards downstream —
--   'fin'  => recipient forced to employees.official_email + domain allowlist, CC must be empty
--   'conf' => internal audience only, never a client recipient
-- so it is not cosmetic metadata.

-- ---------------------------------------------------------------------------
-- 1. The registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_event_config (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()),
  event_code        VARCHAR(80)   NOT NULL,
  module            VARCHAR(40)   NOT NULL,
  display_name      VARCHAR(160)  NOT NULL,
  description       VARCHAR(500)  NULL,

  -- Kill switch. enabled=0 means the gateway short-circuits before resolving recipients.
  enabled           TINYINT(1)    NOT NULL DEFAULT 0,
  -- 'shadow' resolves recipients, runs the deny-list and writes a claim, but never calls
  -- the provider. 'live' sends. 'off' is equivalent to enabled=0 but records intent.
  dispatch_mode     ENUM('shadow','live','off') NOT NULL DEFAULT 'shadow',

  channels          VARCHAR(80)   NOT NULL DEFAULT 'email',
  is_critical       TINYINT(1)    NOT NULL DEFAULT 0,
  sensitivity       ENUM('int','conf','fin') NOT NULL DEFAULT 'int',

  -- Recipient specification, resolved at send time by resolveRecipients().
  -- Shape: {"to":[{...selector}], "cc":[...], "bcc":[...]}
  recipient_spec    JSON          NOT NULL,

  -- Storm control. See NOTIFICATION_CATALOGUE.md and the plan's storm-safeguard section.
  -- backfill_floor_at is the primary guard: every worker query carries
  --   AND <time_col> >= backfill_floor_at
  -- so historical backlog is structurally invisible rather than throttled. Set to NOW()
  -- at apply time below. Moving it backwards is how an operator deliberately, reversibly
  -- processes history — one step at a time, watching the claim count.
  backfill_floor_at DATETIME      NULL,
  max_per_run       INT UNSIGNED  NOT NULL DEFAULT 50,
  max_per_day       INT UNSIGNED  NOT NULL DEFAULT 500,
  -- Suppress a repeat to the same recipient for the same entity within this window.
  cooldown_minutes  INT UNSIGNED  NOT NULL DEFAULT 1440,

  template_key      VARCHAR(120)  NULL,
  active_status     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_nec_event (event_code),
  KEY idx_nec_enabled (enabled, dispatch_mode),
  KEY idx_nec_module (module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. Seeds — 48 phase-1 events, all shadow/disabled
--    recipient_spec selectors are resolved by backend/src/shared/recipient-resolver.ts.
--    'wfm_chain' is the ordered fallback wfm_spoc -> role_scope(wfm,branch) -> branch_hr,
--    required because branch_wfm_spoc_config currently has ZERO rows.
-- ---------------------------------------------------------------------------

-- 2.1 Roster / WFM ----------------------------------------------------------
INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, sensitivity, is_critical, recipient_spec, template_key) VALUES
('roster_published',            'wfm','Roster published','int',1,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"wfm_chain"}]}','ROSTER_PUBLISHED'),
('roster_ack_reminder',         'wfm','Roster acknowledgement reminder','int',0,
 '{"to":[{"kind":"employee"}]}','ROSTER_ACK_REMINDER'),
('roster_ack_overdue',          'wfm','Roster acknowledgement overdue','int',0,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"reporting_manager"}]}','ROSTER_ACK_REMINDER'),
('shift_changed',               'wfm','Shift changed after publication','int',1,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"reporting_manager"}]}','SHIFT_CHANGED'),
('weekoff_approved',            'wfm','Week-off request approved','int',0,
 '{"to":[{"kind":"employee"}]}','WEEKOFF_APPROVED'),
('weekoff_denied',              'wfm','Week-off request denied','int',0,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"reporting_manager"}]}','WEEKOFF_DENIED'),
('weekoff_waitlisted',          'wfm','Week-off request waitlisted','int',0,
 '{"to":[{"kind":"employee"}]}','WEEKOFF_WAITLISTED'),
('roster_dispute_raised',       'wfm','Roster dispute raised','int',0,
 '{"to":[{"kind":"wfm_chain"}],"cc":[{"kind":"reporting_manager"}]}','ROSTER_DISPUTE_RAISED'),
('roster_dispute_resolved',     'wfm','Roster dispute resolved','int',0,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"wfm_chain"}]}','ROSTER_DISPUTE_RESOLVED'),
('roster_cycle_unacked_digest', 'wfm','Unacknowledged roster digest','int',0,
 '{"to":[{"kind":"wfm_chain"}],"cc":[{"kind":"branch_head"},{"kind":"branch_hr"}]}',NULL);

-- 2.2 Leave -----------------------------------------------------------------
INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, sensitivity, is_critical, recipient_spec, template_key) VALUES
('leave_submitted',        'leave','Leave request submitted','int',0,
 '{"to":[{"kind":"reporting_manager"}]}',NULL),
('leave_decision',         'leave','Leave approved or rejected','int',1,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"reporting_manager"}]}',NULL),
('leave_pending_branch_head','leave','Leave escalated to branch head','int',0,
 '{"to":[{"kind":"branch_head"},{"kind":"branch_hr"}],"cc":[{"kind":"reporting_manager"}]}',NULL),
('leave_cancelled',        'leave','Leave cancelled','int',0,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"reporting_manager"}]}',NULL),
('leave_lapsed',           'leave','Leave balance lapsed','int',0,
 '{"to":[{"kind":"employee"}]}',NULL),
('leave_credit_posted',    'leave','Leave credited','int',0,
 '{"to":[{"kind":"employee"}]}',NULL),
('leave_approval_overdue', 'leave','Leave approval overdue','int',0,
 '{"to":[{"kind":"reporting_manager"}],"cc":[{"kind":"branch_hr"}]}',NULL),
('leave_balance_digest',   'leave','Monthly leave balance digest','int',0,
 '{"to":[{"kind":"employee"}]}',NULL);

-- Enable all leave events live on fresh installs.
-- INSERT IGNORE above takes table defaults (enabled=0, dispatch_mode='shadow'); this
-- corrects them for the leave module. Re-running is safe: already-live rows are untouched.
UPDATE notification_event_config
SET enabled = 1, dispatch_mode = 'live'
WHERE module = 'leave'
  AND dispatch_mode != 'off';  -- preserve operator-explicit 'off' decisions

-- 2.3 Attendance ------------------------------------------------------------
INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, sensitivity, is_critical, recipient_spec, template_key) VALUES
('attendance_absent',           'attendance','Marked absent','int',0,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"reporting_manager"}]}','ABSENT_ALERT'),
('attendance_late',             'attendance','Late arrival','int',0,
 '{"to":[{"kind":"employee"}]}','LATE_ARRIVAL'),
('attendance_missing_punch',    'attendance','Missing punch','int',0,
 '{"to":[{"kind":"employee"}]}',NULL),
('regularization_submitted',    'attendance','Regularization submitted','int',0,
 '{"to":[{"kind":"reporting_manager"}]}',NULL),
('regularization_decision',     'attendance','Regularization decided','int',1,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"reporting_manager"},{"kind":"wfm_chain"}]}','REGULARIZATION_APPROVED'),
('regularization_stage2_pending','attendance','Regularization awaiting WFM','int',0,
 '{"to":[{"kind":"wfm_chain"}]}',NULL),
('attendance_dispute_escalated','attendance','Attendance dispute escalated','int',0,
 '{"to":[{"kind":"dispute_escalation_target"}],"cc":[{"kind":"branch_hr"}]}',NULL),
('attendance_manager_digest',   'attendance','Daily team attendance digest','int',0,
 '{"to":[{"kind":"reporting_manager"}]}',NULL);

-- 2.4 Payroll ---------------------------------------------------------------
-- Every 'fin' row has an EMPTY cc. The resolver treats a non-empty cc on a 'fin' event
-- as a hard error, not a warning — see NOTIFICATION_CATALOGUE.md section 5.
INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, sensitivity, is_critical, recipient_spec, template_key) VALUES
('payslip_ready',            'payroll','Payslip ready','fin',1,
 '{"to":[{"kind":"employee","emailPolicy":"official_only"}]}','PAYSLIP_READY'),
('salary_credited',          'payroll','Salary credited','fin',1,
 '{"to":[{"kind":"employee","emailPolicy":"official_only"}]}','SALARY_CREDITED'),
('payroll_run_calculated',   'payroll','Payroll run calculated','fin',0,
 '{"to":[{"kind":"role_scope","roleKeys":["payroll_hr"]}],"cc":[{"kind":"role_scope","roleKeys":["payroll_head"]}]}',NULL),
('payroll_run_under_review', 'payroll','Payroll run under review','fin',0,
 '{"to":[{"kind":"role_scope","roleKeys":["finance"]}],"cc":[{"kind":"role_scope","roleKeys":["payroll_head"]}]}',NULL),
('payroll_run_approved',     'payroll','Payroll run approved','fin',1,
 '{"to":[{"kind":"role_scope","roleKeys":["finance"]}],"cc":[{"kind":"role_scope","roleKeys":["payroll_head"]},{"kind":"role_scope","roleKeys":["ceo"],"conditional":"amount_gt_5000000"}]}',NULL),
('payroll_run_locked',       'payroll','Payroll run locked','fin',0,
 '{"to":[{"kind":"role_scope","roleKeys":["payroll_hr"]}],"cc":[{"kind":"role_scope","roleKeys":["finance"]}]}',NULL),
('payroll_window_closing',   'payroll','Payroll input window closing','conf',1,
 '{"to":[{"kind":"role_scope","roleKeys":["payroll_hr"]},{"kind":"branch_hr"}]}',NULL),
('salary_increment_letter',  'payroll','Increment letter released','fin',1,
 '{"to":[{"kind":"employee","emailPolicy":"official_only"}]}',NULL),
('salary_advance_recovery',  'payroll','Salary advance recovery scheduled','fin',0,
 '{"to":[{"kind":"employee","emailPolicy":"official_only"}]}',NULL),
-- The ONE financial event permitted to reach a personal address: the employee has left
-- and the official mailbox is normally disabled. Deliberate, documented exception.
('full_final_ready',         'payroll','Full & final settlement ready','fin',1,
 '{"to":[{"kind":"employee","emailPolicy":"official_then_personal"}]}',NULL),
('tax_declaration_reminder', 'payroll','Tax declaration reminder','fin',0,
 '{"to":[{"kind":"employee","emailPolicy":"official_only"}]}',NULL),
('statutory_filing_due',     'payroll','Statutory filing due','fin',1,
 '{"to":[{"kind":"role_scope","roleKeys":["payroll_head"]}],"cc":[{"kind":"role_scope","roleKeys":["finance"]}]}',NULL);

-- 2.5 SLA / escalation ------------------------------------------------------
-- Longer cooldown: an overdue task stays overdue, and nobody needs a daily reminder
-- of the same breach. This is the single most storm-prone family.
INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, sensitivity, is_critical, recipient_spec, cooldown_minutes, max_per_run, template_key) VALUES
('task_due_soon',            'governance','Task due soon','int',0,
 '{"to":[{"kind":"tat_owner"}]}',2880,50,NULL),
('task_sla_breach_l1',       'governance','SLA breached (L1 owner)','int',0,
 '{"to":[{"kind":"tat_owner"}]}',2880,50,NULL),
('task_sla_breach_l2',       'governance','SLA breached (L2 manager)','int',0,
 '{"to":[{"kind":"tat_owner_manager"}],"cc":[{"kind":"tat_owner"}]}',4320,30,NULL),
('task_sla_breach_l3',       'governance','SLA breached (L3 branch)','int',1,
 '{"to":[{"kind":"branch_head"},{"kind":"branch_hr"}],"cc":[{"kind":"tat_owner_manager"}]}',10080,20,NULL),
('provisioning_overdue',     'governance','IT provisioning overdue','int',1,
 '{"to":[{"kind":"provisioning_assignee"}],"cc":[{"kind":"branch_hr"}]}',2880,50,NULL),
('joining_doc_overdue',      'governance','Joining document overdue','int',0,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"assigned_hr"}]}',2880,50,NULL),
('approval_queue_aging',     'governance','Approval queue aging','int',0,
 '{"to":[{"kind":"approver"}],"cc":[{"kind":"approver_manager"}]}',1440,30,NULL),
('sla_breach_weekly_digest', 'governance','Weekly SLA breach digest','int',0,
 '{"to":[{"kind":"branch_head"},{"kind":"branch_hr"}],"cc":[{"kind":"role_scope","roleKeys":["process_manager"]}]}',10080,20,NULL);

-- 2.6 Report subscription delivery ------------------------------------------
INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, sensitivity, is_critical, recipient_spec, template_key) VALUES
('report_subscription_delivery','reporting','Scheduled report delivered','conf',0,
 '{"to":[{"kind":"subscription_recipients"}]}',NULL),
('report_subscription_failed',  'reporting','Scheduled report failed','conf',0,
 '{"to":[{"kind":"subscription_owner"}]}',NULL);

-- ---------------------------------------------------------------------------
-- 3. Arm the backfill floor
--
-- Applied AFTER the inserts so every event is structurally incapable of seeing anything
-- that came due before this migration ran. Without this, the escalation worker's first
-- run would find every overdue task in the system's history at once.
--
-- Precedent this exists to prevent: official-email-compliance.worker.ts once emitted
-- 43,943 duplicate alerts.
-- ---------------------------------------------------------------------------
UPDATE notification_event_config
   SET backfill_floor_at = NOW()
 WHERE backfill_floor_at IS NULL;

-- ---------------------------------------------------------------------------
-- Verification (run after applying, before enabling anything)
-- ---------------------------------------------------------------------------
-- SELECT module, COUNT(*) events, SUM(enabled) enabled, SUM(dispatch_mode='live') live
--   FROM notification_event_config GROUP BY module WITH ROLLUP;
--   -- expect 48 events, enabled=0, live=0 across the board
--
-- SELECT event_code FROM notification_event_config
--  WHERE sensitivity='fin' AND JSON_LENGTH(recipient_spec->'$.cc') > 0;
--   -- MUST return zero rows: no financial event may CC anyone
--
-- Go live, one event at a time:
--   UPDATE notification_event_config
--      SET enabled=1, dispatch_mode='live' WHERE event_code='provisioning_overdue';
-- Roll back:
--   UPDATE notification_event_config
--      SET enabled=0, dispatch_mode='shadow' WHERE event_code='provisioning_overdue';
