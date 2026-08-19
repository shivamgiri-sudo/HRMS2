-- 1308_client_billing_tally_fields.sql
--
-- Client Billing — adds tally_head / client_tally_name to client_invoice and
-- client_credit_note. Closes a real gap found while investigating "the Tally
-- part": legacy db_bill.tbl_invoice froze cost_TallyHead (the Tally ledger
-- head this invoice's revenue posts against) and cost_client_tally_name (the
-- name Tally shows for the client) as a per-invoice SNAPSHOT at creation
-- time — populated on 5,483/10,797 (50.8%) and 7,240/10,797 (67%) of live
-- legacy invoices respectively, a real, actively-used accountant-facing
-- reference field, not a rarely-touched column. No automated Tally export
-- exists anywhere in db_bill's schema (grepped every table for a "tally"
-- column) — this is purely reference data for manual entry into Tally, and
-- stays that way here; no export/XML generation is in scope.
--
-- client_invoice/client_credit_note had no equivalent column at all, and the
-- historical cutover (10,727 invoices loaded 2026-08-19) never carried the
-- legacy value forward even though it was already captured verbatim in
-- client_invoice_migration_staging.src_cost_tallyhead /
-- src_cost_client_tally_name (part of the original 106-column extraction,
-- migration 1304/1305) — this migration only adds the columns; a separate
-- one-off UPDATE (not a migration, since it targets specific already-loaded
-- rows rather than schema) backfills them from that existing staging data.
--
-- client_credit_note gets the same two columns for schema consistency and
-- forward use, but is NOT backfilled from legacy — tbl_credit_note never had
-- a TallyHead/client_tally_name column at all (confirmed: absent from its
-- full 39-column list), so there is nothing to backfill; new credit notes
-- created going forward resolve it from cost_centre_master.tally_head/
-- billing_client_name live at creation time (client-billing-credit-note.service.ts).
--
-- information_schema-guarded PREPARE/EXECUTE idiom, matching every prior
-- migration in this module (431/1241/1242/1304/1305/1306). Two nullable
-- VARCHAR(255) columns on tables holding real data (client_invoice=10,727
-- rows, client_credit_note=139 rows as of this commit) — a nullable ADD
-- COLUMN with no default has zero backfill cost regardless of row count.
--
-- Rollback:
--   ALTER TABLE client_credit_note DROP COLUMN client_tally_name, DROP COLUMN tally_head;
--   ALTER TABLE client_invoice DROP COLUMN client_tally_name, DROP COLUMN tally_head;

SET @add_ci_tally_head = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD COLUMN tally_head VARCHAR(255) NULL AFTER legacy_id',
    'SELECT 1 -- client_invoice.tally_head already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'tally_head'
);
PREPARE _stmt FROM @add_ci_tally_head;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_ci_client_tally_name = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_invoice ADD COLUMN client_tally_name VARCHAR(255) NULL AFTER tally_head',
    'SELECT 1 -- client_invoice.client_tally_name already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'client_tally_name'
);
PREPARE _stmt FROM @add_ci_client_tally_name;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_ccn_tally_head = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_credit_note ADD COLUMN tally_head VARCHAR(255) NULL AFTER legacy_id',
    'SELECT 1 -- client_credit_note.tally_head already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_credit_note' AND COLUMN_NAME = 'tally_head'
);
PREPARE _stmt FROM @add_ccn_tally_head;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_ccn_client_tally_name = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE client_credit_note ADD COLUMN client_tally_name VARCHAR(255) NULL AFTER tally_head',
    'SELECT 1 -- client_credit_note.client_tally_name already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_credit_note' AND COLUMN_NAME = 'client_tally_name'
);
PREPARE _stmt FROM @add_ccn_client_tally_name;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
