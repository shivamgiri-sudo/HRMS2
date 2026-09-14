-- 1714_payment_voucher_changes_requested.sql
--
-- Payment Voucher redesign, 2026-09-10. Adds a third CEO decision path alongside
-- approve/reject: "Request Changes" — the CEO sends the voucher back to whoever raised it
-- (e.g. "use the HDFC account instead") rather than either approving it as-is or killing it
-- outright with reject. changes_requested_note carries that instruction; Finance Head edits
-- and resubmits via payment-voucher.service.ts's resubmit(), which moves the voucher back to
-- 'raised' for a fresh CEO decision. Guarded PREPARE/EXECUTE per this repo's ALTER convention
-- — MySQL 8 has no ADD COLUMN IF NOT EXISTS, and a bare MODIFY on the ENUM would fail loudly
-- were this migration ever replayed after the column already carries the new value.
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_voucher'
     AND COLUMN_NAME = 'changes_requested_note'
);
SET @sql := IF(@has_col = 0,
  'ALTER TABLE payment_voucher
     MODIFY COLUMN status ENUM(''draft'',''raised'',''ceo_approved'',''rejected'',''released'',''changes_requested'') NOT NULL DEFAULT ''draft'',
     ADD COLUMN changes_requested_by CHAR(36) NULL AFTER rejection_reason,
     ADD COLUMN changes_requested_at DATETIME NULL AFTER changes_requested_by,
     ADD COLUMN changes_requested_note TEXT NULL AFTER changes_requested_at',
  'SELECT ''1714 columns already exist'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '1714_payment_voucher_changes_requested.sql applied' AS migration_status;
