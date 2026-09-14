-- Restore 'pending' to ats_branch_head_approval.approval_status.
--
-- Two migrations create this table with CREATE TABLE IF NOT EXISTS and disagree
-- on the column:
--
--   138_ats_complete_journey.sql:207
--     ENUM('pending','approved','rejected','sent_back') DEFAULT 'pending'
--   141_branch_head_approval.sql:23
--     ENUM('approved','rejected') NOT NULL
--
-- Production ended up with the 141 shape, so 'pending' cannot be stored. Every
-- code path that raises a request to a branch head writes 'pending':
-- payroll-hr.service.ts:435 and :575. sql_mode is STRICT on this server, so
-- those INSERTs throw rather than coercing.
--
-- The damage is wider than a failed insert. In payroll-hr.service.ts the insert
-- sits inside the transaction opened at :208, after the statement at :428 that
-- moves the candidate to current_stage='payroll_validated'. The throw triggers
-- the rollback at :517, so the stage change is undone too. That is why
-- production holds ZERO candidates at 'payroll_validated' and ZERO pending
-- approvals: Payroll HR's "send to branch head" step has been failing
-- atomically, leaving no trace in either table.
--
-- Downstream, getPendingApprovals filters on approval_status='pending' AND
-- current_stage='payroll_validated', so the branch head's queue is always
-- empty and they cannot approve anything. validateSalaryLock in
-- employee-creation-orchestrator.service.ts then refuses employee creation with
-- "Branch Head approval pending" — accurately, since the approval genuinely
-- does not exist.
--
-- The three approvals that DID succeed are dated 22 June and 3 July, before the
-- table took the narrow shape.
--
-- 138's definition is the one the whole codebase expects, so widen to match it.
-- Existing 'approved'/'rejected' rows keep their values: widening an ENUM does
-- not rewrite data, and both labels are retained in the new list.

SET @col := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'ats_branch_head_approval'
     AND COLUMN_NAME = 'approval_status'
);

SET @sql := IF(
  @col IS NULL OR LOCATE('pending', @col) > 0,
  'SELECT ''approval_status already accepts pending — nothing to do'' AS message',
  'ALTER TABLE ats_branch_head_approval
     MODIFY COLUMN approval_status
     ENUM(''pending'',''approved'',''rejected'',''sent_back'')
     NOT NULL DEFAULT ''pending'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
