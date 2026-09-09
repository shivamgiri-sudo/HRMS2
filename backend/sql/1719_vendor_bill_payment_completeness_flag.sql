-- ============================================================
-- Migration 1719: payment_completeness flag on vendor_bill_payment_snapshot
--
-- 1718 mirrors db_bill.bill_pay_particulars verbatim. On ~12% of rows
-- (1,293 of 11,124), bill_amount - tds_deducted - deduction != net_amount
-- because db_bill itself records partial/staged payments against the
-- same bill across multiple rows -- not an arithmetic error, but easy to
-- mistake for one when reading the mirror cold.
--
-- Adds a derived, self-explanatory flag rather than "fixing" the numbers.
-- Additive only.
-- ============================================================

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vendor_bill_payment_snapshot' AND COLUMN_NAME='payment_completeness');
SET @q = IF(@s=0,
  'ALTER TABLE vendor_bill_payment_snapshot ADD COLUMN payment_completeness ENUM(''full'',''partial'',''over'',''unknown'') NULL COMMENT "full: net_amount = bill_amount - tds_deducted - deduction (within Re.1). partial: net paid is less than that. over: net paid is more. unknown: bill_amount is 0/blank at source." AFTER net_amount',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vendor_bill_payment_snapshot' AND INDEX_NAME='idx_bp_completeness');
SET @q = IF(@s=0,
  'CREATE INDEX idx_bp_completeness ON vendor_bill_payment_snapshot (payment_completeness)',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
