-- 1823_training_reminder_nudge_event.sql
--
-- Seeds ONE notification_event_config row for a manager-initiated, one-off reminder nudge
-- against a specific pending training_assignment (US4.6 "Send Reminder" bulk action).
--
-- This is deliberately a NEW event code, not a reuse of task_sla_breach_l1/l2/l3
-- (tat-escalation.worker.ts's automatic escalation ladder) — those are the SYSTEM escalating
-- on a schedule; this is a MANAGER choosing, right now, to nudge one employee about one item.
-- Conflating the two would misrepresent who triggered the notification in the audit trail.
--
-- Additive, idempotent: CREATE TABLE IF NOT EXISTS matches 1022/1756's shape exactly (no new
-- columns), + INSERT IGNORE. Re-running changes nothing.
--
-- COOLDOWN IS DELIBERATELY SHORT (30 minutes), NOT THE 1440-minute default other events use.
-- notification.gateway.ts's cooldown keys on (event_code, entity_type, entity_id) alone — NOT
-- on dedupeKey — so any cooldown here throttles every manual nudge against the same
-- assignment, from any manager, regardless of what dedupeKey the caller passes. A day-long
-- cooldown would mean a manager who nudges twice in the same shift gets silently swallowed
-- the second time with no error surfaced (the gateway returns 'cooldown', not an exception) —
-- exactly the kind of silent-no-op this codebase's own incident history warns about. 30
-- minutes stops literal double-click spam while still letting a manager re-nudge later the
-- same day if the first nudge visibly did nothing.
--
-- sensitivity='int': internal training-compliance nudge, not compensation- or PII-adjacent.

CREATE TABLE IF NOT EXISTS notification_event_config (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()),
  event_code        VARCHAR(80)   NOT NULL,
  module            VARCHAR(40)   NOT NULL,
  display_name      VARCHAR(160)  NOT NULL,
  description       VARCHAR(500)  NULL,
  enabled           TINYINT(1)    NOT NULL DEFAULT 0,
  dispatch_mode     ENUM('shadow','live','off') NOT NULL DEFAULT 'shadow',
  channels          VARCHAR(80)   NOT NULL DEFAULT 'email',
  is_critical       TINYINT(1)    NOT NULL DEFAULT 0,
  sensitivity       ENUM('int','conf','fin') NOT NULL DEFAULT 'int',
  recipient_spec    JSON          NOT NULL,
  backfill_floor_at DATETIME      NULL,
  max_per_run       INT UNSIGNED  NOT NULL DEFAULT 50,
  max_per_day       INT UNSIGNED  NOT NULL DEFAULT 500,
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

INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, description, enabled, dispatch_mode, sensitivity, is_critical,
   recipient_spec, cooldown_minutes, template_key)
VALUES
('training_reminder_nudge', 'quality_learning',
 'Training reminder nudge',
 'Manager-initiated, on-demand reminder about one specific pending training_assignment — fired from the "Send Reminder" bulk action on the manager dashboard, not from any scheduled sweep. Distinct from the automatic task_sla_breach_l1/l2/l3 escalation ladder (tat-escalation.worker.ts), which is the system escalating on a schedule rather than a manager choosing to nudge right now.',
 1, 'live', 'int', 0,
 '{"to":[{"kind":"employee"}]}',
 -- Deliberately short — see header. The gateway''s cooldown keys on (event_code, entity_type,
 -- entity_id) only, not on dedupeKey, so this bounds how often ANY manager can re-nudge the
 -- SAME assignment, not just the calling one.
 30,
 NULL);

UPDATE notification_event_config
   SET backfill_floor_at = NOW()
 WHERE event_code = 'training_reminder_nudge' AND backfill_floor_at IS NULL;

-- Verification (run after applying):
--   SELECT event_code, enabled, dispatch_mode, sensitivity, cooldown_minutes, recipient_spec
--     FROM notification_event_config WHERE event_code = 'training_reminder_nudge';
--   -- expect enabled=1, dispatch_mode='live', sensitivity='int', cooldown_minutes=30, to=[employee]
