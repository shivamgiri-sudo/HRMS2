-- 1635 — Threshold-kind config store (APR_Corroboration_Threshold / Variance_Tolerance /
-- Floor_Absence_Pattern_Ceiling) and the Dual_Review_Ceiling store (requirements.md
-- criteria 5.4, 6.2, 10.4, 6.10, 12.7).
--
-- NOT YET EXECUTED. Purely additive. Needs owner approval before it runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- Three thresholds are each configurable per the same six Rule_Dimensions and resolved by
-- the same candidacy/tie-break rules as attendance_source_rule (Requirement 2): the minimum
-- productive minutes that corroborate a biometric day (default 480), the minimum excess of
-- biometric over productive minutes that raises a variance (default 60), and the ceiling
-- below which a full biometric day is a Floor_Absence_Pattern occurrence (default 60). One
-- table with a threshold_kind discriminator serves all three, because they share an
-- identical dimension shape and only the applied value and its meaning differ.
--
-- Dual_Review_Ceiling is DIFFERENT: requirements.md criterion 6.10 scopes it to branch and
-- Pay_Month, not to the six Rule_Dimensions, so it gets its own two-column-key table
-- rather than being forced into the six-dimension shape above.
--
-- ROLLBACK
--   DROP TABLE attendance_dual_review_ceiling;
--   DROP TABLE attendance_threshold_rule_dimension_value;
--   DROP TABLE attendance_threshold_rule;

CREATE TABLE IF NOT EXISTS attendance_threshold_rule (
  id                CHAR(36)       NOT NULL,
  rule_name         VARCHAR(255)   NOT NULL,
  threshold_kind    ENUM('apr_corroboration','variance_tolerance','floor_absence_ceiling') NOT NULL,
  threshold_minutes SMALLINT UNSIGNED NOT NULL,
  effective_from    DATE           NOT NULL,
  effective_to      DATE           NULL,
  change_reason     TEXT           NOT NULL,
  active_status     TINYINT        NOT NULL DEFAULT 1,
  created_by        CHAR(36)       NULL,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME       NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_atr_kind_active_window (threshold_kind, active_status, effective_from, effective_to)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='APR_Corroboration_Threshold / Variance_Tolerance / Floor_Absence_Pattern_Ceiling, one store, discriminated by threshold_kind, resolved per the same six Rule_Dimensions as attendance_source_rule.';

CREATE TABLE IF NOT EXISTS attendance_threshold_rule_dimension_value (
  rule_id   CHAR(36) NOT NULL,
  dimension ENUM('cost_centre','process','branch','department','designation','employment_profile') NOT NULL,
  value_id  VARCHAR(100) NOT NULL,
  PRIMARY KEY (rule_id, dimension, value_id),
  KEY idx_atrdv_rule (rule_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Set-valued Rule_Dimension constraints for attendance_threshold_rule, same shape as attendance_source_rule_dimension_value.';

CREATE TABLE IF NOT EXISTS attendance_dual_review_ceiling (
  id            CHAR(36)     NOT NULL,
  branch_id     CHAR(36)     NULL,   -- NULL = every branch
  pay_month     VARCHAR(7)   NULL,   -- 'YYYY-MM', matches salary_prep_run.run_month; NULL = every Pay_Month
  ceiling_value SMALLINT UNSIGNED NOT NULL,
  active_status TINYINT      NOT NULL DEFAULT 1,
  created_by    CHAR(36)     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_adrc_scope (branch_id, pay_month)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Dual_Review_Ceiling (criterion 6.10), scoped to branch + Pay_Month, NOT the six Rule_Dimensions. Resolution precedence: exact (branch,pay_month) > (branch,NULL) > (NULL,pay_month) > default 100.';

SELECT 'Migration 1635 applied: attendance_threshold_rule + attendance_threshold_rule_dimension_value + attendance_dual_review_ceiling' AS migration_status;
