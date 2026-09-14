CREATE TABLE IF NOT EXISTS finance_period (
  id CHAR(36) NOT NULL PRIMARY KEY,
  period_code CHAR(7) NOT NULL,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('open', 'in_review', 'signed_off', 'locked') NOT NULL DEFAULT 'open',
  actual_cutoff_date DATE NULL,
  locked_at DATETIME NULL,
  locked_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_finance_period_code (period_code),
  KEY idx_finance_period_status (status),
  KEY idx_finance_period_year_month (period_year, period_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_billing_rate (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  contract_id CHAR(36) NULL,
  rate_type VARCHAR(80) NOT NULL,
  rate_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  unit VARCHAR(50) NOT NULL DEFAULT 'seat',
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  approved_by CHAR(36) NULL,
  approval_reference VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_process_billing_rate_process (process_id),
  KEY idx_process_billing_rate_effective (effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_monthly_plan (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  period_code CHAR(7) NOT NULL,
  contracted_seats INT NULL,
  required_productive_hc DECIMAL(10,2) NULL,
  planned_shrinkage_pct DECIMAL(6,2) NULL,
  required_roster_hc DECIMAL(10,2) NULL,
  buffer_target_pct DECIMAL(6,2) NULL,
  revenue_budget DECIMAL(14,2) NULL,
  direct_cost_budget DECIMAL(14,2) NULL,
  indirect_cost_budget DECIMAL(14,2) NULL,
  profit_budget DECIMAL(14,2) NULL,
  status ENUM('draft', 'approved', 'locked') NOT NULL DEFAULT 'draft',
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_process_monthly_plan_period (process_id, period_code),
  KEY idx_process_monthly_plan_period (period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pnl_adjustment_journal (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  period_code CHAR(7) NOT NULL,
  metric_key VARCHAR(100) NOT NULL,
  previous_value DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  adjustment_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  revised_value DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  reason TEXT NOT NULL,
  attachment_path VARCHAR(512) NULL,
  maker_user_id CHAR(36) NULL,
  checker_user_id CHAR(36) NULL,
  approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pnl_adjustment_period (period_code),
  KEY idx_pnl_adjustment_process (process_id),
  KEY idx_pnl_adjustment_status (approval_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pnl_period_signoff (
  id CHAR(36) NOT NULL PRIMARY KEY,
  finance_period_id CHAR(36) NOT NULL,
  signoff_role ENUM('finance_preparer', 'finance_head', 'accounts_head', 'ceo') NOT NULL,
  status ENUM('pending', 'signed', 'revoked') NOT NULL DEFAULT 'pending',
  signed_by CHAR(36) NULL,
  signed_at DATETIME NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_pnl_period_signoff (finance_period_id, signoff_role),
  KEY idx_pnl_period_signoff_status (status),
  CONSTRAINT fk_pnl_period_signoff_period FOREIGN KEY (finance_period_id) REFERENCES finance_period(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
