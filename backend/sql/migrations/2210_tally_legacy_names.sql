-- Tally names the legacy billing system used, carried into HRMS (2026-10-14).
-- ADDITIVE ONLY, guarded. Accounts import HRMS Tally files into the SAME Tally company db_bill fed, so cost
-- categories, cost-centre codes and expense ledgers must use the names that company already has.
--   * branch_master.tally_cost_category / tally_cost_centre_code: db_bill branch_master.tally_branch / tally_code
--     (e.g. NOIDA-DIALDESK -> NOIDAD, AHMEDABAD-JALDARSHAN -> "Ahmedabad-Jaldarshan" / AHM-JD).
--   * finance_expense_sub_head_master.tally_ledger_name: the legacy ledger where HRMS words a sub-head
--     differently ("Computer software cost 26-27" -> "Computer Software Cost 2026 - 27").
-- NULL everywhere: exports fall back to the HRMS name. Filled by scripts/backfill-tally-legacy-names.ts.
-- Rollback: ALTER TABLE branch_master DROP COLUMN tally_cost_category, DROP COLUMN tally_cost_centre_code;
--           ALTER TABLE finance_expense_sub_head_master DROP COLUMN tally_ledger_name;

SET @a = (SELECT IF(COUNT(*) = 0, "ALTER TABLE branch_master ADD COLUMN tally_cost_category VARCHAR(200) NULL COMMENT 'Tally cost category (legacy db_bill tally_branch)'", 'SELECT 1')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branch_master' AND COLUMN_NAME = 'tally_cost_category');
PREPARE _s FROM @a; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @b = (SELECT IF(COUNT(*) = 0, "ALTER TABLE branch_master ADD COLUMN tally_cost_centre_code VARCHAR(60) NULL COMMENT 'Tally cost-centre prefix (legacy db_bill tally_code), centre = <code>/<YYMM>'", 'SELECT 1')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branch_master' AND COLUMN_NAME = 'tally_cost_centre_code');
PREPARE _s FROM @b; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c = (SELECT IF(COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_expense_sub_head_master') = 1,
    "ALTER TABLE finance_expense_sub_head_master ADD COLUMN tally_ledger_name VARCHAR(255) NULL COMMENT 'Exact Tally expense ledger when it differs from sub_head_name'", 'SELECT 1')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_expense_sub_head_master' AND COLUMN_NAME = 'tally_ledger_name');
PREPARE _s FROM @c; EXECUTE _s; DEALLOCATE PREPARE _s;

SELECT '2210_tally_legacy_names.sql applied' AS migration_status;
