-- Migration 1215: cost_centre_reward_penalty
-- Stores manually-entered rewards and penalties per cost centre per period.
-- Many cost centres have per-client reward/penalty terms (e.g. performance bonuses,
-- SLA breach deductions) that are known only at month-end and must be entered by finance.
-- Approved rewards increase revenue (mapped to incentive_revenue PnL line).
-- Approved penalties reduce revenue (mapped to penalty PnL line).
-- Maker-checker: draft → approved/rejected (finance_preparer creates, finance_head approves).

CREATE TABLE cost_centre_reward_penalty (
  id               CHAR(36)       NOT NULL,
  cost_centre_id   CHAR(36)       NOT NULL,
  period_code      CHAR(7)        NOT NULL,
  entry_type       ENUM('reward','penalty') NOT NULL,
  description      VARCHAR(500)   NOT NULL,
  amount_inr       DECIMAL(15,2)  NOT NULL,
  client_reference VARCHAR(200)   NULL,
  approval_status  ENUM('draft','approved','rejected') NOT NULL DEFAULT 'draft',
  submitted_by     CHAR(36)       NOT NULL,
  approved_by      CHAR(36)       NULL,
  approved_at      DATETIME       NULL,
  rejection_reason TEXT           NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_ccrp_period_cc   (period_code, cost_centre_id),
  INDEX idx_ccrp_status      (approval_status),
  INDEX idx_ccrp_submitted   (submitted_by)
);
