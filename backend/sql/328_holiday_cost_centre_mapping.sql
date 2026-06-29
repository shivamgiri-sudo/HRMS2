-- Migration 328: Holiday cost-centre, designation, and work-policy tables
-- Extends holiday scoping beyond branch level (process / cost centre / designation).
-- All tables are new additions; leave_holiday_master is NOT modified.
-- Safe to apply multiple times (IF NOT EXISTS + INSERT IGNORE).

-- ── 1. holiday_cost_centre_mapping ───────────────────────────────────────────
-- Maps a holiday to specific branch/process/cost_centre/department combinations.
-- NULL in a scope column means "not scoped to that level" (broader applicability).
-- If NO rows exist for a holiday → applies to everyone (national/branch default).
CREATE TABLE IF NOT EXISTS holiday_cost_centre_mapping (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  holiday_id     CHAR(36)     NOT NULL,
  branch_id      CHAR(36)     NULL,
  process_id     CHAR(36)     NULL,
  cost_centre_id CHAR(36)     NULL,
  department_id  CHAR(36)     NULL,
  is_mandatory   TINYINT(1)   NOT NULL DEFAULT 0
                 COMMENT '1 = employees in this scope MUST work (not a holiday for them)',
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_by     CHAR(36)     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (holiday_id) REFERENCES leave_holiday_master(id) ON DELETE CASCADE,
  INDEX idx_hccm_holiday  (holiday_id),
  INDEX idx_hccm_process  (process_id),
  INDEX idx_hccm_cc       (cost_centre_id)
);

-- ── 2. holiday_designation_mapping ───────────────────────────────────────────
-- Maps a holiday to specific designation eligibility.
-- If NO rows exist for a holiday → all designations are eligible.
CREATE TABLE IF NOT EXISTS holiday_designation_mapping (
  id              CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  holiday_id      CHAR(36)  NOT NULL,
  designation_id  CHAR(36)  NOT NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_by      CHAR(36)  NULL,
  created_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (holiday_id) REFERENCES leave_holiday_master(id) ON DELETE CASCADE,
  UNIQUE KEY uq_holiday_desig (holiday_id, designation_id),
  INDEX idx_hdm_holiday (holiday_id)
);

-- ── 3. holiday_work_policy_master ─────────────────────────────────────────────
-- Defines payout rules for working on a holiday per scope.
-- payout_basis: NET_DAILY (MAS default), GROSS_DAILY, BASIC_DAILY, FIXED_AMOUNT
-- payout_type:  controls extra_multiplier applied to the daily rate
CREATE TABLE IF NOT EXISTS holiday_work_policy_master (
  id                              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  policy_name                     VARCHAR(100)  NOT NULL,
  branch_id                       CHAR(36)      NULL,
  process_id                      CHAR(36)      NULL,
  cost_centre_id                  CHAR(36)      NULL,
  department_id                   CHAR(36)      NULL,
  payout_basis                    ENUM('NET_DAILY','GROSS_DAILY','BASIC_DAILY','FIXED_AMOUNT')
                                  NOT NULL DEFAULT 'NET_DAILY',
  payout_type                     ENUM('NO_EXTRA_PAY','HALF_DAY_EXTRA','DOUBLE_PAY_TOTAL',
                                       'EXTRA_1X','EXTRA_1_5X','EXTRA_2X',
                                       'COMP_OFF_ONLY','FIXED_AMOUNT')
                                  NOT NULL DEFAULT 'DOUBLE_PAY_TOTAL',
  extra_multiplier                DECIMAL(4,2)  NOT NULL DEFAULT 1.00
                                  COMMENT 'Applied to daily rate: 0=none, 0.5=half, 1.0=double, 1.5=1.5x, 2.0=2x',
  fixed_amount                    DECIMAL(10,2) NOT NULL DEFAULT 0.00
                                  COMMENT 'Used only when payout_type=FIXED_AMOUNT',
  min_hours_for_half_day          SMALLINT      NOT NULL DEFAULT 241
                                  COMMENT 'Minutes above which half-day holiday work is credited',
  min_hours_for_full_day          SMALLINT      NOT NULL DEFAULT 480
                                  COMMENT 'Minutes above which full-day holiday work is credited',
  comp_off_allowed                TINYINT(1)    NOT NULL DEFAULT 0,
  double_pay_allowed              TINYINT(1)    NOT NULL DEFAULT 1,
  payroll_head_approval_required  TINYINT(1)    NOT NULL DEFAULT 1,
  superadmin_approval_required    TINYINT(1)    NOT NULL DEFAULT 1,
  taxable                         TINYINT(1)    NOT NULL DEFAULT 1,
  pf_applicable                   TINYINT(1)    NOT NULL DEFAULT 0,
  esic_applicable                 TINYINT(1)    NOT NULL DEFAULT 0,
  payslip_visible                 TINYINT(1)    NOT NULL DEFAULT 1,
  effective_from                  DATE          NOT NULL DEFAULT (CURRENT_DATE),
  effective_to                    DATE          NULL,
  is_active                       TINYINT(1)    NOT NULL DEFAULT 1,
  created_by                      CHAR(36)      NULL,
  created_at                      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_hwpm_branch   (branch_id),
  INDEX idx_hwpm_process  (process_id),
  INDEX idx_hwpm_cc       (cost_centre_id),
  INDEX idx_hwpm_active   (is_active)
);

-- Seed a default MAS policy (NET_DAILY, DOUBLE_PAY_TOTAL, both approvals required)
INSERT IGNORE INTO holiday_work_policy_master
  (id, policy_name, payout_basis, payout_type, extra_multiplier,
   payroll_head_approval_required, superadmin_approval_required,
   taxable, payslip_visible, is_active)
VALUES
  (UUID(), 'MAS Default — Double Pay (Net Daily)',
   'NET_DAILY', 'DOUBLE_PAY_TOTAL', 1.00,
   1, 1, 1, 1, 1);

SELECT '328_holiday_cost_centre_mapping.sql applied' AS migration_status;
