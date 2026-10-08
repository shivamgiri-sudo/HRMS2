-- Migration 1995: Roster Requests hub - decision audit log, per-process auto-approval rules,
-- and one-escalation-per-request guard.
--
-- Additive and idempotent (CREATE TABLE IF NOT EXISTS only).

CREATE TABLE IF NOT EXISTS roster_request_decision_log (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  kind          VARCHAR(32)   NOT NULL,
  source_id     CHAR(36)      NOT NULL,
  action        VARCHAR(32)   NOT NULL,
  actor_user_id CHAR(36)      NULL,
  auto          TINYINT(1)    NOT NULL DEFAULT 0,
  reason        VARCHAR(1000) NULL,
  before_json   JSON          NULL,
  after_json    JSON          NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rrdl_kind_source (kind, source_id),
  INDEX idx_rrdl_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roster_request_auto_rule (
  id                         CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id                 CHAR(36)    NOT NULL,
  kind                       VARCHAR(32) NOT NULL,
  enabled                    TINYINT(1)  NOT NULL DEFAULT 0,
  max_coverage_drop          INT         NOT NULL DEFAULT 0,
  require_counterpart_accept TINYINT(1)  NOT NULL DEFAULT 1,
  updated_by                 CHAR(36)    NULL,
  updated_at                 DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_kind (process_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roster_request_escalation (
  id           CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  kind         VARCHAR(32) NOT NULL,
  source_id    CHAR(36)    NOT NULL,
  escalated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kind_source (kind, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
