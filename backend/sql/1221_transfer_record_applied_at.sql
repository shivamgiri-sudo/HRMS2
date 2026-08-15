-- Migration 1221: add the transfer_record.applied_at column the code has always written to
--
-- WHY
-- mobility.service.ts writes and reads applied_at in three places:
--   applyTransferToEmployee  -> UPDATE transfer_record SET applied_at = NOW() WHERE id = ?
--   applyPendingTransfers    -> WHERE ... AND applied_at IS NULL
-- The column does not exist. Verified live 2026-08-15, transfer_record columns are:
--   id, employee_id, transfer_type, from_value, to_value, effective_date, reason,
--   approved_by, status, initiated_by, created_at, updated_at
--
-- So every one of those statements raises ER_BAD_FIELD_ERROR. This is not dead code — the
-- immediate path is live and routed: createTransfer applies the transfer straight away
-- whenever effective_date <= today (the common case), and that call ends in the failing
-- UPDATE. transfer_record holds 0 rows in production, which is consistent with the feature
-- never having completed successfully even once.
--
-- Worse than a plain failure: applyTransferToEmployee updates the EMPLOYEE row first
-- (branch_id / process_id / reporting_manager_id) and only then stamps applied_at. The throw
-- therefore lands after the employee has already been moved, so a transfer can half-apply —
-- employee reassigned, transfer_record never marked, and the deferred sweep would re-apply it
-- if it could run.
--
-- WHAT THIS DOES
-- Adds applied_at DATETIME NULL and nothing else. Nullable, so every existing row is valid
-- as-is (there are none). No data is written and no behaviour changes on apply beyond the
-- statements above ceasing to throw.
--
-- NOTE ON THE DEFERRED JOB: applyPendingTransfers() carries a comment claiming it is "called
-- by a nightly scheduled job". No such job exists — it is registered in neither server.ts nor
-- all-workers.ts, and nothing in the repo calls it. This migration deliberately does NOT wire
-- one up: scheduling an unexercised money-adjacent sweep is a separate decision. The
-- misleading comment is corrected in the same change as this migration so nobody wires it up
-- believing it already runs.
--
-- Guarded through information_schema + PREPARE rather than ADD COLUMN IF NOT EXISTS, which
-- MySQL 8.0.42 rejects with ER_PARSE_ERROR. Idempotent — re-running is a no-op.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'transfer_record'
     AND COLUMN_NAME = 'applied_at'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE transfer_record ADD COLUMN applied_at DATETIME NULL',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
