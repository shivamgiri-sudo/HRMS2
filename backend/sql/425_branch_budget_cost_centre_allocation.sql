-- 425_branch_budget_cost_centre_allocation.sql
-- Branch Budget foundation (PR 2): normalized cost-centre allocation for branch-planned
-- budget lines, plus the monthly driver inputs (planned headcount, revenue rate per head)
-- that manpower/revenue sharing methods need. Additive and forward-only.
--
-- planning_level defaults to 'cost_centre' so every existing finance_budget_line row keeps
-- today's exact behavior (one line = one cost_centre_id/process_id, no split). Setting a line
-- to planning_level = 'branch' is the new capability: its computed amount is split across the
-- branch's active cost centres via the existing allocation_driver column (now actually acted
-- on, not just stored) and persisted into finance_budget_line_allocation.
--
-- Rollback (manual, if ever needed before this ships to any environment):
--   DROP TABLE IF EXISTS finance_budget_line_allocation;
--   DROP TABLE IF EXISTS finance_cost_centre_monthly_driver;
--   ALTER TABLE finance_budget_line DROP COLUMN planning_level;

ALTER TABLE finance_budget_line
  ADD COLUMN planning_level ENUM('branch','cost_centre') NOT NULL DEFAULT 'cost_centre'
    AFTER cost_centre_id;

CREATE TABLE IF NOT EXISTS finance_budget_line_allocation (
  id                      CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  budget_line_id          CHAR(36) NOT NULL,
  cost_centre_id          CHAR(36) NOT NULL,
  driver_value            DECIMAL(18,4) NOT NULL DEFAULT 0,
  allocation_percentage   DECIMAL(9,6) NOT NULL DEFAULT 0,
  planned_unit            DECIMAL(18,4) NOT NULL DEFAULT 0,
  base_amount             DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_amount              DECIMAL(18,2) NOT NULL DEFAULT 0,
  gross_amount            DECIMAL(18,2) NOT NULL DEFAULT 0,
  pnl_cost_amount         DECIMAL(18,2) NOT NULL DEFAULT 0,
  rounding_adjustment     DECIMAL(18,2) NOT NULL DEFAULT 0,
  entry_source            ENUM('calculated','manual') NOT NULL DEFAULT 'calculated',
  is_manual_override      TINYINT(1) NOT NULL DEFAULT 0,
  override_reason         TEXT NULL,
  created_by              CHAR(36) NULL,
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by              CHAR(36) NULL,
  updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_budget_line_allocation (budget_line_id, cost_centre_id),
  INDEX idx_budget_line_allocation_line (budget_line_id),
  INDEX idx_budget_line_allocation_cc (cost_centre_id),
  CONSTRAINT fk_budget_line_allocation_line
    FOREIGN KEY (budget_line_id) REFERENCES finance_budget_line(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_cost_centre_monthly_driver (
  id                      CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_id               CHAR(36) NOT NULL,
  period_code             CHAR(7) NOT NULL,
  cost_centre_id          CHAR(36) NOT NULL,
  planned_headcount       DECIMAL(10,2) NOT NULL DEFAULT 0,
  revenue_rate_per_head    DECIMAL(18,2) NOT NULL DEFAULT 0,
  remarks                 TEXT NULL,
  status                  ENUM('draft','approved') NOT NULL DEFAULT 'draft',
  updated_by              CHAR(36) NULL,
  updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cc_monthly_driver (branch_id, period_code, cost_centre_id),
  INDEX idx_cc_monthly_driver_branch_period (branch_id, period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
