-- 1634 — Day_Threshold_Rule store: full_day_minutes / half_day_minutes / grace_minutes,
-- relocated out of attendance_rule_config (requirements.md criteria 1.14-1.16).
--
-- NOT YET EXECUTED. Purely additive. Needs owner approval before it runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- attendance_rule_config carries full_day_minutes/half_day_minutes/grace_minutes today, but
-- classifyMinutes() (the function that reads them) is never reached on the processEmployee()
-- path — the thresholds actually applied are hardcoded 540/480 constants plus
-- attendance_feature_config's biometric_half_day_floor_minutes=270 /
-- netlogin_half_day_floor_minutes=240. Because attendance_rule_config is retired by this
-- feature (migration 1633), these three values need a home, and design.md's decision
-- (secondary decision 1) is that they get their OWN effective-dated store resolved by the
-- same six Rule_Dimensions and the same resolver as attendance_source_rule — not carried on
-- it — because source policy and day-threshold policy change on different cadences.
--
-- Exactly one unconstrained Day_Threshold_Rule must exist at all times (criterion 1.15),
-- enforced at the application write path, same as attendance_source_rule's System_Default_Rule.
--
-- ROLLBACK
--   DROP TABLE day_threshold_rule_dimension_value;
--   DROP TABLE day_threshold_rule;

CREATE TABLE IF NOT EXISTS day_threshold_rule (
  id                CHAR(36)       NOT NULL,
  rule_name         VARCHAR(255)   NOT NULL,
  full_day_minutes  SMALLINT UNSIGNED NOT NULL,
  half_day_minutes  SMALLINT UNSIGNED NOT NULL,
  grace_minutes     SMALLINT UNSIGNED NOT NULL,
  effective_from    DATE           NOT NULL,
  effective_to      DATE           NULL,
  change_reason     TEXT           NOT NULL,
  active_status     TINYINT        NOT NULL DEFAULT 1,
  created_by        CHAR(36)       NULL,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME       NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dtr_active_window (active_status, effective_from, effective_to)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Effective-dated day-classification thresholds (criteria 1.14-1.16), resolved by the same six Rule_Dimensions and the same resolver as attendance_source_rule.';

CREATE TABLE IF NOT EXISTS day_threshold_rule_dimension_value (
  rule_id   CHAR(36) NOT NULL,
  dimension ENUM('cost_centre','process','branch','department','designation','employment_profile') NOT NULL,
  value_id  VARCHAR(100) NOT NULL,
  PRIMARY KEY (rule_id, dimension, value_id),
  KEY idx_dtrdv_rule (rule_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Set-valued Rule_Dimension constraints for day_threshold_rule, same shape as attendance_source_rule_dimension_value.';

SELECT 'Migration 1634 applied: day_threshold_rule + day_threshold_rule_dimension_value' AS migration_status;
