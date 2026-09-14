-- 1633 — Attendance_Source_Rule store: the single effective-dated rule store that
-- replaces attendance_rule_config and apr_eligibility_config (requirements.md Requirement 1).
--
-- NOT YET EXECUTED. Purely additive: two new tables, nothing altered, nothing read by
-- production code yet (that wiring is a later migration). Needs owner approval before it
-- runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- Today two tables decide an employee's attendance source and disagree with no tiebreak:
-- `attendance_rule_config` (designation=4/process=2/branch=1) and `apr_eligibility_config`
-- (process=4/department=2/designation=1, no effective-dating at all), combined by
-- `processEmployee()` with a logical OR so neither store can say "no". Two active
-- unconstrained `attendance_rule_config` rows (`arc-global-001` biometric,
-- `arc-apr-ops-exec` dialler) are separated only by `ORDER BY ... LIMIT 1` with no
-- tiebreak — the same employee and date can resolve differently between two runs today.
--
-- WHAT THIS STORE IS
-- One row per Attendance_Source_Rule, keyed on up to six Rule_Dimensions (cost centre,
-- branch, process, department, designation, employment profile), each either unconstrained
-- (no child rows) or constrained to one or more values (rows in the child table — set-valued
-- constraints exist because department_master holds both 'OPERATIONS' (897 active
-- employees) and 'Operations' (148) as separate rows, and a rule keyed on one identifier
-- must still be able to reach both). Resolution is a pure in-memory function
-- (attendance-source-rule-resolver.ts), not a SQL ORDER BY ... LIMIT 1 — that is the
-- structural fix for the non-determinism above.
--
-- Exactly one System_Default_Rule (a row with zero dimension_value children) must exist at
-- all times; that invariant is enforced at the application write path (Task 4 of this plan),
-- not by this migration, because MySQL's UNIQUE index treats NULL-vs-NULL dimension columns
-- as distinct and cannot enforce "at most one fully-unconstrained row" on its own.
--
-- ROLLBACK
--   DROP TABLE attendance_source_rule_dimension_value;
--   DROP TABLE attendance_source_rule;

CREATE TABLE IF NOT EXISTS attendance_source_rule (
  id                CHAR(36)     NOT NULL,
  rule_name         VARCHAR(255) NOT NULL,
  attendance_source ENUM('dialler','biometric') NOT NULL,
  effective_from    DATE         NOT NULL,
  effective_to      DATE         NULL,
  change_reason     TEXT         NOT NULL,
  active_status     TINYINT      NOT NULL DEFAULT 1,
  created_by        CHAR(36)     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- date-window filtering is the only SQL-side filter the resolver's DB wrapper does;
  -- employee-attribute matching happens in memory (see attendance-source-rule-resolver.ts).
  KEY idx_asr_active_window (active_status, effective_from, effective_to)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Single effective-dated Attendance_Source_Rule store (requirements.md Requirement 1). Replaces attendance_rule_config + apr_eligibility_config once migration 15 approves the cutover.';

CREATE TABLE IF NOT EXISTS attendance_source_rule_dimension_value (
  rule_id   CHAR(36) NOT NULL,
  dimension ENUM('cost_centre','process','branch','department','designation','employment_profile') NOT NULL,
  value_id  VARCHAR(100) NOT NULL,
  PRIMARY KEY (rule_id, dimension, value_id),
  KEY idx_asrdv_rule (rule_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Set-valued Rule_Dimension constraints for attendance_source_rule (criterion 2.10). Zero rows for a dimension = unconstrained; one row = ordinary single-value case; two+ rows = duplicate-master-row case (e.g. OPERATIONS/Operations).';

SELECT 'Migration 1633 applied: attendance_source_rule + attendance_source_rule_dimension_value' AS migration_status;
