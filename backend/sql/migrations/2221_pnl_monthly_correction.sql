-- Migration 2221: P&L monthly correction/reconciliation table
-- Registered 2026-10-16. Additive: new table pnl_monthly_correction for Finance team
-- to record manual reconciliation adjustments against P&L line items (revenue, salary,
-- grn, ebitda) by period. Each row documents the amount, reason, and author of a
-- correction so that adjustments are auditable and reversible. Revert: DROP TABLE.

CREATE TABLE IF NOT EXISTS pnl_monthly_correction (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  period_code   VARCHAR(7)   NOT NULL,                    -- 'YYYY-MM'
  company_name  VARCHAR(200) NOT NULL DEFAULT 'Mas Callnet India Pvt Ltd',
  line_item     ENUM('revenue','salary','grn','ebitda') NOT NULL,
  amount        DECIMAL(14,2) NOT NULL,                   -- rupees; positive=add, negative=subtract
  reason        VARCHAR(500) NULL,
  created_by    CHAR(36)     NULL,
  created_at    DATETIME     NOT NULL DEFAULT NOW(),
  updated_at    DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  PRIMARY KEY (id),
  KEY idx_period (period_code, company_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
