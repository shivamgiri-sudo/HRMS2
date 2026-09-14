-- 1023_notification_dispatch_claim.sql
--
-- The idempotency and audit substrate for notificationGateway.notify().
--
-- A claim row is written BEFORE the provider is called. A crash mid-send therefore loses
-- a message rather than duplicating it, which is the correct trade for payroll and
-- escalation mail. The unique key does the deduplication in the database, not in process
-- memory — sla-breach-worker.ts:28 keeps its cooldown in a Map, which resets on every pm2
-- restart, and ecosystem.config.cjs permits 10 of those.
--
-- Additive and idempotent. NOT EXECUTED against production (CLAUDE.md rule 4).
--
-- Depends on: 1022_notification_event_registry.sql

-- ---------------------------------------------------------------------------
-- 1. The claim ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_dispatch_claim (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  event_code       VARCHAR(80)  NOT NULL,

  -- Caller-supplied identity of "this notification about this thing, once".
  -- Convention: '<entity_type>:<entity_id>[:<discriminator>]', e.g.
  --   'leave_request:abc-123'            one decision mail per request
  --   'task_tat_instance:xyz-9:level2'   one mail per escalation level, not per poll
  dedupe_key       VARCHAR(190) NOT NULL,

  -- 'shadow' rows record what WOULD have been sent. They are the pre-go-live evidence:
  -- if a shadow run produces 43,943 rows you learn it from a SELECT rather than from
  -- every employee's inbox. See official-email-compliance.worker.ts for why that number.
  mode             ENUM('shadow','live') NOT NULL DEFAULT 'shadow',

  status           ENUM('claimed','sent','failed','suppressed') NOT NULL DEFAULT 'claimed',
  recipient_count  INT UNSIGNED NOT NULL DEFAULT 0,
  cc_count         INT UNSIGNED NOT NULL DEFAULT 0,
  bcc_count        INT UNSIGNED NOT NULL DEFAULT 0,
  dropped_count    INT UNSIGNED NOT NULL DEFAULT 0,

  -- Masked addresses and drop reasons, for the Recipients tab and post-incident review.
  -- Never full addresses: this table is read by support.
  recipient_digest JSON         NULL,

  entity_type      VARCHAR(60)  NULL,
  entity_id        VARCHAR(64)  NULL,
  correlation_id   VARCHAR(64)  NULL,
  dispatch_log_id  VARCHAR(36)  NULL,
  error_message    TEXT         NULL,

  claimed_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at     DATETIME     NULL,

  PRIMARY KEY (id),
  -- THE guard. Two concurrent workers racing the same event lose one INSERT to a
  -- duplicate-key error, which the gateway treats as "already handled" and skips.
  UNIQUE KEY uq_ndc_dedupe (event_code, dedupe_key),
  KEY idx_ndc_mode_time (mode, claimed_at),
  KEY idx_ndc_event_time (event_code, claimed_at),
  KEY idx_ndc_entity (entity_type, entity_id),
  KEY idx_ndc_status (status, claimed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. Envelope columns on dispatch_log
--
-- dispatch_log models one row per recipient. An envelope is one message with real
-- To/CC/BCC, so it needs to record the whole addressee set on a single row. All columns
-- are nullable with safe defaults, so the 24 existing send sites are untouched.
-- ---------------------------------------------------------------------------
SET @db := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='dispatch_log' AND COLUMN_NAME='cc_contacts') = 0,
  'ALTER TABLE dispatch_log ADD COLUMN cc_contacts TEXT NULL AFTER recipient_contact',
  'SELECT "dispatch_log.cc_contacts exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='dispatch_log' AND COLUMN_NAME='bcc_contacts') = 0,
  'ALTER TABLE dispatch_log ADD COLUMN bcc_contacts TEXT NULL AFTER cc_contacts',
  'SELECT "dispatch_log.bcc_contacts exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='dispatch_log' AND COLUMN_NAME='recipient_count') = 0,
  'ALTER TABLE dispatch_log ADD COLUMN recipient_count INT UNSIGNED NOT NULL DEFAULT 1 AFTER bcc_contacts',
  'SELECT "dispatch_log.recipient_count exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='dispatch_log' AND COLUMN_NAME='event_code') = 0,
  'ALTER TABLE dispatch_log ADD COLUMN event_code VARCHAR(80) NULL AFTER template_name',
  'SELECT "dispatch_log.event_code exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='dispatch_log' AND COLUMN_NAME='correlation_id') = 0,
  'ALTER TABLE dispatch_log ADD COLUMN correlation_id VARCHAR(64) NULL AFTER event_code',
  'SELECT "dispatch_log.correlation_id exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='dispatch_log' AND INDEX_NAME='idx_dl_event_sent') = 0,
  'ALTER TABLE dispatch_log ADD INDEX idx_dl_event_sent (event_code, sent_at)',
  'SELECT "dispatch_log.idx_dl_event_sent exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 3. Worker kill switches
--
-- worker_config was created by 533_worker_distributed_safety.sql and has never been read
-- by any code (grep worker_config over backend/src returns nothing) — a kill switch
-- nobody wired up. shared/worker-config.ts now reads it, and these two rows land
-- DISABLED so neither new worker runs on deploy.
-- ---------------------------------------------------------------------------
INSERT INTO worker_config (worker_name, enabled, description, schedule_cron)
VALUES
  ('tat-escalation',      0, 'SLA/TAT escalation email worker. Enable only after a shadow run has been reviewed.', '*/15 * * * *'),
  ('report-subscription', 0, 'Scheduled report subscription dispatcher. Enable only after a shadow run has been reviewed.', '*/10 * * * *')
ON DUPLICATE KEY UPDATE description = VALUES(description);
-- ON DUPLICATE deliberately does NOT touch `enabled`: re-running this migration must
-- never re-enable a worker an operator has switched off.

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT worker_name, enabled FROM worker_config
--  WHERE worker_name IN ('tat-escalation','report-subscription');
--   -- both MUST read 0 after applying
--
-- Shadow-run review, before enabling anything:
-- SELECT event_code, DATE(claimed_at) d, COUNT(*) msgs, SUM(recipient_count) addressees
--   FROM notification_dispatch_claim
--  WHERE mode='shadow' AND claimed_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)
--  GROUP BY 1,2 ORDER BY msgs DESC;
