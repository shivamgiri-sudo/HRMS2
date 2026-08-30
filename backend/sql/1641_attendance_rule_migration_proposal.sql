-- 1641 - Attendance rule migration PROPOSAL store: the staging area the Requirement 15
-- migration builds into, reviewed and approved before any of it becomes the active rule
-- store (requirements.md criteria 15.1, 15.2, 15.3, 15.8, 15.11, 15.12).
--
-- NOT YET EXECUTED. Purely additive: seven new tables, nothing altered, no existing row
-- touched, and nothing in this file is read by production code. Needs owner approval before
-- it runs (CLAUDE.md).
--
-- WHY THE PROPOSAL LIVES IN ITS OWN TABLES RATHER THAN AS A STATUS ON THE LIVE STORE
-- Criterion 15.11 requires an explicit approval action before the proposed rule set becomes
-- the active rule store, and criterion 15.12 requires the legacy source rows to be retained
-- in a deactivated state rather than deleted. A `status` column on attendance_source_rule
-- (migration 1633) or day_threshold_rule (1634) delivers neither.
-- attendance-source-rule.service.ts::loadActiveWindowedRules() selects on
-- `active_status = 1` plus the effective-date window and nothing else, so a draft row parked
-- in the live table with active_status = 1 resolves for real employees the instant it is
-- written - the approval gate would exist only in whichever code paths remembered to check
-- it. Parked with active_status = 0 it is indistinguishable from a rule an administrator
-- deliberately deactivated, which is the exact state 15.12 puts the legacy rows into. So the
-- proposal has to be a separate store that nothing resolves against, and approval has to be
-- a copy from it into the live store. That is what these tables are.
--
-- INERT UNTIL APPROVED
-- No resolver, service or route reads any table below. The proposal builder
-- (backend/src/modules/wfm/attendance-rule-migration-proposal.ts) is a pure function that
-- reads no database at all; a later phase supplies the reader that persists its output here
-- and the approval action that copies an approved run into attendance_source_rule /
-- day_threshold_rule and deactivates the legacy rows named in
-- attendance_source_rule_proposal_source_row. Until that action runs, applying this migration
-- changes no employee's resolved Attendance_Source and no day classification.
--
-- CONVENTIONS
-- No FOREIGN KEY anywhere, matching every other table in this feature (see 1636's header -
-- migration 1500's FK to process_master is the one that blocked deploys). Every string column
-- carries an explicit COLLATE utf8mb4_unicode_ci: a bare CHARSET=utf8mb4 resolves to the
-- SERVER default, which is utf8mb4_0900_ai_ci here, and a later join against a
-- utf8mb4_unicode_ci table is a hard errno 1267 - migration 1627 exists only to repair the 49
-- tables that already hit this. CREATE TABLE IF NOT EXISTS throughout; no
-- ADD COLUMN IF NOT EXISTS (MariaDB syntax this server's MySQL 8.0.42 rejects at parse time,
-- which is what got 1064 dropped and left 1110 unlisted).
--
-- NAMING NOTE
-- design.md's data-model sketch gives the run table `approved_by` / `approved_at`. This file
-- uses `decided_by` / `decided_at` instead, because a rejection also has an author and a time
-- and a column named approved_* recording a rejection is a lie the next reader has no way to
-- detect. `status` says which of the two happened.
--
-- ROLLBACK
--   DROP TABLE attendance_source_rule_proposal_finding;
--   DROP TABLE attendance_source_rule_proposal_source_row;
--   DROP TABLE attendance_source_rule_proposal_day_threshold_dimension_value;
--   DROP TABLE attendance_source_rule_proposal_day_threshold;
--   DROP TABLE attendance_source_rule_proposal_rule_dimension_value;
--   DROP TABLE attendance_source_rule_proposal_rule;
--   DROP TABLE attendance_source_rule_proposal;

-- One row per proposal RUN: who built it, when, against which Pay_Month, and how it was
-- decided. applied_in_pay_month is the input criterion 15.2 dates undated legacy rows from,
-- stored on the run so a reviewer can tell a re-run in a later month from a repeat of this
-- one, and so the builder never needs a clock of its own.
CREATE TABLE IF NOT EXISTS attendance_source_rule_proposal (
  id                          CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  applied_in_pay_month        CHAR(7)      COLLATE utf8mb4_unicode_ci NOT NULL,
  status                      ENUM('draft','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  generated_by                CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  generated_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by                  CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  decided_at                  DATETIME     NULL,
  decision_note               TEXT         COLLATE utf8mb4_unicode_ci NULL,
  -- criterion 15.6 hard gate: approval is refused while the two department_master rows
  -- 'OPERATIONS' (897 active employees) and 'Operations' (148) are both still active.
  -- Defaults to 0 so a run can never arrive already cleared.
  department_merge_confirmed  TINYINT      NOT NULL DEFAULT 0,
  -- criterion 15.12: stamped by the approval action once the legacy rows named in
  -- attendance_source_rule_proposal_source_row have been deactivated. NULL means the
  -- deactivation has not happened, which is the only honest state before approval.
  source_rows_deactivated_at  DATETIME     NULL,
  created_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_asrp_status (status, generated_at)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='One Requirement 15 migration proposal run. Inert: nothing resolves against a proposal, and the rule set becomes active only through the approval action of criterion 15.11.';

-- The proposed Attendance_Source_Rules. Mirrors attendance_source_rule (1633) column for
-- column, plus the run link, the provenance flags a reviewer needs, and proposal_key.
--
-- proposal_key is the sha-256 of the rule's canonical signature (source + dimension values +
-- effective window), produced by the pure builder. It is what makes a re-run diffable: two
-- runs over unchanged legacy data produce the same keys, so a reviewer comparing them sees
-- only real changes rather than a fresh set of random identifiers.
CREATE TABLE IF NOT EXISTS attendance_source_rule_proposal_rule (
  id                   CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  proposal_id          CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  proposal_key         CHAR(64)     COLLATE utf8mb4_unicode_ci NOT NULL,
  canonical_signature  TEXT         COLLATE utf8mb4_unicode_ci NOT NULL,
  rule_name            VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  attendance_source    ENUM('dialler','biometric') COLLATE utf8mb4_unicode_ci NOT NULL,
  effective_from       DATE         NOT NULL,
  effective_to         DATE         NULL,
  change_reason        TEXT         COLLATE utf8mb4_unicode_ci NOT NULL,
  active_status        TINYINT      NOT NULL DEFAULT 1,
  -- criterion 1.10: exactly one System_Default_Rule. Derived (a default rule is one with no
  -- dimension_value children) but stored, because it is the answer to criterion 15.3's
  -- "state which source that rule carries" and a reviewer should not need a NOT EXISTS to read it.
  is_system_default    TINYINT      NOT NULL DEFAULT 0,
  -- criterion 15.2: 1 when effective_from was ASSIGNED from the run's Pay_Month rather than
  -- sourced from the legacy row. Every such legacy row also appears as a finding.
  undated_source       TINYINT      NOT NULL DEFAULT 0,
  ordinal              INT UNSIGNED NOT NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_asrpr_key (proposal_id, proposal_key),
  KEY idx_asrpr_proposal (proposal_id, ordinal)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Proposed Attendance_Source_Rules for one run (criteria 15.1, 15.2, 15.3). Same shape as attendance_source_rule so approval is a copy, not a translation.';

-- Set-valued Rule_Dimension constraints for a proposed source rule. Deliberately the same key
-- as attendance_source_rule_dimension_value - (rule_id, dimension, value_id) - so criterion
-- 2.10's set-valued constraint survives approval unchanged and the approval action is a plain
-- INSERT ... SELECT. Zero rows for a dimension means unconstrained; one row is the ordinary
-- single-value case; two or more is the duplicate-master-row case ('OPERATIONS'/'Operations').
-- No proposal_id column here: rule_id already identifies the run through the parent, and a
-- second copy of that link is state that can drift.
CREATE TABLE IF NOT EXISTS attendance_source_rule_proposal_rule_dimension_value (
  rule_id   CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  dimension ENUM('cost_centre','process','branch','department','designation','employment_profile') COLLATE utf8mb4_unicode_ci NOT NULL,
  value_id  VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (rule_id, dimension, value_id),
  KEY idx_asrprdv_rule (rule_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Set-valued Rule_Dimension constraints for a proposed Attendance_Source_Rule, same key as attendance_source_rule_dimension_value (criterion 2.10).';

-- The proposed Day_Threshold_Rules (criterion 15.8). Mirrors day_threshold_rule (1634).
-- is_unconstrained_default marks the one row criterion 1.15 requires, seeded from
-- attendance_feature_config rather than from any attendance_rule_config row.
CREATE TABLE IF NOT EXISTS attendance_source_rule_proposal_day_threshold (
  id                        CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  proposal_id               CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  proposal_key              CHAR(64)     COLLATE utf8mb4_unicode_ci NOT NULL,
  canonical_signature       TEXT         COLLATE utf8mb4_unicode_ci NOT NULL,
  rule_name                 VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  full_day_minutes          SMALLINT UNSIGNED NOT NULL,
  half_day_minutes          SMALLINT UNSIGNED NOT NULL,
  grace_minutes             SMALLINT UNSIGNED NOT NULL,
  effective_from            DATE         NOT NULL,
  effective_to              DATE         NULL,
  change_reason             TEXT         COLLATE utf8mb4_unicode_ci NOT NULL,
  active_status             TINYINT      NOT NULL DEFAULT 1,
  is_unconstrained_default  TINYINT      NOT NULL DEFAULT 0,
  undated_source            TINYINT      NOT NULL DEFAULT 0,
  ordinal                   INT UNSIGNED NOT NULL,
  created_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_asrpdt_key (proposal_id, proposal_key),
  KEY idx_asrpdt_proposal (proposal_id, ordinal)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Proposed Day_Threshold_Rules for one run (criterion 15.8). Same shape as day_threshold_rule so approval is a copy, not a translation.';

CREATE TABLE IF NOT EXISTS attendance_source_rule_proposal_day_threshold_dimension_value (
  rule_id   CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  dimension ENUM('cost_centre','process','branch','department','designation','employment_profile') COLLATE utf8mb4_unicode_ci NOT NULL,
  value_id  VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (rule_id, dimension, value_id),
  KEY idx_asrpdtdv_rule (rule_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Set-valued Rule_Dimension constraints for a proposed Day_Threshold_Rule, same key as day_threshold_rule_dimension_value.';

-- Provenance, and the driver for criterion 15.12's deactivation.
--
-- This is a child table rather than a source_row_ref column on the proposal because the
-- mapping is many-to-one in both directions that matter: criterion 15.3 collapses the two
-- unconstrained attendance_rule_config rows into ONE System_Default_Rule, and criterion 15.8
-- deduplicates identical threshold combinations across the 30 rows. A single-value column
-- would have to discard every contributor but one, which loses exactly the rows 15.12 needs
-- to deactivate and exactly the provenance a reviewer needs to see.
--
-- SELECT DISTINCT legacy_table, legacy_row_id WHERE proposal_id = ? is the complete
-- deactivation list for an approved run.
CREATE TABLE IF NOT EXISTS attendance_source_rule_proposal_source_row (
  proposal_id   CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  target_kind   ENUM('source_rule','day_threshold') COLLATE utf8mb4_unicode_ci NOT NULL,
  target_id     CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  legacy_table  ENUM('attendance_rule_config','apr_eligibility_config','attendance_feature_config') COLLATE utf8mb4_unicode_ci NOT NULL,
  legacy_row_id VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (proposal_id, target_kind, target_id, legacy_table, legacy_row_id),
  KEY idx_asrpsr_legacy (proposal_id, legacy_table, legacy_row_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Which legacy rows each proposed rule came from (criterion 15.1 provenance) and, on approval, which rows must be deactivated rather than deleted (criterion 15.12).';

-- The lists criteria 15.2 and 15.3 require, plus the disclosures the builder must not bury in
-- code: which source apr_eligibility_config rows were assigned, which of the two
-- attendance_feature_config half-day floors the unconstrained Day_Threshold_Rule took, and
-- any scope where two legacy rows disagree on Attendance_Source.
--
-- finding_kind is the machine-readable handle; detail is the sentence a reviewer reads;
-- detail_json carries the named inputs (rule ids, sources, values) so a screen can render
-- them without parsing prose. severity is what the approval action of criterion 15.11 gates
-- on: 'blocking' means the proposal is not approvable as it stands, 'decision_required' means
-- a human must confirm the choice the builder made rather than discover it later.
CREATE TABLE IF NOT EXISTS attendance_source_rule_proposal_finding (
  id            CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  proposal_id   CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  finding_kind  VARCHAR(64)  COLLATE utf8mb4_unicode_ci NOT NULL,
  severity      ENUM('info','decision_required','blocking') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'info',
  subject_ref   VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
  detail        TEXT         COLLATE utf8mb4_unicode_ci NOT NULL,
  detail_json   JSON         NULL,
  ordinal       INT UNSIGNED NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_asrpf_proposal (proposal_id, ordinal),
  KEY idx_asrpf_severity (proposal_id, severity, finding_kind)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Findings for one proposal run: the undated-row list (15.2), the unconstrained-rule resolution (15.3), the seeded default thresholds (15.8) and any scope where two legacy rows disagree on source.';

SELECT 'Migration 1641 applied: attendance rule migration proposal store (7 tables, inert until approved)' AS migration_status;
