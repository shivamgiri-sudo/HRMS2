-- Add payment_reference and paid_at columns to reimbursement_claim
-- MySQL 8 does not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS,
-- so we check information_schema first via a prepared statement.

SET @add_payment_reference = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE reimbursement_claim ADD COLUMN payment_reference VARCHAR(255) NULL AFTER remarks',
    'SELECT 1 -- payment_reference already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME  = 'reimbursement_claim'
    AND COLUMN_NAME = 'payment_reference'
);
PREPARE _stmt FROM @add_payment_reference;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_paid_at = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE reimbursement_claim ADD COLUMN paid_at DATETIME NULL AFTER payment_reference',
    'SELECT 1 -- paid_at already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME  = 'reimbursement_claim'
    AND COLUMN_NAME = 'paid_at'
);
PREPARE _stmt FROM @add_paid_at;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
