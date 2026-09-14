-- 420_grn_validation_schema_hardening.sql
-- Ensures persistent validation overrides work on fresh and already-upgraded databases.

DELIMITER $$

DROP PROCEDURE IF EXISTS ensure_grn_validation_override_columns$$
CREATE PROCEDURE ensure_grn_validation_override_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'grn_validation_result'
       AND COLUMN_NAME = 'overridden_by'
  ) THEN
    ALTER TABLE grn_validation_result
      ADD COLUMN overridden_by CHAR(36) NULL AFTER message;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'grn_validation_result'
       AND COLUMN_NAME = 'override_reason'
  ) THEN
    ALTER TABLE grn_validation_result
      ADD COLUMN override_reason TEXT NULL AFTER overridden_by;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'grn_validation_result'
       AND COLUMN_NAME = 'overridden_at'
  ) THEN
    ALTER TABLE grn_validation_result
      ADD COLUMN overridden_at DATETIME NULL AFTER override_reason;
  END IF;
END$$

CALL ensure_grn_validation_override_columns()$$
DROP PROCEDURE IF EXISTS ensure_grn_validation_override_columns$$

DELIMITER ;

-- MODIFY preserves all existing values while guaranteeing the new state is legal.
ALTER TABLE grn_validation_result
  MODIFY COLUMN validation_status
    ENUM('passed','warning','failed','overridden') NOT NULL;
