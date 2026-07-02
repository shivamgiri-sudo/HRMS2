-- Migration 330: Payroll recalculation queue, new-joiner holiday override, config flags
-- All new tables; no existing tables modified.

-- ── 1. payroll_recalculation_queue ────────────────────────────────────────────
-- Event-driven queue. Regularization/APR upload/manual override writes here.
-- Nightly worker reads pending rows and recalculates the relevant payroll line.
CREATE TABLE IF NOT EXISTS payroll_recalculation_queue (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id        CHAR(36)     NOT NULL,
  run_id             CHAR(36)     NULL     COMMENT 'FK to salary_prep_run; NULL if run not yet created',
  payroll_month      DATE         NOT NULL COMMENT 'YYYY-MM-01',
  source_event_type  VARCHAR(50)  NOT NULL
                     COMMENT 'attendance_regularization | manual_override | apr_upload | holiday_work_approval',
  source_event_id    CHAR(36)     NULL     COMMENT 'ID of the source record (regularization.id, etc.)',
  reason             TEXT         NULL,
  status             ENUM('pending','processing','completed','failed','skipped_locked')
                     NOT NULL DEFAULT 'pending',
  requested_by       CHAR(36)     NULL,
  requested_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at       DATETIME     NULL,
  error_message      TEXT         NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  INDEX idx_prq_employee_month (employee_id, payroll_month),
  INDEX idx_prq_status         (status),
  INDEX idx_prq_run            (run_id)
);

-- ── 2. payroll_new_joiner_holiday_override ────────────────────────────────────
-- Payroll Head can manually allow holiday eligibility for a new joiner
-- in their joining month when the cutoff rule would otherwise exclude them.
CREATE TABLE IF NOT EXISTS payroll_new_joiner_holiday_override (
  id              CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)  NOT NULL,
  payroll_month   DATE      NOT NULL COMMENT 'YYYY-MM-01',
  overridden_by   CHAR(36)  NOT NULL,
  override_reason TEXT      NOT NULL,
  created_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE KEY uq_njho_emp_month (employee_id, payroll_month)
);

-- ── 3. payroll_config_flags ───────────────────────────────────────────────────
-- Feature-flag / policy table per branch+process scope.
-- NULL branch_id + NULL process_id = global default.
-- More specific scope (branch+process) overrides global.
CREATE TABLE IF NOT EXISTS payroll_config_flags (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_id     CHAR(36)      NULL,
  process_id    CHAR(36)      NULL,
  config_key    VARCHAR(100)  NOT NULL,
  config_value  VARCHAR(500)  NOT NULL,
  description   TEXT          NULL,
  updated_by    CHAR(36)      NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pcf_scope_key (branch_id, process_id, config_key),
  INDEX idx_pcf_key (config_key)
);

-- Seed global defaults (branch_id=NULL, process_id=NULL)
INSERT IGNORE INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description)
VALUES
  (UUID(), NULL, NULL, 'weekoff_earning_required',
   'true',
   'If true, week-offs must be earned: MIN(rostered, FLOOR(paid_days/rate))'),

  (UUID(), NULL, NULL, 'working_days_required_for_one_weekoff',
   '6',
   'Number of paid working days required to earn one week-off credit'),

  (UUID(), NULL, NULL, 'new_joiner_holiday_cutoff_enabled',
   'false',
   'If true, new joiners after cutoff day are not eligible for holidays in joining month'),

  (UUID(), NULL, NULL, 'new_joiner_cutoff_day',
   '15',
   'Day of month; joining after this = no holiday eligibility in joining month (when cutoff enabled)'),

  (UUID(), NULL, NULL, 'holiday_payout_basis',
   'NET_DAILY',
   'Default basis for holiday work payout: NET_DAILY | GROSS_DAILY | BASIC_DAILY | FIXED_AMOUNT'),

  (UUID(), NULL, NULL, 'holiday_double_pay_requires_superadmin',
   'true',
   'Whether DOUBLE_PAY_TOTAL / EXTRA_2X payout type requires Super Admin approval'),

  (UUID(), NULL, NULL, 'payroll_recalc_auto_on_regularization',
   'true',
   'If true, approved attendance regularization automatically queues payroll recalculation');

SELECT '330_payroll_recalc_queue_and_config.sql applied' AS migration_status;
