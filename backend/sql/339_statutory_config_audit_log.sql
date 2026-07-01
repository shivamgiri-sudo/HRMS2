-- Migration 339: Create statutory_config_audit_log table
-- Tracks every change made to statutory_config by super_admin users.
-- Used by the Statutory Configuration UI change-history view.

USE mas_hrms;

CREATE TABLE IF NOT EXISTS statutory_config_audit_log (
  id             CHAR(36)       NOT NULL DEFAULT (UUID()),
  config_key     VARCHAR(100)   NOT NULL,
  old_value      DECIMAL(18,4)  NULL,
  new_value      DECIMAL(18,4)  NOT NULL,
  effective_from DATE           NULL,
  changed_by     CHAR(36)       NOT NULL,  -- user_id
  changed_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason         VARCHAR(500)   NULL,
  PRIMARY KEY (id),
  INDEX idx_key        (config_key),
  INDEX idx_changed_at (changed_at),
  INDEX idx_changed_by (changed_by)
);
