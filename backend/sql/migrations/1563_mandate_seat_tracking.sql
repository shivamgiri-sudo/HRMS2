-- Mandate Seat Tracking: Track approved seat count changes month-on-month
-- Supports drill-down trend analysis and revenue correlation

CREATE TABLE IF NOT EXISTS mandate_seat_history (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  cost_center VARCHAR(50) NOT NULL,
  client_name VARCHAR(200),
  process_name VARCHAR(200),
  branch_name VARCHAR(100),

  -- Monthly mandate data
  period_month CHAR(7) NOT NULL,  -- YYYY-MM format
  finance_year VARCHAR(10),       -- e.g., 2026-27

  -- Seat data
  mandate_seats INT NOT NULL DEFAULT 0,
  actual_billed_seats DECIMAL(10,2) DEFAULT 0,
  seat_rate DECIMAL(12,2) DEFAULT 0,
  monthly_revenue DECIMAL(14,2) DEFAULT 0,

  -- Change tracking
  previous_mandate_seats INT DEFAULT NULL,
  seat_change INT DEFAULT 0,
  change_reason VARCHAR(500),
  change_effective_date DATE,

  -- Source tracking
  source VARCHAR(50) DEFAULT 'db_bill',  -- db_bill, manual, import
  db_bill_invoice_id INT,

  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by CHAR(36),

  INDEX idx_cost_center_period (cost_center, period_month),
  INDEX idx_client_period (client_name, period_month),
  INDEX idx_branch_period (branch_name, period_month),
  INDEX idx_period (period_month)
);

-- View for mandate seat trends with month-over-month comparison
CREATE OR REPLACE VIEW v_mandate_seat_trend AS
SELECT
  h.cost_center,
  h.client_name,
  h.process_name,
  h.branch_name,
  h.period_month,
  h.finance_year,
  h.mandate_seats,
  h.actual_billed_seats,
  h.seat_rate,
  h.monthly_revenue,
  h.seat_change,
  CASE
    WHEN h.previous_mandate_seats > 0 THEN
      ROUND((h.mandate_seats - h.previous_mandate_seats) / h.previous_mandate_seats * 100, 1)
    ELSE NULL
  END AS seat_change_pct,
  h.change_reason,
  h.source
FROM mandate_seat_history h
ORDER BY h.client_name, h.cost_center, h.period_month;
