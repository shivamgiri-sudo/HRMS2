-- 1033_sensitive_action_log_entity_id_width.sql
--
-- Widen sensitive_action_log.entity_id from CHAR(36) to VARCHAR(100).
--
-- Why
-- ---
-- CHAR(36) encodes an assumption that every audited entity is a bare UUID. The
-- codebase does not work that way: several call sites deliberately use a
-- composite key, because the thing being audited is a pair rather than a row —
-- "this employee on this day", "this employee for this financial year", "this
-- designation in this role". Those are the correct identifiers; the column was
-- simply too narrow to hold them.
--
-- MySQL rejected every one of those inserts, and writeSensitiveActionLog()
-- swallows its own errors by design (an audit failure must not break the
-- operation it is recording). The result was silent: the code looked like it was
-- auditing, and nothing was written.
--
-- Live census of sensitive_action_log before this migration (2026-08-01):
--
--   ATTENDANCE_RECORD_CORRECTED    0 rows   employee_id + ':' + date      = 47
--   TDS_PART_A_VERIFIED            0 rows   employee_id + ':' + FY        = 44
--   DESIGNATION_ROLE_MAPPED        0 rows   designation_id + '::' + role  = 38+
--   MODULE_ACCESS_SET              0 rows   role + '::module::' + name
--   ROLE_PAGE_UPDATED             20 rows   fits — but at maxlen 34, two
--                                           characters from silently breaking
--
-- 26 attendance regularizations were approved with zero corresponding
-- ATTENDANCE_RECORD_CORRECTED rows, so there is no record of what any of those
-- corrections changed. CLAUDE.md rule 8 requires every state-changing action to
-- be auditable.
--
-- Widening rather than patching the call sites: the composite keys are the right
-- identifiers, and shortening them at four sites would leave the trap armed for
-- the fifth. VARCHAR(100) also removes the ROLE_PAGE_UPDATED near-miss.
--
-- Safety
-- ------
-- Purely widening. CHAR(36) -> VARCHAR(100) preserves every existing value
-- (MySQL does not pad VARCHAR, and CHAR already strips trailing spaces on read).
-- idx_sal_entity is (entity_type, entity_id): at utf8mb4 the key becomes
-- 100*4 + 100*4 = 800 bytes, well inside InnoDB's 3072-byte limit. 34,885 rows,
-- so the rebuild is brief. Re-runnable: the ALTER is skipped when the column is
-- already wide enough.

SET @needs_widening := (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name   = 'sensitive_action_log'
     AND column_name  = 'entity_id'
     AND (data_type = 'char' OR character_maximum_length < 100)
);

SET @ddl := IF(
  @needs_widening > 0,
  'ALTER TABLE sensitive_action_log
     MODIFY COLUMN entity_id VARCHAR(100)
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL
     COMMENT ''UUID, or a composite key such as <employee_id>:<date> — see migration 1033''',
  'SELECT ''sensitive_action_log.entity_id already VARCHAR(100) or wider'' AS skipped'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
