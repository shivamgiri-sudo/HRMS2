-- 1061_finance_budget_topup_request.sql
-- Budget increase ("top-up") requests: the formal path to raise an already-approved
-- budget line's headroom, gated by the same branch_head -> finance_head chain used
-- everywhere else in this module. Additive; does not touch finance_budget_header/line.
--
-- Why this exists: GRN overspend was already hard-blocked (budget-consumption.service.ts),
-- but there was no way to ask for more against a specific head/sub-head short of Finance
-- re-running the entire budget through draft -> submitted -> ... -> active again. This
-- table is the missing "request more, get it approved, then the blocked GRN can proceed"
-- entity.

CREATE TABLE IF NOT EXISTS finance_budget_topup_request (
  id CHAR(36) PRIMARY KEY,
  budget_line_id CHAR(36) NOT NULL,
  budget_id CHAR(36) NOT NULL,
  requested_by CHAR(36) NOT NULL,
  requested_amount DECIMAL(18,2) NOT NULL,
  requested_quantity DECIMAL(18,4) NOT NULL,
  reason TEXT NOT NULL,
  status ENUM(
    'submitted','branch_head_approved','finance_head_approved','rejected','applied'
  ) NOT NULL DEFAULT 'submitted',
  branch_head_reviewed_by CHAR(36) NULL,
  branch_head_reviewed_at DATETIME NULL,
  branch_head_review_note TEXT NULL,
  finance_head_reviewed_by CHAR(36) NULL,
  finance_head_reviewed_at DATETIME NULL,
  finance_head_review_note TEXT NULL,
  rejection_reason TEXT NULL,
  applied_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_budget_topup_line
    FOREIGN KEY (budget_line_id) REFERENCES finance_budget_line(id) ON DELETE CASCADE,
  CONSTRAINT fk_budget_topup_header
    FOREIGN KEY (budget_id) REFERENCES finance_budget_header(id) ON DELETE CASCADE,
  INDEX idx_budget_topup_line (budget_line_id),
  INDEX idx_budget_topup_budget (budget_id, status),
  INDEX idx_budget_topup_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1061_finance_budget_topup_request.sql applied' AS migration_status;
