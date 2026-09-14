-- 1085_grn_billing_cycle_and_accounting_period.sql
-- Three additive columns on grn_request for the I-Spark parity work.
--
-- billing_cycle_status is a BUSINESS attribute, deliberately NOT part of the workflow
-- `status` enum. `status` already carries twelve values (draft … consumption_reversed)
-- describing where a GRN sits in the approval/payment chain; OPEN/CLOSED describes
-- something orthogonal — whether another invoice is still expected against the same
-- service cycle (monthly computer rental: OPEN; one-off purchase: CLOSED). Overloading
-- `status` would have made "is this paid" and "is this cycle finished" the same question,
-- which they are not. Both are surfaced separately in the UI for the same reason.
--
-- Three values, not the two the requirement named. The legacy system db_bill carries the
-- same concept on expense_entry_master.EntryStatus, and it uses three:
--   Open 78,068 · Booked 7,279 · Close 154
-- BOOKED is the Tally-posted state — it pairs with that table's book_by / book_date columns.
-- Including it now costs nothing; discovering it later means an ALTER … MODIFY COLUMN on a
-- live grn_request, which is a full table rebuild, and any migration of the 7,279 Booked
-- rows would otherwise have to collapse them into OPEN or CLOSED and lose the distinction.
--
-- accounting_period (YYYY-MM) is the FY month the GRN books into, and is the source of
-- MM/YY in the new MAS/MM/YY/SERIAL number. It is deliberately NOT derived from bill_date:
-- a vendor-dated invoice entered in a later month must not mint a number in a month whose
-- sequence has already moved on, and must not silently move cost into a closed period.
-- Every read path must fall back to DATE_FORMAT(bill_date,'%Y-%m') when this is NULL.
--
-- is_multi_month flags an invoice whose expense is recognised across several periods.
-- The period split itself lives in grn_cost_allocation.recognition_period (migration 418),
-- which vw_process_pnl_grn_allocation already groups by — no new allocation table is
-- needed, and one invoice still produces exactly one vendor_payment_tracking row.
--
-- Additive only, safe to rerun. Every existing row gets billing_cycle_status = NULL and
-- accounting_period = NULL. NULL means "not classified" and must never be rendered as an
-- error or back-filled with a guessed accounting meaning.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_request'
      AND column_name = 'billing_cycle_status') = 0,
  'ALTER TABLE grn_request ADD COLUMN billing_cycle_status ENUM(''OPEN'',''BOOKED'',''CLOSED'') NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_request'
      AND column_name = 'accounting_period') = 0,
  'ALTER TABLE grn_request ADD COLUMN accounting_period CHAR(7) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_request'
      AND column_name = 'is_multi_month') = 0,
  'ALTER TABLE grn_request ADD COLUMN is_multi_month TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Serves the GRN Search workspace's branch + period filter, and the new sequence
-- service's "what did this branch already book this month" lookups.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_request'
      AND index_name = 'idx_grn_branch_accounting_period') = 0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_branch_accounting_period (branch_id, accounting_period)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_request'
      AND index_name = 'idx_grn_billing_cycle_status') = 0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_billing_cycle_status (billing_cycle_status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1085_grn_billing_cycle_and_accounting_period.sql applied' AS migration_status;
