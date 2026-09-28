-- Persist the "proposed CTC exception" the Employment Offer form's Proposed tab
-- already collects (is_proposed_exception / proposed_reason) but which saveOffer()
-- silently dropped -- neither field was ever written to ats_employment_offer, so
-- an out-of-band CTC bypass left no record of why it was approved, and an approver
-- looking at the queue had no way to see the reason.
--
-- Additive: two nullable/defaulted columns, no existing row read or written.
--
-- IDEMPOTENCY NOTE. MySQL 8 (this is not MariaDB) has no `ADD COLUMN IF NOT
-- EXISTS`. Mirrors the scoped, self-contained stored-procedure pattern from
-- 1699_salary_prep_line_manual_override_lock.sql (itself following
-- 600_cost_centre_extended_schema.sql) rather than a persistent shared helper,
-- since a procedure dropped at the end of its own migration cannot be CALLed
-- by a later file.

DELIMITER //
DROP PROCEDURE IF EXISTS add_column_if_not_exists_1702 //
CREATE PROCEDURE add_column_if_not_exists_1702(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT
)
BEGIN
  SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = p_table AND column_name = p_column
  );
  IF @col_exists = 0 THEN
    SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_column, ' ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL add_column_if_not_exists_1702('ats_employment_offer', 'is_proposed_exception',
  'TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1 when HR raised this offer via the Proposed CTC tab, bypassing the band range check in saveOffer() -- requires proposed_exception_reason to be set.''');

CALL add_column_if_not_exists_1702('ats_employment_offer', 'proposed_exception_reason',
  'VARCHAR(500) NULL COMMENT ''Why the CTC falls outside the selected band''''s salary_band_master range. Shown to Branch Head / Payroll Head approvers alongside the offer.''');

DROP PROCEDURE IF EXISTS add_column_if_not_exists_1702;
