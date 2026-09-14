-- ============================================================
-- Migration: 450_policy_engine_config.sql
-- Purpose  : Master business policy configuration tables
--            Migrates hardcoded service constants to DB
-- ============================================================

CREATE TABLE IF NOT EXISTS business_policy_config (
  id            CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  domain_key    VARCHAR(80)    NOT NULL,
  section_key   VARCHAR(80)    NOT NULL,
  config_key    VARCHAR(120)   NOT NULL,
  value_type    ENUM('integer','decimal','percentage','string','boolean','json_array','json_object')
                               NOT NULL DEFAULT 'decimal',
  config_value  TEXT           NOT NULL,
  default_value TEXT           NOT NULL,
  label         VARCHAR(200)   NOT NULL,
  description   TEXT           NULL,
  unit          VARCHAR(30)    NULL,
  min_value     DECIMAL(14,4)  NULL,
  max_value     DECIMAL(14,4)  NULL,
  is_readonly   TINYINT(1)     NOT NULL DEFAULT 0,
  active_status TINYINT(1)     NOT NULL DEFAULT 1,
  effective_from DATE          NOT NULL DEFAULT (CURDATE()),
  updated_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    CHAR(36)       NULL,
  UNIQUE KEY uq_domain_section_key (domain_key, section_key, config_key),
  INDEX idx_domain (domain_key),
  INDEX idx_effective (effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS business_policy_config_history (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  domain_key  VARCHAR(80)  NOT NULL,
  section_key VARCHAR(80)  NOT NULL,
  config_key  VARCHAR(120) NOT NULL,
  old_value   TEXT         NULL,
  new_value   TEXT         NOT NULL,
  reason      TEXT         NULL,
  changed_by  CHAR(36)     NULL,
  changed_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bph_key (domain_key, section_key, config_key),
  INDEX idx_bph_date (changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Seed: Payroll ────────────────────────────────────────────────────────────

INSERT IGNORE INTO business_policy_config
  (domain_key, section_key, config_key, value_type, config_value, default_value, label, description, unit, min_value, max_value)
VALUES
  ('payroll', 'weekoff_eligibility', 'slabs',
   'json_array',
   '[{"from":0,"to":6,"max_weekoffs":0},{"from":7,"to":11,"max_weekoffs":1},{"from":12,"to":17,"max_weekoffs":2},{"from":18,"to":23,"max_weekoffs":3},{"from":24,"to":25,"max_weekoffs":4}]',
   '[{"from":0,"to":6,"max_weekoffs":0},{"from":7,"to":11,"max_weekoffs":1},{"from":12,"to":17,"max_weekoffs":2},{"from":18,"to":23,"max_weekoffs":3},{"from":24,"to":25,"max_weekoffs":4}]',
   'Week-off Eligibility Slabs',
   'Paid-days ranges and corresponding maximum week-offs allowed per payroll month',
   'days', NULL, NULL),

  ('payroll', 'calculation', 'default_working_days',
   'integer',
   '26',
   '26',
   'Default Working Days per Month',
   'Used when attendance data is unavailable for an employee; standard BPO working day count',
   'days', 1, 31),

  ('payroll', 'readiness', 'min_readiness_score',
   'integer',
   '80',
   '80',
   'Minimum Branch Readiness Score',
   'Readiness score threshold above which a branch is considered payroll-ready (requires attendance frozen)',
   '%', 0, 100);

-- ── Seed: Leave ──────────────────────────────────────────────────────────────

INSERT IGNORE INTO business_policy_config
  (domain_key, section_key, config_key, value_type, config_value, default_value, label, description, unit, min_value, max_value)
VALUES
  ('leave', 'cl_ml_policy', 'monthly_cap_days',
   'integer',
   '1',
   '1',
   'CL/ML Monthly Cap',
   'Maximum number of Casual Leave or Medical Leave days an employee can apply per calendar month',
   'days', 1, 5);

-- ── Seed: Operations ─────────────────────────────────────────────────────────

INSERT IGNORE INTO business_policy_config
  (domain_key, section_key, config_key, value_type, config_value, default_value, label, description, unit, min_value, max_value)
VALUES
  ('operations', 'shrinkage', 'warning_threshold_pct',
   'percentage',
   '18',
   '18',
   'Shrinkage Warning Threshold',
   'Shrinkage percentage above which a warning alert is triggered',
   '%', 0, 100),

  ('operations', 'shrinkage', 'critical_threshold_pct',
   'percentage',
   '25',
   '25',
   'Shrinkage Critical Threshold',
   'Shrinkage percentage above which a critical alert is triggered',
   '%', 0, 100),

  ('operations', 'call_quality', 'aht_benchmark_seconds',
   'integer',
   '400',
   '400',
   'AHT Benchmark',
   'Average Handle Time benchmark in seconds; calls exceeding this are flagged',
   'seconds', 30, 3600);

-- ── Seed: RTA ────────────────────────────────────────────────────────────────

INSERT IGNORE INTO business_policy_config
  (domain_key, section_key, config_key, value_type, config_value, default_value, label, description, unit, min_value, max_value)
VALUES
  ('rta', 'login_adherence', 'warning_threshold_pct',
   'percentage',
   '70',
   '70',
   'Login Adherence Warning Threshold',
   'Adherence percentage below which a warning alert fires for an agent',
   '%', 0, 100),

  ('rta', 'login_adherence', 'critical_threshold_pct',
   'percentage',
   '50',
   '50',
   'Login Adherence Critical Threshold',
   'Adherence percentage below which a critical alert fires for an agent',
   '%', 0, 100),

  ('rta', 'break_management', 'breach_alert_minutes',
   'integer',
   '60',
   '60',
   'Break Breach Alert Threshold',
   'Total break minutes above which an alert is fired for an agent in a single shift',
   'mins', 1, 480);

-- ── Seed: ATS ────────────────────────────────────────────────────────────────

INSERT IGNORE INTO business_policy_config
  (domain_key, section_key, config_key, value_type, config_value, default_value, label, description, unit, min_value, max_value)
VALUES
  ('ats', 'offer_defaults', 'notice_period_days',
   'integer',
   '30',
   '30',
   'Default Notice Period',
   'Default notice period in days pre-filled when generating an offer letter',
   'days', 0, 365),

  ('ats', 'offer_defaults', 'probation_period_months',
   'integer',
   '3',
   '3',
   'Default Probation Period',
   'Default probation period in months pre-filled when generating an offer letter',
   'months', 0, 24);

-- ── Seed: Roster ─────────────────────────────────────────────────────────────

INSERT IGNORE INTO business_policy_config
  (domain_key, section_key, config_key, value_type, config_value, default_value, label, description, unit, min_value, max_value)
VALUES
  ('roster', 'governance', 'min_acknowledgement_pct',
   'percentage',
   '80',
   '80',
   'Minimum Roster Acknowledgement %',
   'Percentage of employees that must acknowledge their roster before it is considered fully active',
   '%', 0, 100);
