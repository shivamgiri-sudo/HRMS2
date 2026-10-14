-- Tally names the legacy billing system used, carried into HRMS (2026-10-14).
-- Accounts import HRMS Tally files into the SAME Tally company db_bill fed, so cost categories, cost-centre codes
-- and expense ledgers must use the names that company already has:
--   * branch:           tally_name = db_bill branch_master.tally_branch, tally_code = tally_code
--                       (e.g. NOIDA-DIALDESK -> NOIDAD, AHMEDABAD-JALDARSHAN -> "Ahmedabad-Jaldarshan" / AHM-JD).
--   * expense_sub_head: tally_name = the legacy ledger where HRMS words a sub-head differently
--                       ("Computer software cost 26-27" -> "Computer Software Cost 2026 - 27").
-- No row: exports use the HRMS name. Filled by scripts/backfill-tally-legacy-names.ts.
--
-- REWRITTEN 2026-10-14 before it ever applied. The first version ALTERed branch_master and
-- finance_expense_sub_head_master; long report reads hold metadata locks on branch_master, the ALTER hit
-- "Lock wait timeout exceeded" at boot, and every deploy that day rolled back (schema_migrations success=0,
-- so the new text runs instead). A side table needs no lock on any existing table.
-- Rollback: DROP TABLE tally_legacy_name;

CREATE TABLE IF NOT EXISTS tally_legacy_name (
  entity_type  VARCHAR(30)  NOT NULL COMMENT 'branch | expense_sub_head',
  entity_id    CHAR(36)     NOT NULL COMMENT 'branch_master.id / finance_expense_sub_head_master.id',
  tally_name   VARCHAR(255) NULL     COMMENT 'Tally cost category (branch) or expense ledger (sub-head)',
  tally_code   VARCHAR(60)  NULL     COMMENT 'Tally cost-centre prefix (branch); centre = <code>/<YYMM>',
  source       VARCHAR(255) NULL     COMMENT 'Where the name came from, e.g. db_bill branch_master #16',
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '2210_tally_legacy_names.sql applied' AS migration_status;
