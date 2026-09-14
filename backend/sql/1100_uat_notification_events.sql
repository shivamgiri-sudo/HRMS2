-- 1100_uat_notification_events.sql
--
-- Registers the ten UAT lifecycle events in notification_event_config.
--
-- WHY A SEED IS REQUIRED AT ALL
--   notificationGateway.notify() fails CLOSED: an event_code with no row in this table is
--   reported as `disabled` and nothing is sent. That is the correct default — an
--   unconfigured notification must never send rather than never run — but it means a call
--   site without a matching row here is silently dead. Registering the events and wiring the
--   call sites are two halves of one change; shipping either alone produces a feature that
--   looks present and does nothing.
--
-- THE ROWS ARE INSERTED SWITCHED OFF, ON PURPOSE
--   notification_event_config defaults `enabled` to 0 and `dispatch_mode` to 'shadow', and
--   this migration overrides neither. So every event lands DISABLED: two independent flags
--   must be flipped before a single message reaches a real person.
--
--   To enable, once UAT actually starts and the templates have been reviewed:
--     UPDATE notification_event_config SET enabled = 1              WHERE module = 'uat';
--     -- observe dispatch claims in shadow first, then:
--     UPDATE notification_event_config SET dispatch_mode = 'live'   WHERE module = 'uat';
--
--   That is an operational decision with a named owner, not something a migration should
--   take on everyone's behalf while the platform is still being built.
--
-- RECIPIENTS
--   `reporter` is expressed as {"kind":"employee"} because the gateway resolves that against
--   the employee in the notification context, and for UAT feedback that context IS the
--   reporter. Approver and owner routing uses the role kinds the gateway already supports;
--   nothing new is invented here.
--
-- Idempotent: INSERT IGNORE on the unique event_code. Safe to re-run.

START TRANSACTION;

INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, sensitivity, is_critical, recipient_spec, template_key) VALUES

-- Intake and triage
('uat_feedback_blocked',        'uat','UAT feedback needs an engineer','int',0,
 '{"to":[{"kind":"employee"}]}',NULL),
('uat_feedback_needs_info',     'uat','UAT feedback: clarification requested','int',0,
 '{"to":[{"kind":"employee"}]}',NULL),
('uat_feedback_assigned',       'uat','UAT feedback assigned','int',0,
 '{"to":[{"kind":"reporting_manager"}]}',NULL),

-- Governance
('uat_approval_requested',      'uat','UAT approval requested','int',1,
 '{"to":[{"kind":"reporting_manager"}]}',NULL),
('uat_approval_decided',        'uat','UAT approval granted or refused','int',0,
 '{"to":[{"kind":"employee"}]}',NULL),

-- Build (call sites arrive with Phase 4; registered now so the pair never drifts apart)
('uat_build_failed',            'uat','UAT automated build failed','int',1,
 '{"to":[{"kind":"reporting_manager"}]}',NULL),
('uat_pr_ready',                'uat','UAT change ready for review','int',0,
 '{"to":[{"kind":"reporting_manager"}]}',NULL),

-- Release lifecycle
('uat_deployed_for_retest',     'uat','UAT fix deployed, retest requested','int',1,
 '{"to":[{"kind":"employee"}]}',NULL),
('uat_retest_failed',           'uat','UAT retest failed, item reopened','int',1,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"reporting_manager"}]}',NULL),
('uat_released',                'uat','UAT fix released to production','int',0,
 '{"to":[{"kind":"employee"}]}',NULL),
('uat_rolled_back',             'uat','UAT release rolled back','int',1,
 '{"to":[{"kind":"employee"}],"cc":[{"kind":"reporting_manager"}]}',NULL),
('uat_closed',                  'uat','UAT item closed','int',0,
 '{"to":[{"kind":"employee"}]}',NULL);

COMMIT;

-- Rollback:
--   DELETE FROM notification_event_config WHERE module = 'uat';
-- No row with module='uat' existed before this migration, so the delete restores the prior
-- state. Dispatch claims referencing these codes, if any exist by then, are history and are
-- deliberately NOT removed.
