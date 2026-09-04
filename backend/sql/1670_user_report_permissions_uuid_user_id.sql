-- user_report_permissions.user_id could never match a user.
--
-- The column is INT while auth_user.id is CHAR(36). reporting.routes.ts queries it
-- with the caller's UUID:
--
--     SELECT report_code, can_view, can_export FROM user_report_permissions
--      WHERE user_id = ? AND active_status = 1
--
-- MySQL coerces the UUID string to 0 for the comparison, so the lookup matches
-- nothing for every user, always. The table has held 0 rows since it was created,
-- which is consistent with nobody ever succeeding in granting a per-user report.
--
-- Effect of this fix: per-user report grants start working. The role-level table
-- (role_report_permissions.role_key VARCHAR) was never affected and keeps working.
--
-- Safe to run: verified 0 rows on 2026-09-04, so there is no data to convert and
-- no risk of truncating an existing integer id into a CHAR(36).
--
-- granted_by has the same defect and is fixed here too — it is NOT NULL, so a
-- write would otherwise have to invent an integer for a UUID actor.

-- Guarded with PREPARE/EXECUTE against information_schema rather than
-- "ALTER TABLE ... MODIFY IF EXISTS", which MySQL 8 rejects at parse time while
-- the migration runner still records the file as applied.

SET @col_type := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'user_report_permissions'
     AND COLUMN_NAME = 'user_id'
);

SET @sql := IF(
  @col_type = 'int',
  'ALTER TABLE user_report_permissions
     MODIFY COLUMN user_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL',
  'SELECT "user_report_permissions.user_id already CHAR(36) — skipped" AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @gb_type := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'user_report_permissions'
     AND COLUMN_NAME = 'granted_by'
);

SET @sql2 := IF(
  @gb_type = 'int',
  'ALTER TABLE user_report_permissions
     MODIFY COLUMN granted_by CHAR(36) COLLATE utf8mb4_unicode_ci NULL',
  'SELECT "user_report_permissions.granted_by already CHAR(36) — skipped" AS note'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- The lookup is per user on every Report Library load, so give it an index.
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'user_report_permissions'
     AND INDEX_NAME = 'idx_urp_user_active'
);

SET @sql3 := IF(
  @has_idx = 0,
  'CREATE INDEX idx_urp_user_active ON user_report_permissions (user_id, active_status)',
  'SELECT "idx_urp_user_active already present — skipped" AS note'
);
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;
