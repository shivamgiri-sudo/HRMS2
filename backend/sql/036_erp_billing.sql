USE mas_hrms;

CREATE TABLE IF NOT EXISTS billing_unit (
  id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id      CHAR(36) NOT NULL,
  contract_id     CHAR(36) COMMENT 'Links to contract_master',
  billing_type    ENUM('per_seat','per_transaction','fixed_monthly','revenue_share') NOT NULL DEFAULT 'per_seat',
  rate            DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency        VARCHAR(3) NOT NULL DEFAULT 'INR',
  billing_period  ENUM('weekly','monthly','quarterly') NOT NULL DEFAULT 'monthly',
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_bu_process (process_id),
  INDEX idx_bu_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS billing_invoice (
  id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  invoice_ref     VARCHAR(32) NOT NULL UNIQUE,
  process_id      CHAR(36) NOT NULL,
  billing_unit_id CHAR(36),
  period_from     DATE NOT NULL,
  period_to       DATE NOT NULL,
  billable_units  DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'Seats/transactions/hours',
  rate            DECIMAL(10,2) NOT NULL,
  gross_amount    DECIMAL(12,2) NOT NULL,
  adjustments     DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'SLA credits, penalties',
  net_amount      DECIMAL(12,2) NOT NULL,
  gst_amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount    DECIMAL(12,2) NOT NULL,
  status          ENUM('draft','sent','acknowledged','paid','disputed') NOT NULL DEFAULT 'draft',
  notes           TEXT,
  prepared_by     CHAR(36),
  sent_at         DATETIME,
  paid_at         DATETIME,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_inv_process (process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS expense_policy (
  id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  category        ENUM('travel','accommodation','meals','transport','communication','office','other') NOT NULL,
  max_amount      DECIMAL(10,2) NOT NULL,
  requires_receipt_above DECIMAL(10,2) DEFAULT 0,
  approval_required TINYINT(1) NOT NULL DEFAULT 1,
  notes           TEXT,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exp_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default expense policies
INSERT IGNORE INTO expense_policy (id, category, max_amount, requires_receipt_above, approval_required) VALUES
  (UUID(), 'travel', 5000, 500, 1),
  (UUID(), 'accommodation', 3000, 1000, 1),
  (UUID(), 'meals', 500, 200, 0),
  (UUID(), 'transport', 1000, 300, 1),
  (UUID(), 'communication', 500, 0, 0),
  (UUID(), 'office', 2000, 500, 1),
  (UUID(), 'other', 1000, 500, 1);
