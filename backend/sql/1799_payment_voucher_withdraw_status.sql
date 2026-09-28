-- 1799_payment_voucher_withdraw_status.sql
--
-- WHY
-- Owner directive (2026-09-17 CEO/CA compliance review, "no issues at all fully compliant"):
-- a payment voucher had no self-service cancellation path at all. The raiser could not withdraw
-- their own mistake before the CEO acted on it (only the CEO could kill it, via reject) — and an
-- approved-but-not-yet-released voucher had no stop mechanism whatsoever; the only thing
-- preventing release was whoever holds Finance Head access simply not clicking the button.
--
-- Adds a genuinely new terminal status, 'withdrawn', distinct from 'rejected' — different party,
-- different meaning. A raiser withdrawing their own request before anyone acted on it is not the
-- same event as a CEO rejecting it after review; collapsing the two into one status would make
-- the audit trail lie about who actually stopped the payment.
--
-- Two cases share this one status:
--   1. Raiser withdraws their own voucher while status='raised' (before CEO decides).
--   2. Finance Head or CEO recalls an approved-but-unreleased voucher while status='ceo_approved'
--      (before money moves) — same actors who can release it, since recalling is strictly less
--      than releasing.
-- Neither case is in ACTIVE_VOUCHER_STATUSES (payment-voucher.service.ts's route guard,
-- paymentVoucherStatus.ts's frontend mirror, vendor-payment.service.ts's own copy) — a withdrawn
-- voucher is dead, exactly like a rejected one, and must not block a fresh voucher being raised
-- against the same GRN/imprest manager/vendor.
--
-- withdrawn_by/withdrawn_at/withdrawal_reason mirror the shape every other terminal-state column
-- set on this table already uses (ceo_approved_by/at, released_by/at) — a reason is mandatory at
-- the application layer, matching reopen()'s own "a reason is required" discipline in
-- bank-reconciliation-period.service.ts.

-- MySQL ENUM MODIFY has no "ADD VALUE IF NOT EXISTS" (unlike Postgres) — guard on the current
-- COLUMN_TYPE text instead, same principle as the INFORMATION_SCHEMA.COLUMNS guards used
-- elsewhere in this manifest, just checking a substring of the type definition rather than a
-- column's existence.
SET @already_has_value = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'status'
     AND COLUMN_TYPE LIKE '%''withdrawn''%'
);
SET @sql = IF(@already_has_value = 0,
  "ALTER TABLE payment_voucher MODIFY COLUMN status ENUM('draft','raised','ceo_approved','rejected','released','changes_requested','withdrawn') NOT NULL DEFAULT 'draft'",
  "SELECT 'payment_voucher.status already has withdrawn' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_withdrawn_by = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'withdrawn_by'
);
SET @sql = IF(@has_withdrawn_by = 0,
  "ALTER TABLE payment_voucher ADD COLUMN withdrawn_by CHAR(36) NULL",
  "SELECT 'payment_voucher.withdrawn_by already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_withdrawn_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'withdrawn_at'
);
SET @sql = IF(@has_withdrawn_at = 0,
  "ALTER TABLE payment_voucher ADD COLUMN withdrawn_at DATETIME NULL",
  "SELECT 'payment_voucher.withdrawn_at already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_withdrawal_reason = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_voucher' AND COLUMN_NAME = 'withdrawal_reason'
);
SET @sql = IF(@has_withdrawal_reason = 0,
  "ALTER TABLE payment_voucher ADD COLUMN withdrawal_reason TEXT NULL",
  "SELECT 'payment_voucher.withdrawal_reason already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Verification:
-- SHOW COLUMNS FROM payment_voucher LIKE 'status';  -- expect enum to include 'withdrawn'
-- SHOW COLUMNS FROM payment_voucher LIKE 'withdrawn%';  -- expect 3 rows
