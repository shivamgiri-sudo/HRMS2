-- MIS email scheduler: schedules that send a process MIS export by email at a set time.
-- Additive, CREATE TABLE IF NOT EXISTS only. Lives in mas_hrms (the writable PeopleOS DB),
-- not db_masmis, because the app DB user has no CREATE on db_masmis (see sql/1766, 1779).
--
-- NOT registered in runPendingMigrations.ts on purpose: it is applied only after explicit
-- approval, against a verified schema. Register it there once it has been run.

CREATE TABLE IF NOT EXISTS mis_email_schedule (
  id               CHAR(36)      NOT NULL,
  dashboard_key    VARCHAR(60)   NOT NULL,
  report_title     VARCHAR(160)  NOT NULL,
  lob              VARCHAR(60)   NULL,
  to_addresses     VARCHAR(1000) NOT NULL,
  cc_addresses     VARCHAR(1000) NULL,
  subject          VARCHAR(200)  NOT NULL,
  body_text        TEXT          NOT NULL,
  range_mode       ENUM('mtd','yesterday','last_7_days','fixed') NOT NULL DEFAULT 'mtd',
  range_from       DATE          NULL,
  range_to         DATE          NULL,
  frequency        ENUM('once','daily','weekly') NOT NULL,
  send_time        CHAR(5)       NOT NULL COMMENT 'HH:mm, server local time (same clock as the other schedulers)',
  send_on_date     DATE          NULL COMMENT 'once only',
  weekday          TINYINT       NULL COMMENT 'weekly only, 0=Sunday .. 6=Saturday',
  status           ENUM('active','paused','completed','cancelled') NOT NULL DEFAULT 'active',
  next_run_at      VARCHAR(19)   NULL COMMENT 'local time, YYYY-MM-DD HH:mm:ss; compared as text against the worker clock',
  claimed_until    VARCHAR(19)   NULL COMMENT 'lease set by the worker so two backends never send the same run twice',
  last_run_at      VARCHAR(19)   NULL,
  last_status      VARCHAR(20)   NULL,
  last_error       TEXT          NULL,
  created_by       VARCHAR(64)   NOT NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mis_email_schedule_due (status, next_run_at),
  KEY idx_mis_email_schedule_dashboard (dashboard_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mis_email_schedule_run (
  id             CHAR(36)      NOT NULL,
  schedule_id    CHAR(36)      NOT NULL,
  trigger_type   ENUM('scheduled','manual') NOT NULL,
  started_at     VARCHAR(19)   NOT NULL,
  finished_at    VARCHAR(19)   NULL,
  status         ENUM('sent','failed') NOT NULL,
  period_from    DATE          NULL,
  period_to      DATE          NULL,
  to_addresses   VARCHAR(1000) NOT NULL,
  cc_addresses   VARCHAR(1000) NULL,
  attachment_rows INT          NULL,
  message_id     VARCHAR(255)  NULL,
  error          TEXT          NULL,
  PRIMARY KEY (id),
  KEY idx_mis_email_schedule_run_schedule (schedule_id, started_at),
  CONSTRAINT fk_mis_email_schedule_run_schedule FOREIGN KEY (schedule_id) REFERENCES mis_email_schedule (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
