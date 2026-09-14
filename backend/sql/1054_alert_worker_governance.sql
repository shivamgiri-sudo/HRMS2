-- 1054_alert_worker_governance.sql
--
-- Control and durable dedupe for the two ATS alert mailers.
--
-- Why this exists
-- ---------------
-- sla-breach-worker and interview-delay-alert both mail recruiters and HR through
-- their own paths — ats-notification.helper -> emailService for the first, a private
-- nodemailer transport for the second. Neither reads notification_event_config, so
-- turning off all 53 events in the notifications admin screen (only 3 are enabled,
-- and all four sla_breach rows are 0) changed nothing for either of them. Neither
-- writes notification_log either, which is why the log has been silent since
-- 28 Jul while mail kept arriving.
--
-- worker_config.enabled is the lever that does work. sla-breach already had a row;
-- interview-delay-alert had none, and isWorkerEnabled fails open on a missing row,
-- so it could not be stopped at all short of a deploy.
--
-- Both cooldowns are in-memory Maps. ecosystem.config.cjs permits 10 pm2 restarts,
-- and each one re-alerts every waiting candidate. 1023_notification_dispatch_claim.sql
-- called this out at the time; alert_cooldown is the minimal fix for the two workers
-- that never moved onto the gateway.
--
-- Additive and idempotent. Seeds interview-delay-alert as enabled = 1 so behaviour is
-- unchanged by applying this — turning either alert off is a deliberate operator
-- action:
--   UPDATE worker_config SET enabled = 0 WHERE worker_name = 'sla-breach';
--   UPDATE worker_config SET enabled = 0 WHERE worker_name = 'interview-delay-alert';
-- Takes effect within ~60s (isWorkerEnabled caches for that long). No restart needed.
--
-- NOT EXECUTED against production (CLAUDE.md rule 4).

-- ---------------------------------------------------------------------------
-- 1. Make interview-delay-alert controllable
--
--    Seeded enabled = 1 deliberately. A missing row already means "runs", so
--    seeding 0 here would silently stop a live alert as a side effect of applying
--    a migration, which is not what a schema change should decide.
-- ---------------------------------------------------------------------------
INSERT INTO worker_config (worker_name, enabled)
SELECT 'interview-delay-alert', 1
  FROM DUAL
 WHERE NOT EXISTS (
   SELECT 1 FROM worker_config WHERE worker_name = 'interview-delay-alert'
 );

-- ---------------------------------------------------------------------------
-- 2. Cooldown that survives a restart
--
--    alert_key is '<worker-name>:<subject-id>' — the candidate or queue token the
--    alert is about. Deliberately NOT notification_dispatch_claim: that table is
--    the gateway's own ledger and is read by support as an audit of what the
--    gateway did. Writing rows to it from workers that never call the gateway
--    would falsify that audit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_cooldown (
  alert_key    VARCHAR(190) NOT NULL COMMENT '<worker-name>:<subject-id>',
  last_sent_at DATETIME     NOT NULL,
  send_count   INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (alert_key),
  KEY idx_alert_cooldown_last_sent (last_sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Restart-durable per-subject alert throttle for workers that do not use notificationGateway';
