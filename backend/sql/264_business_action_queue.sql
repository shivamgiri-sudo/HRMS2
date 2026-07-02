-- 264_business_action_queue.sql
-- Creates tables for Business Actions / Command Center module

USE mas_hrms;

CREATE TABLE IF NOT EXISTS business_action_queue (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  source_module     VARCHAR(100)  NOT NULL DEFAULT 'manual',
  source_id         CHAR(36)      NULL,
  risk_type         VARCHAR(100)  NOT NULL,
  severity          ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
  title             VARCHAR(500)  NOT NULL,
  description       TEXT          NULL,
  owner_user_id     CHAR(36)      NULL,
  owner_role        VARCHAR(100)  NULL,
  due_date          DATE          NULL,
  status            VARCHAR(50)   NOT NULL DEFAULT 'open',
  escalation_level  TINYINT       NOT NULL DEFAULT 0,
  closure_note      TEXT          NULL,
  completed_at      DATETIME      NULL,
  created_by        CHAR(36)      NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_baq_status    (status),
  INDEX idx_baq_severity  (severity),
  INDEX idx_baq_source    (source_module),
  INDEX idx_baq_owner     (owner_user_id),
  INDEX idx_baq_due       (due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_action_comment (
  id              CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  action_id       CHAR(36)    NOT NULL,
  author_user_id  CHAR(36)    NOT NULL,
  comment_text    TEXT        NOT NULL,
  is_internal     TINYINT(1)  NOT NULL DEFAULT 0,
  created_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bac_action (action_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_action_activity_log (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  action_id       CHAR(36)      NOT NULL,
  actor_user_id   CHAR(36)      NULL,
  activity_type   VARCHAR(100)  NOT NULL,
  payload_json    JSON          NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_baal_action (action_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
