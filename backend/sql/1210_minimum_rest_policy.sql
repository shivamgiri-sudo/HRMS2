-- Migration 1210: Minimum rest-between-shifts policy
--
-- **DO NOT RUN THIS AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL.**
-- Not added to MIGRATION_MANIFEST in backend/src/db/runPendingMigrations.ts —
-- creating this file does not schedule it to run at any pm2 restart/boot.
--
-- Area 2 of the roster enterprise-controls program: a configurable
-- minimum_rest_minutes policy, resolved employee > process > branch/site >
-- organization, with NO hard-coded fallback value. The absence of any
-- configured policy is a distinct, first-class state (see
-- rest-policy.service.ts's resolveRestPolicy() returning null) that fails
-- roster publish/generation with a configuration-required error — it is never
-- silently treated as "minimum rest = 0".
--
-- Two tables:
--
--   wfm_rest_policy — the policy hierarchy itself. scope_type/scope_id is a
--   polymorphic reference (employee id, process id, branch id, or NULL for the
--   organization-wide row) rather than three separate nullable FK columns, so
--   the resolver can express "check employee, then process, then branch, then
--   org" as one shape-uniform lookup instead of four different column checks.
--   No FK constraint on scope_id itself (it can point to three different
--   tables) — validity is enforced at the application layer in
--   rest-policy.service.ts, the same trade-off wfm_roster_assignment already
--   makes for branch_name/process_name (denormalized, not FK-constrained).
--
--   wfm_rest_override_log — every time an emergency override is actually used
--   to publish an assignment below the resolved minimum. Immutable audit trail
--   (insert-only, no UPDATE/DELETE route will ever be added) — reason,
--   requested by, approved by, approval timestamp, and the exact policy that
--   was overridden, per the program's audit requirement for Area 2's override
--   path.

USE mas_hrms;

CREATE TABLE IF NOT EXISTS wfm_rest_policy (
  id                        CHAR(36)     NOT NULL DEFAULT (UUID()),
  scope_type                ENUM('organization','branch','process','employee') NOT NULL,
  scope_id                  CHAR(36)     NULL COMMENT 'NULL for scope_type=organization; employees.id / process_master.id / branch_master.id otherwise',
  minimum_rest_minutes      INT          NOT NULL,
  allows_emergency_override TINYINT(1)   NOT NULL DEFAULT 0,
  effective_from            DATE         NOT NULL,
  effective_to              DATE         NULL,
  active_status             TINYINT(1)   NOT NULL DEFAULT 1,
  reason                    VARCHAR(500) NULL COMMENT 'Why this policy/value was set — shown in the admin config UI audit trail',
  created_by                CHAR(36)     NULL,
  approved_by               CHAR(36)     NULL,
  created_at                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wfm_rest_policy_scope (scope_type, scope_id, active_status),
  KEY idx_wfm_rest_policy_effective (effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per scope target may be active for a given window: a second active
-- row for the same (scope_type, scope_id) would make the resolver's "first
-- match" ambiguous. effective_to defaults to a sentinel far-future date in the
-- generated column so two NULL-effective_to rows for the same scope still
-- collide on the UNIQUE index (MySQL treats NULL as distinct in a UNIQUE key
-- otherwise, which would silently allow two "current" rows for one scope).
ALTER TABLE wfm_rest_policy
  ADD COLUMN IF NOT EXISTS effective_to_bound DATE
    GENERATED ALWAYS AS (COALESCE(effective_to, '9999-12-31')) STORED;

SET @uq_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_rest_policy' AND INDEX_NAME = 'uq_wfm_rest_policy_scope_window');
SET @add_uq := IF(@uq_exists = 0,
  'ALTER TABLE wfm_rest_policy ADD UNIQUE KEY uq_wfm_rest_policy_scope_window (scope_type, scope_id, effective_from, effective_to_bound)',
  'SELECT 1');
PREPARE stmt FROM @add_uq; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS wfm_rest_override_log (
  id                     CHAR(36)     NOT NULL DEFAULT (UUID()),
  employee_id            CHAR(36)     NOT NULL,
  roster_date            DATE         NOT NULL COMMENT 'The date of the shift being assigned below minimum rest (the later of the two shifts)',
  previous_shift_end_at  DATETIME     NOT NULL COMMENT 'Date+time the prior shift actually ended',
  next_shift_start_at    DATETIME     NOT NULL COMMENT 'Date+time the new/overridden shift starts',
  actual_rest_minutes    INT          NOT NULL,
  required_rest_minutes  INT          NOT NULL COMMENT 'The policy minimum that was overridden',
  policy_id              CHAR(36)     NULL COMMENT 'wfm_rest_policy.id that granted allows_emergency_override — NULL if the policy row was later deleted/deactivated',
  source                 VARCHAR(40)  NOT NULL COMMENT 'weekly_generation | manual_assignment | bulk_upload | shift_swap',
  reason                 VARCHAR(500) NOT NULL,
  requested_by           CHAR(36)     NOT NULL,
  approved_by             CHAR(36)     NOT NULL,
  approved_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wfm_rest_override_log_employee (employee_id, roster_date),
  KEY idx_wfm_rest_override_log_policy (policy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1210_minimum_rest_policy.sql applied successfully' AS migration_status;

-- ── Rollback (run manually, NOT part of forward migration) ─────────────────
-- DROP TABLE IF EXISTS wfm_rest_override_log;
-- DROP TABLE IF EXISTS wfm_rest_policy;
-- (Both tables are new and additive — nothing else references them, so
-- dropping is safe at any point before real policy data has been entered
-- through the admin config UI. Once policies exist, dropping wfm_rest_policy
-- reverts every roster write path to its config-missing fail-closed state,
-- not to "no minimum" — validate that is the intended outcome before rolling
-- back on a database with real policy rows.)
