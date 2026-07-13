-- Migration 396: statutory_config_history for audit trail of config changes
CREATE TABLE IF NOT EXISTS statutory_config_history (
  id           CHAR(36)     NOT NULL,
  config_key   VARCHAR(100) NOT NULL,
  old_value    VARCHAR(500) NULL,
  new_value    VARCHAR(500) NOT NULL,
  reason       TEXT         NULL,
  changed_by   CHAR(36)     NULL,
  changed_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_sch_key (config_key),
  INDEX idx_sch_changed_at (changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add verified_by, verified_at, review_note to form12bb detail if not exists
ALTER TABLE tax_declaration_form12bb_detail
  ADD COLUMN IF NOT EXISTS verified_by   CHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS verified_at   DATETIME NULL,
  ADD COLUMN IF NOT EXISTS review_note   TEXT     NULL;
