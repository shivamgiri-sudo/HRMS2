-- 1759_roster_conflict_resolution_evidence.sql
-- Gives roster-conflict resolution somewhere to actually be stored.
--
-- THE PROBLEM THIS SOLVES
-- The Roster Requests "Swaps & conflicts" tab (src/pages/NativeWFMExtensions.tsx, ConflictsTab)
-- opens a "Resolve Conflict" modal, requires the manager to type a Resolution Action, and POSTs
-- it as { resolution_action, remarks } to /api/wfm-ext/roster/conflicts/:id/resolve.
--
-- The backend threw all of it away. rosterConflictService.resolve() ran exactly:
--     UPDATE wfm_roster_conflict_log SET resolved = 1 WHERE id = ?
-- and the route handler never read req.body at all. logSensitiveAction() was called without a
-- change_summary, so the text was not captured in the audit trail either. The decision a
-- manager made -- what they did about an overlapping shift and why -- was unrecoverable the
-- instant they clicked Resolve. The list endpoint then papered over the hole by mapping
-- `resolution_remarks: row.description`, i.e. showing the DETECTION description back as though
-- it were the resolution.
--
-- Confirmed against the deployed build (commit 9a6bee69) by the WFM Roster deep audit,
-- 2026-09-12, finding RR12 (Critical). The table genuinely had no column to write to: its
-- full column list was id, employee_id, conflict_date, conflict_type, description, resolved,
-- detected_at (see 017_ats_wfm_completion.sql).
--
-- Column names mirror the same four already used by
-- 272_hrms2_joining_control_room_document_viewer.sql (resolution_remarks / resolved_by /
-- resolved_at) so the shape is consistent with the rest of the schema.
--
-- Additive and idempotent: every ADD COLUMN is guarded on information_schema, so this is safe
-- to rerun and safe against a column left behind by a partial run. No existing column or row
-- is touched -- rows already sitting at resolved = 1 simply keep NULL evidence, which is the
-- honest representation of the fact that it was never captured.

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='wfm_roster_conflict_log' AND column_name='resolution_action')=0,
  'ALTER TABLE wfm_roster_conflict_log ADD COLUMN resolution_action VARCHAR(100) NULL COMMENT ''What the resolver did about the conflict''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='wfm_roster_conflict_log' AND column_name='resolution_remarks')=0,
  'ALTER TABLE wfm_roster_conflict_log ADD COLUMN resolution_remarks TEXT NULL COMMENT ''Free-text detail supplied by the resolver''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='wfm_roster_conflict_log' AND column_name='resolved_by')=0,
  'ALTER TABLE wfm_roster_conflict_log ADD COLUMN resolved_by CHAR(36) NULL COMMENT ''users.id of the actor who resolved it''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='wfm_roster_conflict_log' AND column_name='resolved_at')=0,
  'ALTER TABLE wfm_roster_conflict_log ADD COLUMN resolved_at DATETIME NULL COMMENT ''When it was resolved''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Lets the open-conflict queue filter and the "who resolved what" lookups stay index-backed.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='wfm_roster_conflict_log' AND index_name='idx_conflict_resolved_at')=0,
  'ALTER TABLE wfm_roster_conflict_log ADD INDEX idx_conflict_resolved_at (resolved, resolved_at)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1759_roster_conflict_resolution_evidence.sql applied' AS migration_status;
