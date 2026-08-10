-- 218_enterprise_foundation_helpers.sql
-- Phase 1 shared enterprise foundations: general audit log and optional client scope.
-- Safe additive migration only.

CREATE TABLE IF NOT EXISTS audit_action_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  actor_user_id   CHAR(36)     NULL,
  action_type     VARCHAR(100) NOT NULL,
  module_key      VARCHAR(100) NOT NULL,
  entity_type     VARCHAR(100) NULL,
  entity_id       CHAR(36) NULL,
  request_id      VARCHAR(100) NULL,
  ip_address      VARCHAR(45) NULL,
  user_agent      VARCHAR(512) NULL,
  metadata_json   JSON NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_actor (actor_user_id),
  INDEX idx_audit_action (action_type),
  INDEX idx_audit_entity (entity_type, entity_id),
  INDEX idx_audit_module_time (module_key, created_at),
  INDEX idx_audit_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log LIKE audit_action_log;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'user_assignment_scope'
       AND COLUMN_NAME = 'client_id') = 0,
  'ALTER TABLE user_assignment_scope ADD COLUMN client_id CHAR(36) NULL',
  'SELECT ''user_assignment_scope.client_id exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'user_assignment_scope'
       AND INDEX_NAME = 'idx_uas_client') = 0,
  'CREATE INDEX idx_uas_client ON user_assignment_scope (client_id)',
  'SELECT ''idx_uas_client exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'sensitive_action_log'
       AND COLUMN_NAME = 'request_id') = 0,
  'ALTER TABLE sensitive_action_log ADD COLUMN request_id VARCHAR(100) NULL',
  'SELECT ''sensitive_action_log.request_id exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'sensitive_action_log'
       AND INDEX_NAME = 'idx_sal_request') = 0,
  'CREATE INDEX idx_sal_request ON sensitive_action_log (request_id)',
  'SELECT ''idx_sal_request exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
