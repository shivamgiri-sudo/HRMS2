-- 415_bpo_pnl_revenue_cost_model.sql
-- BPO-specific commercial, delivery, cost-classification and EBITDA model.
-- Additive and idempotent. Existing Process P&L remains the accounting backbone.

CREATE TABLE IF NOT EXISTS process_revenue_rule (
  id CHAR(36) PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  contract_id CHAR(36) NULL,
  rule_name VARCHAR(255) NOT NULL,
  billing_model ENUM(
    'per_seat','per_fte','per_productive_hour','per_login_hour','per_talk_minute',
    'per_transaction','per_mandate','per_case','fixed_monthly','outcome_based'
  ) NOT NULL,
  metric_key VARCHAR(100) NOT NULL,
  rate_amount DECIMAL(18,6) NOT NULL DEFAULT 0,
  currency_code CHAR(3) NOT NULL DEFAULT 'INR',
  fx_to_inr DECIMAL(18,6) NOT NULL DEFAULT 1,
  monthly_minimum_commitment DECIMAL(18,2) NOT NULL DEFAULT 0,
  included_units DECIMAL(18,4) NOT NULL DEFAULT 0,
  overage_rate DECIMAL(18,6) NOT NULL DEFAULT 0,
  mandated_seats DECIMAL(12,2) NULL,
  quality_gate_pct DECIMAL(7,4) NULL,
  sla_gate_pct DECIMAL(7,4) NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  status ENUM('draft','approved','inactive') NOT NULL DEFAULT 'draft',
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  approval_reference VARCHAR(255) NULL,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_revenue_rule_effective (process_id, effective_from, effective_to, status),
  INDEX idx_process_revenue_rule_contract (contract_id),
  INDEX idx_process_revenue_rule_metric (metric_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_delivery_actual (
  id CHAR(36) PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  period_code CHAR(7) NOT NULL,
  activity_date DATE NULL,
  metric_key VARCHAR(100) NOT NULL,
  planned_units DECIMAL(20,4) NOT NULL DEFAULT 0,
  delivered_units DECIMAL(20,4) NOT NULL DEFAULT 0,
  accepted_units DECIMAL(20,4) NOT NULL DEFAULT 0,
  rejected_units DECIMAL(20,4) NOT NULL DEFAULT 0,
  billable_units DECIMAL(20,4) NOT NULL DEFAULT 0,
  productive_hours DECIMAL(20,4) NOT NULL DEFAULT 0,
  login_hours DECIMAL(20,4) NOT NULL DEFAULT 0,
  talk_minutes DECIMAL(20,4) NOT NULL DEFAULT 0,
  quality_score DECIMAL(7,4) NULL,
  sla_score DECIMAL(7,4) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'manual',
  source_reference VARCHAR(255) NOT NULL DEFAULT 'manual',
  status ENUM('draft','validated','locked') NOT NULL DEFAULT 'draft',
  validated_by CHAR(36) NULL,
  validated_at DATETIME NULL,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_delivery_source (process_id, period_code, metric_key, data_source, source_reference),
  INDEX idx_process_delivery_period (period_code, process_id),
  INDEX idx_process_delivery_date (activity_date),
  INDEX idx_process_delivery_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_revenue_component (
  id CHAR(36) PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  period_code CHAR(7) NOT NULL,
  component_type ENUM(
    'base_adjustment','minimum_commitment','incentive','reward','penalty','sla_deduction',
    'credit_note','rate_true_up','fx_adjustment','ramp_up','training_revenue','one_time','other'
  ) NOT NULL,
  direction ENUM('increase','decrease') NOT NULL,
  description VARCHAR(500) NOT NULL,
  units DECIMAL(20,4) NULL,
  rate DECIMAL(18,6) NULL,
  amount_inr DECIMAL(18,2) NOT NULL,
  recognition_date DATE NULL,
  invoice_reference VARCHAR(255) NULL,
  source_reference VARCHAR(255) NULL,
  status ENUM('draft','approved','reversed') NOT NULL DEFAULT 'draft',
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  reversed_by CHAR(36) NULL,
  reversed_at DATETIME NULL,
  reversal_reason TEXT NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_revenue_component_period (process_id, period_code, status),
  INDEX idx_process_revenue_component_type (component_type),
  INDEX idx_process_revenue_component_invoice (invoice_reference)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_pnl_cost_component (
  id CHAR(36) PRIMARY KEY,
  process_id CHAR(36) NULL,
  branch_id CHAR(36) NULL,
  period_code CHAR(7) NOT NULL,
  cost_type ENUM(
    'depreciation','amortization','finance_cost','tax','other_operating_cost',
    'other_operating_income','non_operating_income','exceptional_cost','exceptional_income'
  ) NOT NULL,
  description VARCHAR(500) NOT NULL,
  amount_inr DECIMAL(18,2) NOT NULL,
  allocation_driver ENUM(
    'direct','active_hc','billable_hc','contracted_seats','revenue','floor_area',
    'device_count','equal','manual'
  ) NOT NULL DEFAULT 'direct',
  manual_allocation_pct DECIMAL(7,4) NULL,
  source_reference VARCHAR(255) NULL,
  status ENUM('draft','approved','reversed') NOT NULL DEFAULT 'draft',
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  reversed_by CHAR(36) NULL,
  reversed_at DATETIME NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_pnl_cost_period (period_code, process_id, branch_id, status),
  INDEX idx_process_pnl_cost_type (cost_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pnl_cost_classification_rule (
  id CHAR(36) PRIMARY KEY,
  rule_name VARCHAR(255) NOT NULL,
  scope_type ENUM('employee','designation','department','cost_centre','expense_head','expense_sub_head') NOT NULL,
  scope_key VARCHAR(255) NOT NULL,
  process_id CHAR(36) NULL,
  branch_id CHAR(36) NULL,
  pnl_bucket ENUM(
    'agent_salary','dsc_people','dsc_non_people','bmc_people','bmc_non_people',
    'depreciation','amortization','finance_cost','tax','capex','excluded'
  ) NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pnl_classification_scope (scope_type, scope_key, active_status),
  INDEX idx_pnl_classification_process (process_id, branch_id),
  INDEX idx_pnl_classification_effective (effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pnl_allocation_policy (
  id CHAR(36) PRIMARY KEY,
  branch_id CHAR(36) NOT NULL,
  process_id CHAR(36) NULL,
  pool_type ENUM('bmc_people','bmc_non_people','shared_service','corporate_overhead') NOT NULL,
  allocation_driver ENUM(
    'active_hc','billable_hc','contracted_seats','revenue','floor_area','device_count','equal','manual'
  ) NOT NULL DEFAULT 'active_hc',
  manual_allocation_pct DECIMAL(7,4) NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  status ENUM('draft','approved','inactive') NOT NULL DEFAULT 'draft',
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pnl_allocation_policy_effective (branch_id, pool_type, effective_from, effective_to, status),
  INDEX idx_pnl_allocation_policy_process (process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extend monthly planning with BPO delivery and cost targets.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='process_monthly_plan' AND column_name='planned_delivery_metric')=0,
  'ALTER TABLE process_monthly_plan ADD COLUMN planned_delivery_metric VARCHAR(100) NULL AFTER contracted_seats', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='process_monthly_plan' AND column_name='planned_delivery_units')=0,
  'ALTER TABLE process_monthly_plan ADD COLUMN planned_delivery_units DECIMAL(20,4) NULL AFTER planned_delivery_metric', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='process_monthly_plan' AND column_name='working_days')=0,
  'ALTER TABLE process_monthly_plan ADD COLUMN working_days DECIMAL(7,2) NULL AFTER planned_delivery_units', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='process_monthly_plan' AND column_name='standard_hours_per_day')=0,
  'ALTER TABLE process_monthly_plan ADD COLUMN standard_hours_per_day DECIMAL(7,2) NULL AFTER working_days', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='process_monthly_plan' AND column_name='agent_salary_budget')=0,
  'ALTER TABLE process_monthly_plan ADD COLUMN agent_salary_budget DECIMAL(18,2) NULL AFTER revenue_budget', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='process_monthly_plan' AND column_name='dsc_budget')=0,
  'ALTER TABLE process_monthly_plan ADD COLUMN dsc_budget DECIMAL(18,2) NULL AFTER agent_salary_budget', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='process_monthly_plan' AND column_name='bmc_budget')=0,
  'ALTER TABLE process_monthly_plan ADD COLUMN bmc_budget DECIMAL(18,2) NULL AFTER dsc_budget', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='process_monthly_plan' AND column_name='ebitda_budget')=0,
  'ALTER TABLE process_monthly_plan ADD COLUMN ebitda_budget DECIMAL(18,2) NULL AFTER profit_budget', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Expense masters can explicitly determine how GRN/vendor costs flow into P&L.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='finance_expense_sub_head_master' AND column_name='pnl_bucket')=0,
  'ALTER TABLE finance_expense_sub_head_master ADD COLUMN pnl_bucket ENUM(''dsc_non_people'',''bmc_non_people'',''depreciation'',''amortization'',''finance_cost'',''tax'',''capex'',''excluded'') NOT NULL DEFAULT ''bmc_non_people'' AFTER pnl_treatment', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='finance_expense_sub_head_master' AND column_name='capex_opex')=0,
  'ALTER TABLE finance_expense_sub_head_master ADD COLUMN capex_opex ENUM(''opex'',''capex'',''non_pnl'') NOT NULL DEFAULT ''opex'' AFTER pnl_bucket', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE finance_expense_sub_head_master
   SET pnl_bucket = CASE
     WHEN pnl_treatment = 'direct_cost' THEN 'dsc_non_people'
     WHEN pnl_treatment = 'excluded' THEN 'excluded'
     WHEN pnl_treatment = 'non_operating' THEN 'finance_cost'
     ELSE COALESCE(pnl_bucket, 'bmc_non_people')
   END;

