-- ============================================================
-- Migration 1720: correct a misclassification from migration 1718
--
-- 1718 mirrored db_bill.tbl_payment / bill_pay_particulars / other_deductions_bill
-- and labelled them "vendor payment" tables. Verified live 2026-09-10 that this was
-- wrong: company_name on every one of these rows is 'Mas Callnet India Pvt Ltd' or
-- 'IDC' (MAS's OWN entities, never a vendor name), and 79% of bill_pay_particulars
-- rows' bill_no (reconstructed with its finance-year suffix) match a row in
-- billing_invoice_snapshot (db_bill.tbl_invoice, MAS's own CLIENT invoices) whose
-- bill_client is a real client — Vodafone Mobile Services, Idea Cellular, Aircel —
-- with the invoice's grand_total matching the payment row's bill_amount exactly on
-- sampled rows. These tables track money MAS RECEIVED FROM ITS CLIENTS against
-- MAS's own invoices (accounts receivable collection), not money MAS paid to
-- vendors (accounts payable) — the opposite side of the ledger from what the name
-- said. billing_client_ledger_snapshot and billing_opening_balance_snapshot,
-- created in the same 1718 migration, were already correctly named (their source
-- tables carry clientId directly) and are untouched here.
--
-- RENAME TABLE is an instant metadata operation — no data moved, no row touched,
-- every column/index/comment carried over as-is. Guarded (only rename if the old
-- name still exists and the new one does not) so a second run is a no-op rather
-- than an error, matching every other migration in this directory's idempotency
-- contract. Blast radius was small: these tables had exactly one consumer anywhere
-- in the codebase (the "vendor-payment-history" legacy report added the same day),
-- fixed in the same commit as this migration.
-- ============================================================

SET @old_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vendor_payment_run_snapshot');
SET @new_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_bill_collection_run_snapshot');
SET @q = IF(@old_exists=1 AND @new_exists=0,
  'RENAME TABLE vendor_payment_run_snapshot TO client_bill_collection_run_snapshot',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @old_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vendor_bill_payment_snapshot');
SET @new_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_bill_collection_snapshot');
SET @q = IF(@old_exists=1 AND @new_exists=0,
  'RENAME TABLE vendor_bill_payment_snapshot TO client_bill_collection_snapshot',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @old_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vendor_bill_deduction_snapshot');
SET @new_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_bill_collection_deduction_snapshot');
SET @q = IF(@old_exists=1 AND @new_exists=0,
  'RENAME TABLE vendor_bill_deduction_snapshot TO client_bill_collection_deduction_snapshot',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
