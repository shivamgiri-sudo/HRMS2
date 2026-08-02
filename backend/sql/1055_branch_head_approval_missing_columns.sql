-- Align ats_branch_head_approval with the definition the code was written against.
--
-- 1054 widened approval_status so 'pending' became storable. Probing the real
-- INSERT afterwards showed the divergence between 138_ats_complete_journey.sql
-- and 141_branch_head_approval.sql is wider than that one column: production
-- (built from 141) is missing four things the code depends on.
--
-- payroll-hr.service.ts:435, which is how Payroll HR sends a candidate to the
-- branch head, needs ALL of these to succeed:
--
--   notified_at   written by both INSERTs (:435, :575)          -- MISSING
--   updated_at    set by the ON DUPLICATE KEY UPDATE at :435,   -- MISSING
--                 and by both approve/reject UPDATEs in
--                 branch-head-approval.service.ts (:188, :264)
--   created_at    ordering column expected by 138               -- MISSING
--   branch_head_id NULLable — :435 inserts NULL deliberately,   -- was NOT NULL
--                 because the branch head is resolved later
--                 from the branch assignment, not at raise time
--
-- approved_at is also relaxed to NULL. Production declared it
-- NOT NULL DEFAULT CURRENT_TIMESTAMP, so a freshly raised, still-pending row
-- would carry an approval timestamp from the moment it was created — a record
-- claiming it was approved before any human saw it. 138 declares it NULL.
--
-- Without these, fixing the enum alone just moves the failure one column along:
-- the INSERT still throws inside the transaction opened at payroll-hr.service.ts:208,
-- still rolls back the current_stage='payroll_validated' change with it, and the
-- branch head's queue stays empty.
--
-- Every step is guarded so re-running is a no-op.

-- ── notified_at ─────────────────────────────────────────────────────────────
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_branch_head_approval'
                AND COLUMN_NAME = 'notified_at');
SET @sql := IF(@has = 0,
  'ALTER TABLE ats_branch_head_approval ADD COLUMN notified_at DATETIME NULL AFTER approved_at',
  'SELECT ''notified_at present'' AS message');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── created_at ──────────────────────────────────────────────────────────────
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_branch_head_approval'
                AND COLUMN_NAME = 'created_at');
SET @sql := IF(@has = 0,
  'ALTER TABLE ats_branch_head_approval ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
  'SELECT ''created_at present'' AS message');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── updated_at ──────────────────────────────────────────────────────────────
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_branch_head_approval'
                AND COLUMN_NAME = 'updated_at');
SET @sql := IF(@has = 0,
  'ALTER TABLE ats_branch_head_approval ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
  'SELECT ''updated_at present'' AS message');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── branch_head_id must accept NULL at raise time ───────────────────────────
SET @nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_branch_head_approval'
                     AND COLUMN_NAME = 'branch_head_id');
SET @sql := IF(@nullable = 'NO',
  'ALTER TABLE ats_branch_head_approval MODIFY COLUMN branch_head_id CHAR(36) NULL COMMENT ''Branch head who approves; NULL until decided''',
  'SELECT ''branch_head_id already nullable'' AS message');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── approved_at must not default to "now" on a pending row ──────────────────
SET @nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_branch_head_approval'
                     AND COLUMN_NAME = 'approved_at');
SET @sql := IF(@nullable = 'NO',
  'ALTER TABLE ats_branch_head_approval MODIFY COLUMN approved_at DATETIME NULL',
  'SELECT ''approved_at already nullable'' AS message');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
