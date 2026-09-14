-- 1648_apr_eligibility_attendance_logic.sql
--
-- Adds the third attendance logic — "APR validated by COSEC" — to apr_eligibility_config,
-- and makes the table able to state "this scope is COSEC" rather than only implying it by
-- the absence of a row.
--
-- WHY THIS COLUMN AND NOT A NEW TABLE
--   apr_eligibility_config is already the table attendanceEngineService.isAprEligible()
--   reads to decide dialler vs biometric. It has always been an allow-list: a matching
--   active row means APR, no row means COSEC biometric. That encodes two of the three
--   logics the business actually uses and cannot express the third at all.
--
--   attendance_rule_config was the other candidate and is the wrong one: the engine
--   overwrites rule.attendance_source, full_day_minutes and half_day_minutes in BOTH
--   branches of processDay(), so nothing stored in that table's source column reaches a
--   day's classification. A column added there would never be read.
--
-- BACKWARD COMPATIBLE BY CONSTRUCTION
--   DEFAULT 'apr' means every existing row keeps exactly the meaning it has today, and
--   isAprEligible()'s behaviour is unchanged until someone sets a row to another value.
--   'cosec' is new expressive power: a row can now say "explicitly biometric" and be
--   distinguished from a scope nobody ever configured — the engine excludes those rows
--   from APR matching.
--
-- Purely additive: one ADD COLUMN, no DROP, no DELETE, no FOREIGN KEY.
-- Guarded with INFORMATION_SCHEMA + PREPARE/EXECUTE rather than ADD COLUMN IF NOT EXISTS,
-- which this project's MySQL 8 rejects at parse time while the runner still records the
-- file as applied (see 1643_dual_review_queue.sql's note).

DROP PROCEDURE IF EXISTS _m1648_add_col;
DELIMITER //
CREATE PROCEDURE _m1648_add_col(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL _m1648_add_col(
  'apr_eligibility_config',
  'attendance_logic',
  "ENUM('apr','cosec','apr_validated_by_cosec') NOT NULL DEFAULT 'apr' "
  "COMMENT 'How this scope''s attendance is decided. apr = dialler net login alone. "
  "cosec = biometric alone (row is excluded from APR matching). "
  "apr_validated_by_cosec = APR first, and when APR falls short of a full day the biometric "
  "reading is compared and the better of the two is used.'");

-- Index the column alongside active_status: every engine read filters on both.
DROP PROCEDURE IF EXISTS _m1648_add_idx;
DELIMITER //
CREATE PROCEDURE _m1648_add_idx()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr_eligibility_config'
       AND INDEX_NAME = 'idx_apr_elig_active_logic'
  ) THEN
    ALTER TABLE apr_eligibility_config
      ADD INDEX idx_apr_elig_active_logic (active_status, attendance_logic);
  END IF;
END //
DELIMITER ;

CALL _m1648_add_idx();

DROP PROCEDURE IF EXISTS _m1648_add_col;
DROP PROCEDURE IF EXISTS _m1648_add_idx;
