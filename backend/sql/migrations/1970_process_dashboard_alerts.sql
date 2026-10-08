-- Migration 1960: Process Dashboard alerts + digests.
--   process_dashboard_alert_rule   one row per threshold / anomaly rule of a process dashboard (metric, comparator, window, scope, recipients, channels, cooldown)
--   process_dashboard_alert_event  one row per firing (rule + data date is UNIQUE, so a re-run of the worker can never double-fire), with acknowledge state
--   process_dashboard_digest       scheduled summary e-mail per process (daily | weekly)
-- ADDITIVE ONLY: three new tables, no backfill, no change to existing tables. Idempotent (CREATE TABLE IF NOT EXISTS).
-- recipients is a JSON spec {roles:[], tls:[], employeeIds:[]}; it is re-checked against the process scope every time it is used (never trusted from here).

-- No foreign key to process_master, deliberately: creating one takes a metadata lock on that very busy table, and on
-- 2026-09-30 that wait timed out at startup (Lock wait timeout exceeded), blocked the boot and rolled the deploy back.
-- process_id is still indexed; rows of a deleted process are simply never read.
CREATE TABLE IF NOT EXISTS process_dashboard_alert_rule (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  process_id       CHAR(36)      NOT NULL,
  name             VARCHAR(120)  NOT NULL,
  metric_key       VARCHAR(64)   NOT NULL,
  comparator       ENUM('gt','gte','lt','lte') NOT NULL DEFAULT 'lt',
  threshold        DECIMAL(18,4) NOT NULL DEFAULT 0,
  window_days      SMALLINT      NOT NULL DEFAULT 1,
  consecutive_days SMALLINT      NOT NULL DEFAULT 1,
  scope_tl         VARCHAR(120)      NULL,
  scope_lob        VARCHAR(120)      NULL,
  severity         ENUM('info','warn','critical') NOT NULL DEFAULT 'warn',
  recipients       JSON          NOT NULL,
  channels         JSON          NOT NULL,
  cooldown_minutes INT           NOT NULL DEFAULT 1440,
  enabled          TINYINT(1)    NOT NULL DEFAULT 1,
  last_evaluated_at DATETIME         NULL,
  last_fired_at    DATETIME          NULL,
  created_by       CHAR(36)          NULL,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pdar_process (process_id, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_dashboard_alert_event (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  rule_id          CHAR(36)      NOT NULL,
  process_id       CHAR(36)      NOT NULL,
  data_date        DATE          NOT NULL,
  fired_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metric_key       VARCHAR(64)   NOT NULL,
  metric_value     DECIMAL(20,4)     NULL,
  threshold        DECIMAL(18,4)     NULL,
  severity         ENUM('info','warn','critical') NOT NULL DEFAULT 'warn',
  message          VARCHAR(500)  NOT NULL,
  context          JSON              NULL,
  notified         TINYINT(1)    NOT NULL DEFAULT 0,
  notified_at      DATETIME          NULL,
  notify_summary   JSON              NULL,
  acknowledged_by  CHAR(36)          NULL,
  acknowledged_at  DATETIME          NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pdae_rule_date (rule_id, data_date),
  KEY idx_pdae_process_open (process_id, acknowledged_at, fired_at),
  CONSTRAINT fk_pdae_rule FOREIGN KEY (rule_id) REFERENCES process_dashboard_alert_rule (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_dashboard_digest (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  process_id       CHAR(36)      NOT NULL,
  frequency        ENUM('daily','weekly') NOT NULL DEFAULT 'daily',
  send_time        CHAR(5)       NOT NULL DEFAULT '08:00',
  recipients       JSON          NOT NULL,
  enabled          TINYINT(1)    NOT NULL DEFAULT 1,
  last_sent_at     DATETIME          NULL,
  created_by       CHAR(36)          NULL,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pdd_process_freq (process_id, frequency),
  KEY idx_pdd_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
