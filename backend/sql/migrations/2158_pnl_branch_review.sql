-- 2158_pnl_branch_review.sql
--
-- Branch review of the monthly P&L (owner commitment to the CEO, 14 Oct 2026): before a branch reviews
-- its P&L, HRMS shows the reconciled figures; the Branch Head then either ACKNOWLEDGES the month or
-- raises QUERIES (revenue / people / non-people / other, optionally on one cost centre). Finance
-- resolves queries. An acknowledgement stores the figures the branch saw, so a later change is visible.
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS only. Reuses the FINANCE_PROCESS_PNL page grant.

CREATE TABLE IF NOT EXISTS pnl_branch_review (
  id CHAR(36) NOT NULL PRIMARY KEY,
  branch_id CHAR(36) NOT NULL,
  period_code CHAR(7) NOT NULL,
  acknowledged_by CHAR(36) NOT NULL,
  acknowledged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  comment TEXT NULL,
  snapshot_revenue DECIMAL(18,2) NOT NULL DEFAULT 0,
  snapshot_cost DECIMAL(18,2) NOT NULL DEFAULT 0,
  snapshot_operating_profit DECIMAL(18,2) NOT NULL DEFAULT 0,
  snapshot_mode VARCHAR(16) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pnl_branch_review (branch_id, period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pnl_branch_review_query (
  id CHAR(36) NOT NULL PRIMARY KEY,
  branch_id CHAR(36) NOT NULL,
  period_code CHAR(7) NOT NULL,
  section ENUM('revenue','people_cost','non_people_cost','other') NOT NULL,
  cost_centre_id CHAR(36) NULL,
  message TEXT NOT NULL,
  status ENUM('open','resolved') NOT NULL DEFAULT 'open',
  raised_by CHAR(36) NOT NULL,
  raised_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by CHAR(36) NULL,
  resolved_at DATETIME NULL,
  resolution_note TEXT NULL,
  INDEX idx_pnl_branch_query_branch_period (branch_id, period_code, status),
  INDEX idx_pnl_branch_query_status (status, raised_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
