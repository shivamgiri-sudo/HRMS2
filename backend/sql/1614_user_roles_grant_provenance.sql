-- Migration: 1614_user_roles_grant_provenance.sql
-- Purpose: Add granted_by / granted_at to user_roles so a live role grant carries
--          its own provenance, rather than only appearing in the audit stream.
-- Date: 2026-08-26
--
-- Issue: user_roles holds (id, user_id, role_key, active_status, created_at) and
--        nothing else — verified live 2026-08-26 against mas_hrms: 1,618 rows,
--        1,491 of them active. Role assignment IS audited as an EVENT
--        (access.service.ts logs ROLE_ASSIGNED / ROLE_REVOKED through
--        logSensitiveAction), but the grant row itself cannot answer "who gave
--        this person this role, and when did the access they hold right now
--        begin" without replaying the audit log — and only for grants made
--        through the admin path. auth-launch.routes.ts carries an actor id it
--        deliberately discards, its own comment naming this exact absence:
--        "_actorUserId is still unused: user_roles has no granted_by/granted_at
--        column ... Recording the actor needs a migration."
--
--        Worse than absent: created_at actively MISREPORTS current access. Every
--        grant site inserts with ON DUPLICATE KEY UPDATE active_status = 1
--        against uq_user_role(user_id, role_key) (confirmed live), so a role that
--        was revoked and later re-granted keeps the created_at of the ORIGINAL
--        grant. Reading created_at as "access began" understates the age of a
--        reinstated privilege by however long the revocation lasted. granted_at
--        is refreshed on reactivation precisely so it does not inherit that flaw.
--
-- Backfill: deliberately NONE. The 1,618 existing rows predate any provenance
--        capture, and created_at is exactly the unreliable value described above,
--        so copying it into granted_at would launder an untrustworthy timestamp
--        into a column that claims precision. Both columns stay NULL on historic
--        rows, and NULL reads unambiguously as "granted before this was tracked".
--        Readers MUST treat NULL as unknown and never as a zero date.
--
-- Semantics: granted_by NULL with granted_at set means a SYSTEM grant with no
--        human actor — the baseline `employee` role auto-attached at first login
--        (auth.service.ts ensureEmployeeRole) or at employee creation
--        (employee.service.ts). Both NULL means the row predates this migration.
--
-- Purely additive: two nullable columns on an existing table. No index, no
-- foreign key (so no cross-collation join risk), no existing column touched, no
-- row rewritten. Idempotent via information_schema guards — this MySQL 8.0.42
-- rejects ALTER TABLE ... ADD COLUMN IF NOT EXISTS at the token.

-- ============================================================================
-- 1. granted_by — auth_user.id of the actor who performed the grant.
--    CHAR(36) utf8mb4_unicode_ci to match auth_user.id and user_roles.user_id
--    exactly (both verified live), so a future join cannot fail with errno 3780.
-- ============================================================================

SET @granted_by_exists = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'user_roles'
     AND COLUMN_NAME = 'granted_by'
);

SET @sql = IF(@granted_by_exists = 0,
  'ALTER TABLE user_roles ADD COLUMN granted_by CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER active_status',
  'SELECT ''granted_by column already exists on user_roles'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 2. granted_at — when the grant the row currently represents took effect.
--    Refreshed on ON DUPLICATE KEY reactivation by the call sites, which is the
--    whole point: unlike created_at, it describes access held NOW.
-- ============================================================================

SET @granted_at_exists = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'user_roles'
     AND COLUMN_NAME = 'granted_at'
);

SET @sql = IF(@granted_at_exists = 0,
  'ALTER TABLE user_roles ADD COLUMN granted_at DATETIME NULL AFTER granted_by',
  'SELECT ''granted_at column already exists on user_roles'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 1614_user_roles_grant_provenance.sql complete' AS status;
