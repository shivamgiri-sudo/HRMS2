-- Migration 1202: Week-off policy default hierarchy (process/branch/org tier)
--
-- Part A.1 of the 2026-08-13 roster enterprise-controls program
-- (week-off policy / minimum-rest / roster lifecycle lock / shift versioning).
--
-- Problem: roster-generation.service.ts's processEmployee() resolves an
-- employee's week-off day ONLY from week_off_preference (approved=1):
--   let isWeekOffDay = weekoff ? weekoff.preferred_day === dayOfWeek : false;
-- An employee with no approved preference silently gets isWeekOffDay=false
-- for every date in the cycle — a full 7-day working week with no week-off
-- at all — and nothing in roster_generation_run or the publish gate in
-- roster.governance.service.ts ever surfaces that. roster_template
-- (060_roster_master.sql) already carries a per-process weekly pattern
-- (pattern_json.days[].is_week_off) but is loaded into `rosterTemplate` in
-- generateForCycle() and never read again (dead) — that is tier 2 of the
-- hierarchy and needs no new schema, only wiring.
--
-- This migration adds tier 3 (the last-resort process/branch/org default),
-- completing the business-required hierarchy: employee preference ->
-- roster template -> process -> branch -> organization. Deliberately
-- excludes 'designation'/'employee' scope_type values — employee-level
-- resolution is already week_off_preference's job; duplicating it here
-- would create the second source of truth CLAUDE.md prohibits.
--
-- default_week_off_day is NOT NULL on a row that exists, but NO row is
-- seeded by this file at any scope. The business decision is explicit:
-- never default to Sunday. An empty table is the correct starting state —
-- until someone explicitly configures a scope through the admin UI (not
-- built in this pass), resolution finds nothing at this tier either, and
-- the caller (resolveWeekOffPolicy in roster-generation.service.ts) must
-- treat that as WEEK_OFF_POLICY_MISSING, not silently substitute a day.
--
-- Purely additive: one CREATE TABLE IF NOT EXISTS, no existing table or
-- column touched, no data migrated (there is nothing to migrate — this
-- concept has never had a table). Idempotent by construction.
--
-- **DO NOT RUN THIS AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL.**
-- Registered in MIGRATION_MANIFEST alongside this commit only because it is
-- schema-only and inert (empty table, nothing reads or writes it until the
-- generation-service wiring in the same change is also live) — consistent
-- with how 1138/1139/1140 (also schema-only, also inert until wired) were
-- handled earlier in this same audit. No production data is mutated by
-- applying this file.

USE mas_hrms;

CREATE TABLE IF NOT EXISTS week_off_policy_default (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  scope_type           ENUM('global','branch','process') NOT NULL,
  process_id           CHAR(36)     NULL,
  branch_id            CHAR(36)     NULL,
  default_week_off_day TINYINT      NOT NULL COMMENT '0=Sunday..6=Saturday — never defaulted, always explicitly configured',
  effective_from       DATE         NOT NULL DEFAULT (CURDATE()),
  effective_to         DATE         NULL,
  active_status        TINYINT(1)   NOT NULL DEFAULT 1,
  change_reason        TEXT         NULL,
  created_by           VARCHAR(100) NOT NULL DEFAULT 'system',
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by           VARCHAR(100) NULL,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CHECK (default_week_off_day BETWEEN 0 AND 6),
  INDEX idx_wopd_scope   (scope_type, active_status),
  INDEX idx_wopd_process (process_id),
  INDEX idx_wopd_branch  (branch_id),
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id)  REFERENCES branch_master(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1202_week_off_policy_default.sql applied successfully' AS migration_status;

-- ── Rollback (run manually, NOT part of forward migration) ─────────────────
-- DROP TABLE IF EXISTS week_off_policy_default;
-- Safe at any point before real policy rows exist: nothing else references
-- this table, and dropping it reverts resolveWeekOffPolicy() to never
-- finding a tier-3 match, i.e. back to today's pre-migration fail state for
-- any employee who also has no tier-1/tier-2 resolution — which is exactly
-- the WEEK_OFF_POLICY_MISSING condition this migration exists to make
-- configurable out of, not a change in what "no config" means.
