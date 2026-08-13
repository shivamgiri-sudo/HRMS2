-- Architecture for a future, superadmin-configurable additional deduction
-- per unplanned-absence day, on top of the existing zero-pay treatment for
-- that day. NOT ACTIVATED — see backend/src/shared/absencePenaltyConfig.ts
-- for the read helper, which always returns 0 (no penalty) until an
-- approved row exists here, and is NOT yet wired into payrollCalculate
-- .service.ts (deliberately deferred — see that file's own note).
-- (2026-08-13, leave-module audit — policy sign-off, "future configurable
-- unplanned-absence penalty" section.)
--
-- Modelled directly on statutory_config_version's already-approved pattern
-- (1030_statutory_config_versioning.sql): effective_from/effective_to range
-- versioning + an approved_by/approved_at gate so an unapproved row can
-- never silently take effect, matching CLAUDE.md's payroll safety rules.
--
-- config_key is a single fixed row family ('unplanned_absence_penalty_days')
-- rather than per-branch/process, since no such dimension was requested;
-- the column exists so a future per-scope rule doesn't require a schema
-- change, only a new config_key value.
--
-- Purely additive: no existing table or column touched, no data migrated.

CREATE TABLE IF NOT EXISTS absence_penalty_config (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  config_key      VARCHAR(100)  NOT NULL DEFAULT 'unplanned_absence_penalty_days',
  -- Additional deduction, in days of pay, applied per unplanned-absence day
  -- ON TOP OF the existing zero-pay treatment that day already gets.
  -- Default/current value = 0 (no additional penalty) is the ONLY value
  -- read anywhere until this is explicitly activated.
  penalty_days    DECIMAL(4,2)  NOT NULL DEFAULT 0.00,
  effective_from  DATE          NOT NULL,
  effective_to    DATE          NULL,
  -- Unapproved rows are proposals only — never read as effective, same
  -- rule as statutory_config_version.
  approved_by     CHAR(36)      NULL,
  approved_at     DATETIME      NULL,
  created_by      CHAR(36)      NOT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes           TEXT          NULL,
  UNIQUE KEY uq_absence_penalty_key_effective (config_key, effective_from),
  INDEX idx_absence_penalty_effective (config_key, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
