-- Root-cause fix for the 2026-09-08 db_bill reconciliation override reverting silently.
--
-- WHY THIS EXISTS. force-match-dbbill-net.mts / force-match-dbbill-components.mts patch
-- salary_prep_line directly, outside payrollCalculate.service.ts. The engine has no knowledge of
-- that override and, on any future recalculation of an overridden employee (a new
-- regularization, a manual re-run, anything calling calculatePayrollRunScoped for them),
-- silently discards it and replaces every column with its own formula-derived figures. This
-- already happened once in production the same day (MAS63361), caught by a manual re-check and
-- re-applied by hand -- not something that scales to being noticed every time.
--
-- This column lets the engine recognise a locked row and skip recomputing it, the same way it
-- already skips a G11-blocked employee or one whose salary_start_date is still in the future --
-- see payrollCalculate.service.ts's per-employee loop. It does not change what any UNLOCKED
-- employee is paid, and it does not alter any calculation formula: it only adds a bypass on the
-- write path for rows explicitly marked.
--
-- Additive: four nullable/defaulted columns, no existing row read or written by this migration.
--
-- IDEMPOTENCY NOTE. Plain MySQL 8 (this is not MariaDB) does not support
-- `ADD COLUMN IF NOT EXISTS` -- an earlier draft of this file used it and failed with a syntax
-- error on every attempt. A prior migration in this codebase (600_cost_centre_extended_schema.sql)
-- solved the same problem with a scoped, self-contained stored procedure; mirrored here rather
-- than reusing that one, since procedures created with DROP PROCEDURE at the end of their own
-- migration do not persist for a later file to CALL.

DELIMITER //
DROP PROCEDURE IF EXISTS add_column_if_not_exists_1699 //
CREATE PROCEDURE add_column_if_not_exists_1699(
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

CALL add_column_if_not_exists_1699('salary_prep_line', 'manual_override_locked',
  'TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''When 1, payrollCalculate.service.ts skips this row entirely on recalculation -- used for rows patched directly outside the engine so a later recalc cannot silently discard the override.''');

CALL add_column_if_not_exists_1699('salary_prep_line', 'manual_override_reason',
  'VARCHAR(255) NULL COMMENT ''Why this row is locked. Human-readable, arrears_note carries the full audit trail.''');

CALL add_column_if_not_exists_1699('salary_prep_line', 'manual_override_locked_at', 'DATETIME NULL');

CALL add_column_if_not_exists_1699('salary_prep_line', 'manual_override_locked_by', 'CHAR(36) NULL');

DROP PROCEDURE IF EXISTS add_column_if_not_exists_1699;

-- Kill switch, matching the payroll_head_review_gate_enabled pattern already established in
-- payrollCalculate.service.ts: absence of a row means the guard is ON by default, so this insert
-- is documentation, not activation -- but present for symmetry and so an operator can find the
-- flag without reading code.
INSERT IGNORE INTO payroll_config_flags (branch_id, process_id, config_key, config_value)
VALUES (NULL, NULL, 'dbbill_manual_override_lock_enabled', 'true');
