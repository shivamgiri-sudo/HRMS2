-- 1798_journal_entry_branch_cost_centre_process.sql
--
-- WHY
-- Owner directive (2026-09-17): "Branch name, cost center, process names are also missing
-- understand it should have depth information" — the Ledger Reports page (Trial Balance,
-- Vendor Ledger, Head/Subhead Spend, built earlier today off journal_entry/journal_entry_line)
-- has no branch/cost-centre/process dimension at all. journal_entry currently carries only
-- entry_date/narration/source_type/source_id — a Trial Balance row or a drill-down entry
-- cannot be sliced or filtered by branch, cost centre, or process, even though the source
-- GRN this money was posted from always carries all three (grn_request.branch_id,
-- cost_centre_id, process_id — all CHAR(36), all already populated, confirmed live
-- 2026-09-17).
--
-- One column set per journal_entry (not per journal_entry_line): a GRN's approval posts
-- exactly one journal_entry with two lines (Dr Expense / Cr Vendor-or-Imprest) that share
-- the same branch/cost-centre/process context — duplicating the same three values onto both
-- lines would be redundant. Payment Voucher release() (wired today, commit 54d69a08) posts
-- its own journal_entry per voucher; a voucher can span multiple GRNs/cost-centres in
-- principle, but every voucher raised so far pays a single vendor from a single allocation,
-- so entry-level is still the right grain for what exists today — a future multi-cost-centre
-- voucher can leave these NULL rather than force a wrong single value.
--
-- Additive only: three nullable columns, no data touched on any existing row by the ALTER
-- itself. The UPDATE below backfills the 43,053 already-posted GRN-sourced entries from
-- their own source_id, so the Ledger Reports page shows depth on data that already exists —
-- it does not re-post or reverse anything.
--
-- information_schema-guarded PREPARE/EXECUTE rather than ADD COLUMN IF NOT EXISTS — that is
-- MariaDB syntax and this production MySQL 8 rejects it (same trap documented in
-- 1760_exit_absconding_since.sql and 1784_leave_approval_overdue_reminder.sql).

SET @has_branch_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_entry' AND COLUMN_NAME = 'branch_id'
);
SET @sql = IF(@has_branch_id = 0,
  "ALTER TABLE journal_entry ADD COLUMN branch_id CHAR(36) NULL COMMENT 'Denormalized from the source record (e.g. grn_request.branch_id) at post time — depth dimension for Ledger Reports, not a join key'",
  "SELECT 'journal_entry.branch_id already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_cost_centre_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_entry' AND COLUMN_NAME = 'cost_centre_id'
);
SET @sql = IF(@has_cost_centre_id = 0,
  "ALTER TABLE journal_entry ADD COLUMN cost_centre_id CHAR(36) NULL COMMENT 'Denormalized from the source record (e.g. grn_request.cost_centre_id) at post time'",
  "SELECT 'journal_entry.cost_centre_id already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_process_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_entry' AND COLUMN_NAME = 'process_id'
);
SET @sql = IF(@has_process_id = 0,
  "ALTER TABLE journal_entry ADD COLUMN process_id CHAR(36) NULL COMMENT 'Denormalized from the source record (e.g. grn_request.process_id) at post time'",
  "SELECT 'journal_entry.process_id already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Indexes so the reports page can filter/group by any of the three without a full scan.
SET @has_branch_idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_entry' AND INDEX_NAME = 'idx_journal_entry_branch_id'
);
SET @sql = IF(@has_branch_idx = 0, "CREATE INDEX idx_journal_entry_branch_id ON journal_entry (branch_id)", "SELECT 'idx_journal_entry_branch_id already exists' AS note");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_cc_idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_entry' AND INDEX_NAME = 'idx_journal_entry_cost_centre_id'
);
SET @sql = IF(@has_cc_idx = 0, "CREATE INDEX idx_journal_entry_cost_centre_id ON journal_entry (cost_centre_id)", "SELECT 'idx_journal_entry_cost_centre_id already exists' AS note");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_process_idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_entry' AND INDEX_NAME = 'idx_journal_entry_process_id'
);
SET @sql = IF(@has_process_idx = 0, "CREATE INDEX idx_journal_entry_process_id ON journal_entry (process_id)", "SELECT 'idx_journal_entry_process_id already exists' AS note");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill every already-posted GRN-sourced entry (43,053 rows as of 2026-09-17) from its
-- own source GRN. Idempotent: only touches rows where branch_id is still NULL, so a re-run
-- after this migration is already applied finds nothing left to do.
UPDATE journal_entry je
  JOIN grn_request g ON g.id = je.source_id AND je.source_type = 'grn'
   SET je.branch_id = g.branch_id,
       je.cost_centre_id = g.cost_centre_id,
       je.process_id = g.process_id
 WHERE je.branch_id IS NULL;

-- Verification:
-- SHOW COLUMNS FROM journal_entry LIKE '%_id';
-- SELECT COUNT(*) AS still_null FROM journal_entry WHERE source_type='grn' AND branch_id IS NULL;
--   -- expect 0 (every GRN row has branch_id on grn_request itself)
