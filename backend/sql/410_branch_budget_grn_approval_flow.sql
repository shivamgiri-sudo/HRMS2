-- Branch budget, tax-aware line items and staged GRN approval foundation.

CREATE TABLE IF NOT EXISTS finance_budget_header (
  id CHAR(36) PRIMARY KEY,
  budget_number VARCHAR(60) NOT NULL UNIQUE,
  branch_id CHAR(36) NOT NULL,
  period_code CHAR(7) NOT NULL,
  financial_year VARCHAR(9) NOT NULL,
  status ENUM('draft','submitted','branch_head_approved','finance_head_approved','accounts_head_approved','active','rejected','revision_required','closed') NOT NULL DEFAULT 'draft',
  base_budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  gross_budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  submitted_by CHAR(36) NULL,
  submitted_at DATETIME NULL,
  branch_head_approved_by CHAR(36) NULL,
  branch_head_approved_at DATETIME NULL,
  finance_head_approved_by CHAR(36) NULL,
  finance_head_approved_at DATETIME NULL,
  accounts_head_approved_by CHAR(36) NULL,
  accounts_head_approved_at DATETIME NULL,
  rejection_reason TEXT NULL,
  revision_no INT NOT NULL DEFAULT 1,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_budget_branch_period (branch_id, period_code),
  INDEX idx_budget_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_budget_line (
  id CHAR(36) PRIMARY KEY,
  budget_id CHAR(36) NOT NULL,
  cost_centre_id CHAR(36) NULL,
  process_id CHAR(36) NULL,
  head VARCHAR(160) NOT NULL,
  sub_head VARCHAR(160) NULL,
  item_name VARCHAR(255) NOT NULL,
  item_description TEXT NULL,
  quantity DECIMAL(18,4) NOT NULL DEFAULT 1,
  unit VARCHAR(60) NOT NULL,
  unit_rate DECIMAL(18,4) NOT NULL DEFAULT 0,
  tax_treatment ENUM('inclusive','exclusive','exempt','reverse_charge','non_gst') NOT NULL DEFAULT 'exclusive',
  gst_rate DECIMAL(7,4) NOT NULL DEFAULT 18,
  cgst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  sgst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  igst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  base_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  gross_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  recoverable_tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  pnl_cost_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  preferred_vendor_id CHAR(36) NULL,
  allocation_driver VARCHAR(60) NULL,
  justification TEXT NOT NULL,
  reserved_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  consumed_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_budget_line_header FOREIGN KEY (budget_id) REFERENCES finance_budget_header(id) ON DELETE CASCADE,
  INDEX idx_budget_line_budget (budget_id),
  INDEX idx_budget_line_attribution (cost_centre_id, process_id),
  INDEX idx_budget_line_head (head, sub_head)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_budget_approval_log (
  id CHAR(36) PRIMARY KEY,
  budget_id CHAR(36) NOT NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(60) NULL,
  to_status VARCHAR(60) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  actor_role VARCHAR(80) NOT NULL,
  remarks TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_budget_approval_header FOREIGN KEY (budget_id) REFERENCES finance_budget_header(id) ON DELETE CASCADE,
  INDEX idx_budget_approval_budget (budget_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE grn_request
  ADD COLUMN budget_id CHAR(36) NULL AFTER financial_year,
  ADD COLUMN budget_line_id CHAR(36) NULL AFTER budget_id,
  ADD COLUMN quantity DECIMAL(18,4) NOT NULL DEFAULT 1 AFTER sub_head,
  ADD COLUMN unit VARCHAR(60) NULL AFTER quantity,
  ADD COLUMN unit_rate DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER unit,
  ADD COLUMN tax_treatment ENUM('inclusive','exclusive','exempt','reverse_charge','non_gst') NOT NULL DEFAULT 'exclusive' AFTER unit_rate,
  ADD COLUMN gst_rate DECIMAL(7,4) NOT NULL DEFAULT 18 AFTER tax_treatment,
  ADD COLUMN amount_without_tax DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER gst_rate,
  ADD COLUMN tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER amount_without_tax,
  ADD COLUMN amount_with_tax DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER tax_amount,
  ADD COLUMN branch_head_reviewed_by CHAR(36) NULL,
  ADD COLUMN branch_head_reviewed_at DATETIME NULL,
  ADD COLUMN finance_head_reviewed_by CHAR(36) NULL,
  ADD COLUMN finance_head_reviewed_at DATETIME NULL,
  ADD COLUMN accounts_payment_status ENUM('not_required','pending','scheduled','partially_paid','paid','on_hold','failed','cancelled') NOT NULL DEFAULT 'not_required';

ALTER TABLE grn_request
  MODIFY COLUMN status ENUM('draft','submitted','branch_head_approved','finance_head_approved','pending_accounts_payment','payment_scheduled','partially_paid','paid','approved','rejected','cancelled') NOT NULL DEFAULT 'draft';

CREATE INDEX idx_grn_budget_line ON grn_request (budget_line_id);
