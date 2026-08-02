-- 1049_user_assignment_scope_granted_by.sql
--
-- Records WHO granted a data-access scope. Today nothing does.
--
-- access.routes.ts:414 has always written assigned_by_user_id and assigned_at to
-- user_assignment_scope. Neither column exists, so every scope grant threw
-- ER_BAD_FIELD_ERROR — the grant endpoint has never worked.
--
-- Two different problems in one statement, and only one is a missing column:
--
--   assigned_at          NOT added. The table already has created_at, and the code passes
--                        NOW() — the same value. A second timestamp column would be a
--                        duplicate of an existing one. The code is corrected to write
--                        created_at instead.
--
--   assigned_by_user_id  ADDED. There is no equivalent anywhere on the table, and the
--                        information is genuinely absent: user_assignment_scope records
--                        which user may see which branch/process, but not who granted it.
--
-- WHY THIS ONE IS WORTH A COLUMN
-- Role changes ARE audited — sensitive_action_log holds ROLE_ASSIGNED (98), ROLE_REVOKED
-- (26), ROLE_PAGE_UPDATED (24). Scope grants are not: this route calls no audit helper at
-- all. So a scope grant currently leaves no record of its author anywhere in the system,
-- and CLAUDE.md rule 8 requires every state-changing sensitive action to be auditable.
-- Granting someone visibility of a branch's data is exactly that.
--
-- The column also outlives log retention, which matters for an access-control fact that is
-- read to answer "why can this person see this branch".
--
-- SAFETY: NULLable with no default, so the 97 existing rows are untouched. They keep a NULL
-- grantor, which is honest — that information was never captured and cannot be reconstructed.
-- Guarded so re-running is safe.

SET NAMES utf8mb4;
SET @db := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='user_assignment_scope'
      AND COLUMN_NAME='assigned_by_user_id') = 0,
  "ALTER TABLE user_assignment_scope
     ADD COLUMN assigned_by_user_id CHAR(36) NULL
       COMMENT 'auth_user.id of whoever granted this scope; NULL for rows created before this was recorded'",
  'SELECT ''assigned_by_user_id exists'''));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Index it: the question this column answers is "what did this admin grant", which is a
-- lookup by grantor, not a scan.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='user_assignment_scope'
      AND INDEX_NAME='idx_uas_assigned_by') = 0,
  'ALTER TABLE user_assignment_scope ADD INDEX idx_uas_assigned_by (assigned_by_user_id)',
  'SELECT ''idx_uas_assigned_by exists'''));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
--   SELECT COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_assignment_scope'
--      AND COLUMN_NAME='assigned_by_user_id';        -- expect char(36), YES
--
--   SELECT COUNT(*) total, COUNT(assigned_by_user_id) recorded
--     FROM user_assignment_scope;                    -- expect 97 total, 0 recorded
--
-- New grants populate it. Existing rows stay NULL, which is accurate rather than guessed.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- ALTER TABLE user_assignment_scope DROP INDEX idx_uas_assigned_by;
-- ALTER TABLE user_assignment_scope DROP COLUMN assigned_by_user_id;
