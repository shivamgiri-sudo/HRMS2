-- Migration 331: Extend salary_prep_line with holiday/weekoff/running-salary columns
-- All ADD COLUMN IF NOT EXISTS — safe to apply multiple times.
-- Does NOT modify any existing column or constraint.

SET @tbl = 'salary_prep_line';

-- ── Payable day breakdown ─────────────────────────────────────────────────────
SET @col = 'paid_working_days';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN paid_working_days DECIMAL(6,2) NOT NULL DEFAULT 0',
         ' COMMENT ''Present + approved leave + OD + training + approved regularization'''),
  'SELECT ''paid_working_days already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'eligible_weekoff_days';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN eligible_weekoff_days DECIMAL(6,2) NOT NULL DEFAULT 0',
         ' COMMENT ''MIN(rostered week-offs, FLOOR(paid_working_days / rate))'''),
  'SELECT ''eligible_weekoff_days already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'eligible_holiday_days';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN eligible_holiday_days DECIMAL(6,2) NOT NULL DEFAULT 0',
         ' COMMENT ''Holidays employee is eligible for (DOJ/CC/designation scoped)'''),
  'SELECT ''eligible_holiday_days already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'final_payable_days';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN final_payable_days DECIMAL(6,2) NOT NULL DEFAULT 0',
         ' COMMENT ''MIN(all payable days, active_calendar_days)'''),
  'SELECT ''final_payable_days already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'active_calendar_days';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN active_calendar_days SMALLINT NOT NULL DEFAULT 30',
         ' COMMENT ''Calendar days employee was active in payroll month (handles mid-month joins/exits)'''),
  'SELECT ''active_calendar_days already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'salary_start_date';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN salary_start_date DATE NULL',
         ' COMMENT ''DOJ or salary effective date used for holiday eligibility'''),
  'SELECT ''salary_start_date already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Base pay (before holiday extra) ──────────────────────────────────────────
SET @col = 'base_gross_pay';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN base_gross_pay DECIMAL(12,2) NOT NULL DEFAULT 0',
         ' COMMENT ''Gross pay before holiday extra payout'''),
  'SELECT ''base_gross_pay already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'base_net_pay';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN base_net_pay DECIMAL(12,2) NOT NULL DEFAULT 0',
         ' COMMENT ''Net pay before holiday extra payout — used for net daily rate calc'''),
  'SELECT ''base_net_pay already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Holiday work payout ────────────────────────────────────────────────────────
SET @col = 'holiday_work_extra_payout';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN holiday_work_extra_payout DECIMAL(12,2) NOT NULL DEFAULT 0',
         ' COMMENT ''Approved holiday work net extra payout (separate from payable days)'''),
  'SELECT ''holiday_work_extra_payout already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'pending_holiday_work_payout';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN pending_holiday_work_payout DECIMAL(12,2) NOT NULL DEFAULT 0',
         ' COMMENT ''Holiday work payout awaiting approval — shown separately, not in net_salary'''),
  'SELECT ''pending_holiday_work_payout already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Running month projections ─────────────────────────────────────────────────
SET @col = 'earned_salary_till_date';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN earned_salary_till_date DECIMAL(12,2) NOT NULL DEFAULT 0',
         ' COMMENT ''Confirmed salary for completed days as of last nightly run'''),
  'SELECT ''earned_salary_till_date already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'projected_salary';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN projected_salary DECIMAL(12,2) NOT NULL DEFAULT 0',
         ' COMMENT ''Best-estimate full-month salary based on roster + approved attendance'''),
  'SELECT ''projected_salary already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Recalculation flag ────────────────────────────────────────────────────────
SET @col = 'needs_recalculation';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN needs_recalculation TINYINT(1) NOT NULL DEFAULT 0',
         ' COMMENT ''1 = flagged by payroll_recalculation_queue, 0 = up-to-date'''),
  'SELECT ''needs_recalculation already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'recalculation_reason';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col) = 0,
  CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN recalculation_reason VARCHAR(200) NULL',
         ' COMMENT ''Why recalculation was requested'''),
  'SELECT ''recalculation_reason already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '331_salary_prep_line_extended_columns.sql applied' AS migration_status;
