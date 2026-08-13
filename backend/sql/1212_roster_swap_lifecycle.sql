-- Migration 1212: Shift-swap lifecycle columns
--
-- Round 2 of the 2026-08-13 roster enterprise-controls program.
--
-- PROBLEM (root cause of the dead shift-swap workflow):
-- wfm_roster_swap_request (017_ats_wfm_completion.sql) only ever captured
-- WHO wants to swap and WHEN (requester_emp_id, swap_with_emp_id, swap_date)
-- — never WHICH wfm_roster_assignment rows are involved. rosterSwapService
-- .review() in wfm-ext.service.ts therefore could only flip the request's
-- own status column; it had no roster row reference to act on, so an
-- "approved" swap never touched wfm_roster_assignment at all. This migration
-- adds exactly the columns the fixed review()/apply flow needs: counterpart
-- acceptance (the directive's "counterpart acceptance if applicable" step,
-- previously entirely absent — a manager could approve a swap the second
-- employee never agreed to), the two resolved assignment ids, an
-- applied_at marker distinguishing "approved" from "actually applied", a
-- before/after snapshot for audit, and a flag recording whether an
-- emergency rest-policy override was used to push it through.
--
-- Guarded via information_schema + PREPARE/EXECUTE per column — NOT
-- `ADD COLUMN IF NOT EXISTS`, which is not accepted by this server's MySQL
-- 8.0.42 build (confirmed live 2026-08-13 via the migration-1006 outage:
-- every variant throws ER_PARSE_ERROR at the IF NOT EXISTS token itself,
-- not a semantic "already exists" error, and a failed migration is fatal to
-- boot under STOP_ON_FIRST_FAILURE). Idempotent by construction: re-running
-- this file against a schema that already has every column is a no-op.
--
-- **DO NOT RUN THIS AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL.**
-- Not added to MIGRATION_MANIFEST — creating this file does not schedule it
-- to run at any pm2 restart/boot. Purely additive (new nullable columns on
-- an existing table with 0 rows migrated), but left pending certification
-- per the round-2 migration-certification requirement (item 8).

USE mas_hrms;

SET @c_counterpart_status = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_swap_request' AND COLUMN_NAME = 'counterpart_status'
);
SET @sql = IF(@c_counterpart_status = 0,
  'ALTER TABLE wfm_roster_swap_request ADD COLUMN counterpart_status ENUM(''pending'',''accepted'',''declined'') NOT NULL DEFAULT ''pending'' COMMENT ''swap_with_emp_id acceptance, independent of manager approval'' AFTER status',
  'SELECT "counterpart_status already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_counterpart_responded_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_swap_request' AND COLUMN_NAME = 'counterpart_responded_at'
);
SET @sql = IF(@c_counterpart_responded_at = 0,
  'ALTER TABLE wfm_roster_swap_request ADD COLUMN counterpart_responded_at DATETIME NULL AFTER counterpart_status',
  'SELECT "counterpart_responded_at already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_requester_assignment_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_swap_request' AND COLUMN_NAME = 'requester_assignment_id'
);
SET @sql = IF(@c_requester_assignment_id = 0,
  'ALTER TABLE wfm_roster_swap_request ADD COLUMN requester_assignment_id CHAR(36) NULL COMMENT ''wfm_roster_assignment.id resolved for requester_emp_id/swap_date at apply time'' AFTER reason',
  'SELECT "requester_assignment_id already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_target_assignment_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_swap_request' AND COLUMN_NAME = 'target_assignment_id'
);
SET @sql = IF(@c_target_assignment_id = 0,
  'ALTER TABLE wfm_roster_swap_request ADD COLUMN target_assignment_id CHAR(36) NULL COMMENT ''wfm_roster_assignment.id resolved for swap_with_emp_id/swap_date at apply time'' AFTER requester_assignment_id',
  'SELECT "target_assignment_id already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_applied_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_swap_request' AND COLUMN_NAME = 'applied_at'
);
SET @sql = IF(@c_applied_at = 0,
  'ALTER TABLE wfm_roster_swap_request ADD COLUMN applied_at DATETIME NULL COMMENT ''set only once the swap was actually written to wfm_roster_assignment - distinct from reviewed_at, which only records the approval decision'' AFTER reviewed_at',
  'SELECT "applied_at already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_before_state_json = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_swap_request' AND COLUMN_NAME = 'before_state_json'
);
SET @sql = IF(@c_before_state_json = 0,
  'ALTER TABLE wfm_roster_swap_request ADD COLUMN before_state_json JSON NULL COMMENT ''snapshot of both assignments employee/shift/shift_version_id immediately before apply'' AFTER applied_at',
  'SELECT "before_state_json already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_after_state_json = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_swap_request' AND COLUMN_NAME = 'after_state_json'
);
SET @sql = IF(@c_after_state_json = 0,
  'ALTER TABLE wfm_roster_swap_request ADD COLUMN after_state_json JSON NULL COMMENT ''snapshot of both assignments immediately after apply'' AFTER before_state_json',
  'SELECT "after_state_json already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_rest_override_used = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_swap_request' AND COLUMN_NAME = 'rest_override_used'
);
SET @sql = IF(@c_rest_override_used = 0,
  'ALTER TABLE wfm_roster_swap_request ADD COLUMN rest_override_used TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1 if minimum-rest validation failed for either side and an emergency override (wfm_rest_override_log) was used to apply anyway'' AFTER after_state_json',
  'SELECT "rest_override_used already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Prevents the exact same swap request from being applied twice even under
-- a concurrent double-submit of the approval endpoint: apply() first does
-- `UPDATE ... SET status='approved' WHERE id=? AND status='pending'` inside
-- the transaction and checks affectedRows — this index just makes that
-- check fast, it is not itself the concurrency guard (the guard is the
-- conditional UPDATE + row lock in the service code).
SET @i_swap_status = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_swap_request' AND INDEX_NAME = 'idx_swap_status'
);
SET @sql = IF(@i_swap_status = 0,
  'ALTER TABLE wfm_roster_swap_request ADD INDEX idx_swap_status (status)',
  'SELECT "idx_swap_status already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1212_roster_swap_lifecycle.sql applied successfully' AS migration_status;

-- ── Rollback (run manually, NOT part of forward migration) ─────────────────
-- ALTER TABLE wfm_roster_swap_request
--   DROP COLUMN counterpart_status, DROP COLUMN counterpart_responded_at,
--   DROP COLUMN requester_assignment_id, DROP COLUMN target_assignment_id,
--   DROP COLUMN applied_at, DROP COLUMN before_state_json,
--   DROP COLUMN after_state_json, DROP COLUMN rest_override_used;
-- ALTER TABLE wfm_roster_swap_request DROP INDEX idx_swap_status;
-- Safe at any point before a real swap has been applied through the new
-- columns — rolling back after that would lose the audit trail for any
-- swap already applied, but the underlying wfm_roster_assignment rows
-- swapped by that point remain correct either way (this migration only
-- adds bookkeeping columns to the request table, it never touches
-- wfm_roster_assignment itself).
