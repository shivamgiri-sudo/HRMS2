-- 417_budget_subhead_coverage_control.sql
-- Requires every active Finance Sub-Head to be reviewed before monthly budget submission.

CREATE TABLE IF NOT EXISTS finance_budget_subhead_status (
  id CHAR(36) PRIMARY KEY,
  budget_id CHAR(36) NOT NULL,
  expense_head_id CHAR(36) NOT NULL,
  expense_sub_head_id CHAR(36) NOT NULL,
  planning_status ENUM('planned','not_planned','not_applicable') NOT NULL,
  reason TEXT NULL,
  reviewed_by CHAR(36) NOT NULL,
  reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_budget_subhead_status (budget_id, expense_sub_head_id),
  INDEX idx_budget_subhead_budget (budget_id, planning_status),
  INDEX idx_budget_subhead_master (expense_head_id, expense_sub_head_id),
  CONSTRAINT fk_budget_subhead_budget
    FOREIGN KEY (budget_id) REFERENCES finance_budget_header(id) ON DELETE CASCADE,
  CONSTRAINT fk_budget_subhead_head
    FOREIGN KEY (expense_head_id) REFERENCES finance_expense_head_master(id),
  CONSTRAINT fk_budget_subhead_subhead
    FOREIGN KEY (expense_sub_head_id) REFERENCES finance_expense_sub_head_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
