-- Migration 521: Create security_audit_event table as a proper migration.
-- Previously this table was created at runtime inside security-center.routes.ts.
-- Moving it here guarantees the table exists when auth.service.ts begins writing
-- login events (from migration 520+ backend changes).
-- Safe to re-run (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS security_audit_event (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_type          VARCHAR(80) NOT NULL,
  severity            ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'info',
  module_key          VARCHAR(80) NULL,
  entity_type         VARCHAR(80) NULL,
  entity_id           VARCHAR(80) NULL,
  actor_user_id       VARCHAR(80) NULL,
  actor_employee_id   VARCHAR(80) NULL,
  actor_role          VARCHAR(120) NULL,
  target_employee_id  VARCHAR(80) NULL,
  title               VARCHAR(255) NOT NULL,
  description         TEXT NULL,
  old_value           TEXT NULL,
  new_value           TEXT NULL,
  reason              TEXT NULL,
  ip_address          VARCHAR(80) NULL,
  user_agent          VARCHAR(500) NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_security_event_type  (event_type),
  INDEX idx_security_severity    (severity),
  INDEX idx_security_module      (module_key),
  INDEX idx_security_created_at  (created_at),
  INDEX idx_security_actor       (actor_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (filename, applied_at)
VALUES ('521_security_audit_event_table.sql', NOW());
