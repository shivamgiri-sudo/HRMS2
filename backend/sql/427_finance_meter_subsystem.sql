-- 427_finance_meter_subsystem.sql
-- Branch Budget foundation (PR 7): meter master/reading subsystem feeding meter-wise sharing
-- (spec Part 10, Part 7.6). Additive, forward-only.
--
-- Rollback (manual, if ever needed before this ships to any environment):
--   DROP TABLE IF EXISTS finance_meter_reconciliation;
--   DROP TABLE IF EXISTS finance_meter_reading;
--   DROP TABLE IF EXISTS finance_meter_master;

CREATE TABLE IF NOT EXISTS finance_meter_master (
  id             CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  meter_code     VARCHAR(60) NOT NULL UNIQUE,
  meter_name     VARCHAR(160) NOT NULL,
  branch_id      CHAR(36) NOT NULL,
  cost_centre_id CHAR(36) NOT NULL,
  location       VARCHAR(255) NULL,
  reading_unit   VARCHAR(30) NOT NULL DEFAULT 'Unit',
  fixed_rate     DECIMAL(18,4) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL,
  effective_to   DATE NULL,
  active_status  TINYINT(1) NOT NULL DEFAULT 1,
  created_by     CHAR(36) NULL,
  updated_by     CHAR(36) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_meter_master_branch (branch_id),
  INDEX idx_meter_master_cost_centre (cost_centre_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_meter_reading (
  id                    CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  meter_id              CHAR(36) NOT NULL,
  period_code           CHAR(7) NOT NULL,
  opening_reading       DECIMAL(18,4) NOT NULL DEFAULT 0,
  closing_reading       DECIMAL(18,4) NOT NULL DEFAULT 0,
  consumption           DECIMAL(18,4) GENERATED ALWAYS AS (closing_reading - opening_reading) STORED,
  rate                  DECIMAL(18,4) NOT NULL DEFAULT 0,
  amount                DECIMAL(18,2) GENERATED ALWAYS AS ((closing_reading - opening_reading) * rate) STORED,
  reading_type          ENUM('actual','estimated') NOT NULL DEFAULT 'actual',
  estimation_method     VARCHAR(120) NULL,
  estimation_reason     TEXT NULL,
  evidence_reference    VARCHAR(255) NULL,
  entered_by            CHAR(36) NULL,
  entered_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by           CHAR(36) NULL,
  approved_at           DATETIME NULL,
  reconciliation_status ENUM('pending','reconciled') NOT NULL DEFAULT 'pending',
  CONSTRAINT fk_meter_reading_meter
    FOREIGN KEY (meter_id) REFERENCES finance_meter_master(id) ON DELETE CASCADE,
  UNIQUE KEY uq_meter_reading_period_type (meter_id, period_code, reading_type),
  INDEX idx_meter_reading_period (period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_meter_reconciliation (
  id                 CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  meter_id           CHAR(36) NOT NULL,
  period_code        CHAR(7) NOT NULL,
  estimated_reading_id CHAR(36) NULL,
  actual_reading_id  CHAR(36) NULL,
  estimated_amount   DECIMAL(18,2) NOT NULL DEFAULT 0,
  actual_amount      DECIMAL(18,2) NOT NULL DEFAULT 0,
  adjustment_amount  DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_by         CHAR(36) NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_meter_reconciliation_meter
    FOREIGN KEY (meter_id) REFERENCES finance_meter_master(id) ON DELETE CASCADE,
  INDEX idx_meter_reconciliation_period (period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
