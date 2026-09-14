-- 1511_grn_legacy_identity_columns.sql
--
-- WHY
-- ---
-- migrate-grn-from-dbbill.ts (84,767 legacy grn_request rows) never populated created_by /
-- reviewed_by / branch_head_reviewed_by / finance_head_reviewed_by beyond a single migration
-- sentinel user (00000000-0000-0000-0000-dbbill000001) — those columns are UUID foreign keys
-- into employees/auth_user, and there is no such account for any of db_bill's ~60 legacy
-- approvers/raisers, so a real link cannot be made without fabricating employee records HRMS
-- does not actually have. The GRN History and Approval Queue therefore show "who raised /
-- approved / rejected this" as blank for every legacy row.
--
-- db_bill.expense_entry_master DOES carry this identity (userid = raiser, ApprovedBy = the
-- single flat approver — approved_by_ph/approved_by_fh are verified NEVER populated across the
-- full 22,585-row vendor history, so db_bill's real workflow only ever had one approval stage,
-- not a Branch Head / Finance Head split — RejectBy = who rejected). All three resolve through
-- db_bill.user_master.UserId -> DisplayName, a small set (~60 distinct people total).
--
-- RejectRemarks is verified NEVER populated (0 of 2,107 rejected vendor rows) across the full
-- history — the legacy system captured WHO rejected and WHEN, never WHY. rejection_reason is
-- backfilled from RejectRemarks anyway (future-proof if any non-empty value exists), but for
-- these rows it will stay NULL; the UI should show the name/date without inventing a reason.
--
-- Three new nullable text columns rather than real employee/auth_user rows or reusing the FK
-- columns: this is a label for legacy display only, not an identity the rest of the system
-- (permissions, audit trails, notifications) should treat as a real account.
--
-- SAFE TO APPLY: additive only, three nullable VARCHAR columns on an existing table. No existing
-- column, row or query touched. information_schema-guarded PREPARE/EXECUTE (matching 1304) since
-- MySQL 8 does not support ADD COLUMN IF NOT EXISTS as a single clause. Idempotent; safe to re-run.

SET @add_raised_by = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE grn_request ADD COLUMN legacy_raised_by_name VARCHAR(150) NULL AFTER created_by',
    'SELECT 1 -- grn_request.legacy_raised_by_name already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request' AND COLUMN_NAME = 'legacy_raised_by_name'
);
PREPARE _stmt FROM @add_raised_by;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- One flat "approved by" label, not split into branch-head/finance-head equivalents: db_bill's
-- own workflow never had that split (see note above), so labelling it as one or the other would
-- claim precision the source data does not have.
SET @add_approved_by = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE grn_request ADD COLUMN legacy_approved_by_name VARCHAR(150) NULL AFTER legacy_raised_by_name',
    'SELECT 1 -- grn_request.legacy_approved_by_name already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request' AND COLUMN_NAME = 'legacy_approved_by_name'
);
PREPARE _stmt FROM @add_approved_by;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_rejected_by = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE grn_request ADD COLUMN legacy_rejected_by_name VARCHAR(150) NULL AFTER legacy_approved_by_name',
    'SELECT 1 -- grn_request.legacy_rejected_by_name already exists'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request' AND COLUMN_NAME = 'legacy_rejected_by_name'
);
PREPARE _stmt FROM @add_rejected_by;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
