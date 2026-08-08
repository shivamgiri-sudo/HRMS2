-- 1112_notification_dispatch_block.sql
--
-- An emergency stop for outbound notifications that does not need a deploy.
--
-- WHY THIS EXISTS
--
-- On 2026-08-05..08 esign-compliance sent 1,863 messages — email AND SMS — to 10
-- contacts from three pending documents, and there was no way to stop it short of
-- `pm2 stop hrms2-workers`, which would have silenced all 45 workers. That is not
-- a killswitch, it is a power cut.
--
-- The reason there was nothing better: two rival paths send mail.
--   * notificationGateway.notify() reads notification_event_config and can be
--     turned off per event.
--   * notificationEventService.dispatch() -> dispatchService.send() reads NO
--     enable flag at all, and it is the path the 53-event catalogue actually
--     uses. It also logs to dispatch_log rather than notification_log, so the
--     usual "is anything sending?" queries miss it entirely.
--
-- WHY NOT REUSE notification_event_config
--
-- Because a row there is not just a switch. recipient_spec is `json NOT NULL`
-- with no default and the gateway RESOLVES RECIPIENTS from it at send time, so
-- inserting a row to get an on/off flag silently asserts a recipient policy that
-- this path never consults. The in-repo note is explicit that adding rows for
-- gateway-bypassing mailers is the wrong fix precisely because an operator would
-- then set enabled = 0 and still get mail. This table has one job and no
-- recipient semantics, so it cannot mislead in that way.
--
-- SEMANTICS
--
--   scope = 'global'      blocks every outbound notification on the dispatch path
--   scope = '<event_code>' blocks that catalogue event only (e.g. 'esign_reminder')
--
-- Blocks OUTBOUND channels only — email, SMS, WhatsApp. The in-app portal item is
-- still written, so stopping a storm does not also erase the record that the
-- event occurred. That is the distinction that matters at 2am: nobody is paged by
-- an inbox row.
--
-- Absence of a row means ALLOW, and the reader fails OPEN on any database error.
-- A killswitch that silences every notification the moment information_schema
-- hiccups is a worse outage than the one it prevents. Deliberately the opposite
-- of the esign cooldown in 1109, which fails CLOSED — there the risk is sending
-- too much, here the risk is sending nothing.
--
-- Turning it on and off is one statement, effective within the 60s cache:
--   UPDATE notification_dispatch_block SET blocked = 1, reason = 'storm from X'
--    WHERE scope = 'global';
--   INSERT INTO notification_dispatch_block (scope, blocked, reason)
--   VALUES ('esign_reminder', 1, 'investigating')
--   ON DUPLICATE KEY UPDATE blocked = 1, reason = VALUES(reason);

-- Plain ASCII, no embedded quotes in COMMENT, and standard MySQL 8 DDL only.
-- 1110 had to be rewritten because it shipped MariaDB-only ADD COLUMN IF NOT
-- EXISTS, which MySQL 8.0.42 rejects outright; CREATE TABLE IF NOT EXISTS is
-- valid on both and makes this re-runnable.
CREATE TABLE IF NOT EXISTS notification_dispatch_block (
  scope      VARCHAR(80)  NOT NULL COMMENT 'global, or a NOTIFICATION_EVENT_CATALOG event_code',
  blocked    TINYINT(1)   NOT NULL DEFAULT 0,
  reason     VARCHAR(255) NULL COMMENT 'why it was stopped - appears in the log line',
  blocked_by VARCHAR(120) NULL,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seeded UNBLOCKED. The row exists so the lever is discoverable — an operator
-- looking for "how do I stop this" finds a row rather than having to know the
-- table's shape under pressure.
INSERT INTO notification_dispatch_block (scope, blocked, reason)
VALUES ('global', 0, 'Set blocked = 1 to stop ALL outbound notifications on the dispatchService path. Effective within 60s, no deploy.')
ON DUPLICATE KEY UPDATE reason = VALUES(reason);
