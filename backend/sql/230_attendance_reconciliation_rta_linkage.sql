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

ALTER TABLE attendance_reconciliation_record
  ADD COLUMN IF NOT EXISTS final_roster_status  VARCHAR(50)  NULL
    COMMENT 'Copied from wfm_roster_assignment.final_roster_status at sync time',
  ADD COLUMN IF NOT EXISTS manager_action_status VARCHAR(50) NULL
    COMMENT 'Copied from wfm_roster_assignment.manager_action_status at sync time',
  ADD COLUMN IF NOT EXISTS rta_exception_label  VARCHAR(100) NULL
    COMMENT 'Derived display label: Scheduled / Week Off / Pending Manager Action / Roster Dispute / Shift Mismatch / etc.';

ALTER TABLE attendance_reconciliation_record
  ADD INDEX IF NOT EXISTS idx_arr_rta_exception (rta_exception_label);

SELECT '230_attendance_reconciliation_rta_linkage.sql applied successfully' AS migration_status;
