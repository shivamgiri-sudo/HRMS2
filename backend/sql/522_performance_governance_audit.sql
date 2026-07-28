-- Migration 522: Durable governance audit for performance source administration
-- Additive only. No existing performance fact is changed.
USE mas_hrms;

CREATE TABLE IF NOT EXISTS performance_governance_audit (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id   CHAR(36)        NULL,
  action_code     VARCHAR(100)    NOT NULL,
  entity_type     VARCHAR(80)     NOT NULL,
  entity_id       VARCHAR(100)    NULL,
  dataset_id      CHAR(36)        NULL,
  before_json     JSON            NULL,
  after_json      JSON            NULL,
  metadata_json   JSON            NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_performance_audit_dataset (dataset_id, created_at),
  INDEX idx_performance_audit_actor (actor_user_id, created_at),
  INDEX idx_performance_audit_action (action_code, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- VERIFY AFTER STAGING EXECUTION:
-- SHOW TABLES LIKE 'performance_governance_audit';
