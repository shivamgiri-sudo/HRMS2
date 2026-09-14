-- Payment Voucher: post-release Accounts Head review (non-blocking sign-off).
--
-- Role model change (2026-09-10): Finance Head now both raises AND releases the payment
-- (previously accounts_head released). Accounts Head no longer gates release — instead it
-- reviews the already-released payment afterward as an audit/sign-off step. This does not
-- change payment_voucher.status (it stays 'released'); it just records who reviewed it, when,
-- and any note, so a released voucher can show "reviewed" vs "awaiting review" in the UI.

SET @db := DATABASE();

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'accounts_reviewed_by'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE payment_voucher ADD COLUMN accounts_reviewed_by CHAR(36) NULL AFTER released_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'accounts_reviewed_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE payment_voucher ADD COLUMN accounts_reviewed_at DATETIME NULL AFTER accounts_reviewed_by',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'review_note'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE payment_voucher ADD COLUMN review_note TEXT NULL AFTER accounts_reviewed_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
