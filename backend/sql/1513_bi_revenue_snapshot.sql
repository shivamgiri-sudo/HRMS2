-- Migration 1513: BI revenue snapshot tables
-- Mirrors db_bill.dashboard_target_revenue and db_bill.dashboard_data_revenue
-- so bi.service.ts no longer live-reads db_bill for CEO/management dashboards.

CREATE TABLE IF NOT EXISTS bill_revenue_target_snapshot (
  source_id      BIGINT       NOT NULL,
  process_name   VARCHAR(200) NOT NULL,
  target_month   DATE         NOT NULL,
  target_revenue DECIMAL(15,2) NOT NULL DEFAULT 0,
  synced_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id),
  INDEX idx_month (target_month),
  INDEX idx_process (process_name(50))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bill_revenue_actual_snapshot (
  source_id      BIGINT       NOT NULL,
  process_name   VARCHAR(200) NOT NULL,
  revenue_date   DATE         NOT NULL,
  actual_revenue DECIMAL(15,2) NOT NULL DEFAULT 0,
  synced_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id),
  INDEX idx_date (revenue_date),
  INDEX idx_process (process_name(50))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
