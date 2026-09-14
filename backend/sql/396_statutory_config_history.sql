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
SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tax_declaration_form12bb_detail' AND COLUMN_NAME = 'verified_by'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE tax_declaration_form12bb_detail ADD COLUMN verified_by   CHAR(36) NULL',
  'SELECT "verified_by already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tax_declaration_form12bb_detail' AND COLUMN_NAME = 'verified_at'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE tax_declaration_form12bb_detail ADD COLUMN verified_at   DATETIME NULL',
  'SELECT "verified_at already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tax_declaration_form12bb_detail' AND COLUMN_NAME = 'review_note'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE tax_declaration_form12bb_detail ADD COLUMN review_note   TEXT     NULL',
  'SELECT "review_note already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;
