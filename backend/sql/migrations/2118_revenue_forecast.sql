-- 2118_revenue_forecast.sql
--
-- Monthly revenue forecast per cost centre, and budget closure per cost centre.
--
-- OWNER REQUIREMENT (2026-10-06). By the 26th of every month each Branch Head forecasts next
-- month's revenue for every cost centre they run, line by line: seat lines (X seats at rate A and
-- Y seats at rate B), metric lines (talk-time minutes, login hours, transactions ... x rate), fixed
-- amounts, and reward / penalty. The forecast goes to BOTH the Finance Head and the Payroll Head;
-- once both approve it is OPEN and the P&L counts it as the cost centre's revenue. After invoicing
-- the Branch Head CLOSES it with the actual per line; from then on the P&L counts the closed amount
-- and the screen shows forecast vs closed. A closed forecast is reopened only by the Finance Head.
--
-- Budget side of the same accounting rule: a budget line counts in Live P&L at its full budgeted
-- amount while OPEN and at actual (reserved + consumed) once CLOSED. Closure already exists per
-- head/sub-head (finance_budget_subhead_closure, sql/1534); this adds closure per cost centre.
-- Closing a whole header is a bulk close of its heads/sub-heads and needs no table.
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS and INSERT ... ON DUPLICATE KEY UPDATE.

CREATE TABLE IF NOT EXISTS revenue_forecast (
  id CHAR(36) NOT NULL PRIMARY KEY,
  branch_id CHAR(36) NOT NULL,
  cost_centre_id CHAR(36) NOT NULL,
  period_code CHAR(7) NOT NULL,
  status ENUM('draft','submitted','approved','rejected','closed') NOT NULL DEFAULT 'draft',
  forecast_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  closed_amount DECIMAL(18,2) NULL,
  notes TEXT NULL,
  finance_head_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  finance_head_by CHAR(36) NULL,
  finance_head_at DATETIME NULL,
  finance_head_note TEXT NULL,
  payroll_head_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  payroll_head_by CHAR(36) NULL,
  payroll_head_at DATETIME NULL,
  payroll_head_note TEXT NULL,
  submitted_by CHAR(36) NULL,
  submitted_at DATETIME NULL,
  approved_at DATETIME NULL,
  closed_by CHAR(36) NULL,
  closed_at DATETIME NULL,
  close_note TEXT NULL,
  reopened_by CHAR(36) NULL,
  reopened_at DATETIME NULL,
  reopen_reason TEXT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_revenue_forecast_cc_period (cost_centre_id, period_code),
  INDEX idx_revenue_forecast_period_status (period_code, status),
  INDEX idx_revenue_forecast_branch_period (branch_id, period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS revenue_forecast_line (
  id CHAR(36) NOT NULL PRIMARY KEY,
  forecast_id CHAR(36) NOT NULL,
  line_no INT NOT NULL,
  line_type ENUM('seat','metric','fixed','reward','penalty') NOT NULL,
  description VARCHAR(255) NOT NULL,
  metric_key VARCHAR(40) NULL,
  quantity DECIMAL(18,4) NULL,
  rate DECIMAL(18,4) NULL,
  amount DECIMAL(18,2) NOT NULL,
  actual_quantity DECIMAL(18,4) NULL,
  actual_rate DECIMAL(18,4) NULL,
  actual_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_revenue_forecast_line_no (forecast_id, line_no),
  INDEX idx_revenue_forecast_line_forecast (forecast_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_budget_cost_centre_closure (
  id CHAR(36) NOT NULL PRIMARY KEY,
  budget_id CHAR(36) NOT NULL,
  cost_centre_id CHAR(36) NOT NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'closed',
  closed_by CHAR(36) NULL,
  closed_at DATETIME NULL,
  closed_reason TEXT NULL,
  reopened_by CHAR(36) NULL,
  reopened_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_budget_cc_closure (budget_id, cost_centre_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Page access. Grants mirror the API role lists in revenue-forecast.routes.ts: the Branch Head
-- (and Branch Admin) raise and close; Finance Head and Payroll Head approve; finance leadership
-- reads. Granting wider would hand someone a page whose every call 403s.
INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('FINANCE_REVENUE_FORECAST', 'Revenue Forecast', '/finance/revenue-forecast', 'finance',
   'Branch Head monthly revenue forecast per cost centre (seat, metric, fixed, reward, penalty lines), approved by Finance Head and Payroll Head, closed with actuals; the P&L counts the open forecast until it is closed.',
   1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'FINANCE_REVENUE_FORECAST', 1, 1, 1, 0, 1, 1),
  (UUID(), 'branch_head',   'FINANCE_REVENUE_FORECAST', 1, 1, 1, 0, 1, 1),
  (UUID(), 'branch_admin',  'FINANCE_REVENUE_FORECAST', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance_head',  'FINANCE_REVENUE_FORECAST', 1, 0, 1, 0, 1, 1),
  (UUID(), 'payroll_head',  'FINANCE_REVENUE_FORECAST', 1, 0, 1, 0, 1, 1),
  (UUID(), 'accounts_head', 'FINANCE_REVENUE_FORECAST', 1, 0, 0, 0, 1, 1),
  (UUID(), 'finance',       'FINANCE_REVENUE_FORECAST', 1, 0, 0, 0, 1, 1),
  (UUID(), 'ceo',           'FINANCE_REVENUE_FORECAST', 1, 0, 0, 0, 1, 1),
  (UUID(), 'coo',           'FINANCE_REVENUE_FORECAST', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);
