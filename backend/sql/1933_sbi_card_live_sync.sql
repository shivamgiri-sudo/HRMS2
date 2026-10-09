-- Migration 1933: SBI Card Collections — live-sync support tables.
-- sbi_card_agent_time: per-agent per-day APR / time-on-system breakdown (auto-synced from ViciDial).
-- sbi_card_roster:     agent roster linking dialer IDs to employee IDs, teams, team leaders.
-- sbi_card_live_sync_log: audit log for every sync run.

CREATE TABLE IF NOT EXISTS sbi_card_agent_time (
  id              CHAR(36)       NOT NULL PRIMARY KEY,
  process_id      CHAR(36)       NOT NULL,
  report_date     DATE           NOT NULL,
  employee_id     VARCHAR(30)    NOT NULL,
  agent_name      VARCHAR(150)   NULL,
  calls           INT            NULL,
  login_sec       INT            NULL,
  wait_sec        INT            NULL,
  talk_sec        INT            NULL,
  dispo_sec       INT            NULL,
  pause_sec       INT            NULL,
  dead_sec        INT            NULL,
  acht_sec        INT            NULL,
  first_login_time TIME          NULL,
  last_logout_time TIME          NULL,
  pause_lb_sec    INT            NULL,
  pause_tb_sec    INT            NULL,
  pause_wb_sec    INT            NULL,
  pause_mb_sec    INT            NULL,
  pause_qb_sec    INT            NULL,
  pause_login_sec INT            NULL,
  data_source     VARCHAR(100)   NOT NULL DEFAULT 'vicidial_sync',
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sbi_card_agent_time (process_id, report_date, employee_id),
  KEY idx_sbi_card_agent_time_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sbi_card_roster (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  process_id   CHAR(36)      NOT NULL,
  dialer_id    VARCHAR(30)   NOT NULL,
  employee_id  VARCHAR(30)   NULL,
  agent_name   VARCHAR(150)  NULL,
  gh           VARCHAR(100)  NULL,
  team         VARCHAR(100)  NULL,
  team_leader  VARCHAR(150)  NULL,
  mode         VARCHAR(50)   NULL,
  data_source  VARCHAR(100)  NOT NULL DEFAULT 'vicidial_sync',
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sbi_card_roster (process_id, dialer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sbi_card_live_sync_log (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  process_id       CHAR(36)     NOT NULL,
  sync_date        DATE         NOT NULL,
  trigger_source   VARCHAR(50)  NOT NULL DEFAULT 'manual',
  triggered_by     CHAR(36)     NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'running',
  rows_dialer_mis  INT          NULL,
  rows_agent_mis   INT          NULL,
  rows_agent_time  INT          NULL,
  rows_roster      INT          NULL,
  error_message    TEXT         NULL,
  started_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at      DATETIME     NULL,
  KEY idx_sbi_card_sync_log_date (process_id, sync_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
