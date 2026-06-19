-- Business Action Queue foundation
-- Safe migration: additive only, no destructive changes.

CREATE TABLE IF NOT EXISTS business_action_queue (
  id CHAR(36) NOT NULL PRIMARY KEY,
  source_module VARCHAR(64) NOT NULL DEFAULT 'manual',
  source_id VARCHAR(128) NULL,
  risk_type VARCHAR(80) NOT NULL,
  severity ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  owner_user_id CHAR(36) NULL,
  owner_role VARCHAR(80) NULL,
  due_date DATE NULL,
  status ENUM('open','in_progress','blocked','escalated','completed','cancelled','overdue') NOT NULL DEFAULT 'open',
  escalation_level INT NOT NULL DEFAULT 0,
  closure_note TEXT NULL,
  completed_at DATETIME NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_baq_source (source_module, source_id),
  INDEX idx_baq_risk (risk_type),
  INDEX idx_baq_severity (severity),
  INDEX idx_baq_status (status),
  INDEX idx_baq_owner_user (owner_user_id),
  INDEX idx_baq_owner_role (owner_role),
  INDEX idx_baq_due_date (due_date),
  INDEX idx_baq_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_action_comment (
  id CHAR(36) NOT NULL PRIMARY KEY,
  action_id CHAR(36) NOT NULL,
  author_user_id CHAR(36) NOT NULL,
  comment_text TEXT NOT NULL,
  is_internal TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bac_action (action_id),
  INDEX idx_bac_author (author_user_id),
  CONSTRAINT fk_bac_action FOREIGN KEY (action_id) REFERENCES business_action_queue(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_action_activity_log (
  id CHAR(36) NOT NULL PRIMARY KEY,
  action_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  activity_type VARCHAR(80) NOT NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_baal_action (action_id),
  INDEX idx_baal_actor (actor_user_id),
  INDEX idx_baal_type (activity_type),
  CONSTRAINT fk_baal_action FOREIGN KEY (action_id) REFERENCES business_action_queue(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
