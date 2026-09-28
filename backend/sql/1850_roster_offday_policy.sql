-- 1850_roster_offday_policy.sql
-- Effective-dated weekly-off policy per process / LOB / branch, maintained only by WFM.
--   off_type = FIXED_DAY : the LOB always has the same weekday(s) off (e.g. every Sunday).
--   off_type = FLOATING  : N offs per week, allocated by the existing preference/fairness engine.
-- lob_id NULL = the whole process; branch_id NULL = every branch.
--
-- fixed_weekdays is a sorted comma-separated list of weekday numbers 0=Sunday..6=Saturday
-- (same numbering as week_off_policy_default.default_week_off_day), 1 or 2 values, e.g. '0' or '0,6'.
-- A CSV rather than a bitmask so the value is readable in a plain SELECT; the service validates it.
--
-- The UNIQUE key cannot stop duplicate scopes on its own (MySQL treats NULL lob_id / branch_id as
-- distinct), so overlapping effective ranges are rejected in roster-offday-policy.service.ts.
-- No FKs (as process_lob_map); integrity is enforced in the service. Audit reuses audit_action_log.
-- Nothing reads this table until a WFM user adds a row, so existing roster behaviour is unchanged.
--
-- COLLATION: id columns copy process_master / lob_master / branch_master collations from
-- information_schema at migration time, exactly like 1847 (see hrms2-new-table-collation-trap).
-- Additive + idempotent: CREATE TABLE IF NOT EXISTS.

SET @rop_pc = COALESCE((SELECT COLLATION_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_master' AND COLUMN_NAME = 'id' LIMIT 1), 'utf8mb4_unicode_ci');
SET @rop_lc = COALESCE((SELECT COLLATION_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lob_master' AND COLUMN_NAME = 'id' LIMIT 1), 'utf8mb4_unicode_ci');
SET @rop_bc = COALESCE((SELECT COLLATION_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branch_master' AND COLUMN_NAME = 'id' LIMIT 1), 'utf8mb4_unicode_ci');

SET @rop_sql = CONCAT(
  'CREATE TABLE IF NOT EXISTS roster_offday_policy (',
  ' id CHAR(36) NOT NULL PRIMARY KEY,',
  ' process_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rop_pc, ' NOT NULL,',
  ' lob_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rop_lc, ' NULL,',
  ' branch_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @rop_bc, ' NULL,',
  ' off_type ENUM(''FIXED_DAY'',''FLOATING'') NOT NULL,',
  ' fixed_weekdays VARCHAR(20) NULL,',
  ' floating_offs_per_week TINYINT UNSIGNED NULL,',
  ' effective_from DATE NOT NULL,',
  ' effective_to DATE NULL,',
  ' active_status TINYINT(1) NOT NULL DEFAULT 1,',
  ' created_by CHAR(36) NULL,',
  ' updated_by CHAR(36) NULL,',
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  ' updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,',
  ' UNIQUE KEY uq_roster_offday_policy_scope (process_id, lob_id, branch_id, effective_from),',
  ' INDEX idx_roster_offday_policy_process (process_id, active_status, effective_from),',
  ' INDEX idx_roster_offday_policy_lob (lob_id),',
  ' INDEX idx_roster_offday_policy_branch (branch_id)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);
PREPARE rop_stmt FROM @rop_sql;
EXECUTE rop_stmt;
DEALLOCATE PREPARE rop_stmt;
