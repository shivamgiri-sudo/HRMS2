-- 1672_attendance_rule_config_cost_centre.sql
--
-- WHY
-- ---
-- Owner requirement, 2026-09-05: build an attendance exception by picking a Branch, then the
-- Branch's own cost centres (what the floor calls "call centres"), then a Designation within
-- that cost centre -- e.g. "Branch X, this call centre, Team Leaders: 8-hour day, biometric."
--
-- attendance_rule_config (044) already scopes by designation_id / process_id / branch_id, but
-- has no cost_centre_id column. Cost centre is the unit employees are actually tagged to --
-- 1,102 of 1,106 active employees (99.6%) carry a cost_centre_id, all 1,106 carry a branch_id,
-- and cost_centre_master.branch_id is populated on 934 of 937 rows (99.7%). process_id, by
-- contrast, is what the resolver has used until now, but only 24 of 937 cost centres link to a
-- process at all -- verified against live production data on 2026-09-05, not assumed.
--
-- attendance-engine.service.ts's processEmployee() already reads e.cost_centre_id from the
-- employees row (line ~979) and then discards it -- it was never passed into resolveRule(). This
-- migration adds the column the resolver needs to stop discarding it; the service-code change
-- that starts using it is separate application code, not this migration.
--
-- PURELY ADDITIVE
-- ---------------
-- One nullable column, one index, and the scope_type enum widened with new values appended at
-- the end. No existing column is altered or dropped, no existing row is touched -- all 30 live
-- rows keep cost_centre_id NULL and resolve exactly as they did before (NULL matches "any cost
-- centre" in the resolver's WHERE clause, same as NULL already does for process_id/branch_id).
--
-- COLLATION: CHAR(36) COLLATE utf8mb4_unicode_ci, matching attendance_rule_config's other id
-- columns and cost_centre_master.id -- a bare CHARSET=utf8mb4 column would join at errno 1267
-- (the systemic defect migration 1627 exists to repair).
--
-- Guarded on information_schema so a second run of this migration is a no-op, not an error.
--
-- ROLLBACK
-- --------
--   DROP INDEX idx_arc_cost_centre ON attendance_rule_config;
--   ALTER TABLE attendance_rule_config DROP COLUMN cost_centre_id;
--   ALTER TABLE attendance_rule_config MODIFY COLUMN scope_type
--     ENUM('designation','process','branch','process_designation','branch_process','global')
--     NOT NULL;
-- (The MODIFY rollback only works while no row uses one of the new enum values -- reassign or
-- delete those rows first.)

USE mas_hrms;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'attendance_rule_config'
              AND COLUMN_NAME = 'cost_centre_id');
SET @s := IF(@c = 0,
  'ALTER TABLE attendance_rule_config
     ADD COLUMN cost_centre_id CHAR(36) COLLATE utf8mb4_unicode_ci NULL AFTER process_id',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'attendance_rule_config'
              AND INDEX_NAME = 'idx_arc_cost_centre');
SET @s := IF(@c = 0,
  'CREATE INDEX idx_arc_cost_centre ON attendance_rule_config (cost_centre_id)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Enum widened with cost-centre combinations appended after 'global' so existing stored values
-- keep the same ordinal position. MODIFY COLUMN is idempotent to re-run.
ALTER TABLE attendance_rule_config MODIFY COLUMN scope_type
  ENUM('designation','process','branch','process_designation','branch_process','global',
       'cost_centre','cost_centre_designation','branch_cost_centre','branch_cost_centre_designation')
  NOT NULL;

-- Verification (expect 0 rows, then the widened enum list):
-- SELECT COUNT(*) FROM attendance_rule_config WHERE cost_centre_id IS NOT NULL;
-- SHOW COLUMNS FROM attendance_rule_config LIKE 'scope_type';
