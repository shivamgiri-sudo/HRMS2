-- ============================================================
-- Migration 230: attendance_reconciliation_record — RTA linkage columns
--
-- Adds final_roster_status, manager_action_status, and a derived
-- rta_exception_label so the RTA board can show exception state
-- without joining back to wfm_roster_assignment on every render.
--
-- Source of truth: wfm_roster_assignment (written by the roster engine
-- and manager action handlers). These columns here are a sync-derived
-- copy for read performance — rta-sync.service.ts writes them.
--
-- SAFE: All nullable, no default changes to existing columns.
--
-- ROLLBACK:
--   ALTER TABLE attendance_reconciliation_record
--     DROP COLUMN IF EXISTS final_roster_status,
--     DROP COLUMN IF EXISTS manager_action_status,
--     DROP COLUMN IF EXISTS rta_exception_label;
--   DROP INDEX IF EXISTS idx_arr_rta_exception ON attendance_reconciliation_record;
-- ============================================================

SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_reconciliation_record' AND COLUMN_NAME = 'final_roster_status'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE attendance_reconciliation_record ADD COLUMN final_roster_status  VARCHAR(50)  NULL
    COMMENT ''Copied from wfm_roster_assignment.final_roster_status at sync time''',
  'SELECT "final_roster_status already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_reconciliation_record' AND COLUMN_NAME = 'manager_action_status'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE attendance_reconciliation_record ADD COLUMN manager_action_status VARCHAR(50) NULL
    COMMENT ''Copied from wfm_roster_assignment.manager_action_status at sync time''',
  'SELECT "manager_action_status already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_reconciliation_record' AND COLUMN_NAME = 'rta_exception_label'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE attendance_reconciliation_record ADD COLUMN rta_exception_label  VARCHAR(100) NULL
    COMMENT ''Derived display label: Scheduled / Week Off / Pending Manager Action / Roster Dispute / Shift Mismatch / etc.''',
  'SELECT "rta_exception_label already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;

ALTER TABLE attendance_reconciliation_record
  ADD INDEX IF NOT EXISTS idx_arr_rta_exception (rta_exception_label);

SELECT '230_attendance_reconciliation_rta_linkage.sql applied successfully' AS migration_status;