-- Preserve accounting recognition independently of payment timing.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='pnl_bucket')=0,
  'ALTER TABLE grn_request ADD COLUMN pnl_bucket VARCHAR(60) NULL AFTER cost_class', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='recognition_period')=0,
  'ALTER TABLE grn_request ADD COLUMN recognition_period CHAR(7) NULL AFTER pnl_bucket', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='pnl_bucket')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN pnl_bucket VARCHAR(60) NULL AFTER cost_class', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='recognition_period')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN recognition_period CHAR(7) NULL AFTER pnl_bucket', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='pnl_cost_amount')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN pnl_cost_amount DECIMAL(18,2) NULL AFTER due_amount', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE grn_request
   SET pnl_bucket = COALESCE(pnl_bucket, CASE WHEN cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END),
       recognition_period = COALESCE(recognition_period, DATE_FORMAT(COALESCE(bill_date, reviewed_at, created_at), '%Y-%m'));

UPDATE vendor_payment_tracking
   SET pnl_bucket = COALESCE(pnl_bucket, CASE WHEN cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END),
       recognition_period = COALESCE(recognition_period, DATE_FORMAT(COALESCE(due_date, payment_date, created_at), '%Y-%m')),
       pnl_cost_amount = COALESCE(pnl_cost_amount, due_amount);

SELECT '415_bpo_pnl_revenue_cost_model.sql applied' AS migration_status;
