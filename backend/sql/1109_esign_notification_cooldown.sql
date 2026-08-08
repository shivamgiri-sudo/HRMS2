-- 1109_esign_notification_cooldown.sql
--
-- Gives the e-sign compliance worker a cooldown that survives a restart, and a
-- switch that can stop it without one.
--
-- What went wrong. esign-compliance.worker.ts kept its 24h reminder and 48h
-- escalation cooldowns in in-process Maps, and startEsignComplianceWorker() ran a
-- full cycle the moment it started. hrms-workers runs under pm2 with
-- restart_delay 5000 / max_restarts 10, so every restart began with an empty
-- cooldown and immediately re-sent everything it found.
--
-- Measured on 2026-08-08 against mas_hrms, over 2026-08-05..08:
--     Joining document eSign pending           993 messages
--     eSign link expiring - non-responsive     435 messages
--                                            1,428 to 10 contacts
-- from a standing set of exactly THREE pending documents. Dispatch cycles were
-- 7-30 minutes apart, which no 4-hour interval can produce. Both events are
-- is_critical, and dispatch.service.ts line 128 lets a critical event bypass the
-- recipient's own channel preference, so this went out over email AND SMS with no
-- way for anyone to opt out - 214 SMS to a single number. One preboarding
-- candidate received 47 messages, 29 of them an internal HR escalation naming a
-- different employee.
--
-- There was no killswitch of any kind. notification_event_config has no row for
-- either event, and only notification.gateway.ts reads that table - this worker
-- dispatches through notificationEventService -> dispatchService, which consults
-- no enable flag at all. worker_config had no esign-compliance row either, and
-- the worker never read it. Stopping the send required pm2 stop hrms-workers.
--
-- Two things ship here.
--
-- 1. esign_notification_cooldown - the durable replacement for the Maps. Keyed on
--    (employee, checklist, kind) so a reminder and an escalation for the same
--    document hold independent cooldowns, and an escalation about employee A does
--    not suppress one about employee B. No FK to employees(id): that column is
--    utf8mb4_unicode_ci and an implicit-collation FK here fails with errno 3780.
--    The worker fails CLOSED on any error reading or writing this table - it skips
--    the send. The defect being fixed is a cooldown that silently evaluated to
--    "go ahead", so the safe direction on doubt is not to send.
--
-- 2. The worker_config row, seeded enabled = 0. It ships OFF deliberately, matching
--    tat-escalation (1023) and report-subscription (1025): a worker that has just
--    sent 1,428 messages does not come back automatically on the next deploy. Turn
--    it on only after confirming the cooldown table is being written, with:
--        UPDATE worker_config SET enabled = 1 WHERE worker_name = 'esign-compliance';
--    That single row is now the killswitch that did not exist. The worker reads an
--    ABSENT row as disabled, so a failed seed cannot start it either.

CREATE TABLE IF NOT EXISTS esign_notification_cooldown (
  id                CHAR(36)     NOT NULL,
  employee_id       CHAR(36)     NOT NULL,
  checklist_id      CHAR(36)     NOT NULL,
  notification_kind VARCHAR(32)  NOT NULL COMMENT 'reminder | manager_escalation | hr_escalation',
  last_sent_at      DATETIME     NOT NULL,
  send_count        INT          NOT NULL DEFAULT 1,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- The worker's ON DUPLICATE KEY UPDATE depends on this being unique.
  UNIQUE KEY uq_esign_cooldown_scope (employee_id, checklist_id, notification_kind),
  KEY ix_esign_cooldown_last_sent (last_sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO worker_config (worker_name, enabled, description)
VALUES (
  'esign-compliance',
  0,
  'Joining-document eSign reminders and escalations. Shipped DISABLED after the 2026-08-05..08 mail storm (1,428 messages to 10 contacts from 3 pending documents, caused by in-memory cooldowns reset by every pm2 restart). Cooldowns are now durable in esign_notification_cooldown. Enable only after confirming that table is being written.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
