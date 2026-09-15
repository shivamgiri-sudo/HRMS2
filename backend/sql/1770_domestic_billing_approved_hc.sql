-- Migration 1770: Domestic Billing — Approved Headcount Config
-- Registered 2026-09-15. Creates domestic_billing_approved_hc to store per-month,
-- per-process, per-LOB approved headcount targets and FTE rates used by the
-- Domestic Billing P&L engine. Inserts default targets matching GAS
-- DEFAULT_APPROVED_TARGETS for Sep-2026. Adds DOMESTIC_BILLING_APPROVED_HC
-- entry to upload_template_master for future bulk-upload support.
-- Safe to run multiple times (information_schema guards on CREATE TABLE;
-- INSERT IGNORE on seed rows).

-- ------------------------------------------------------------
-- 1. Create table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domestic_billing_approved_hc (
  id              VARCHAR(36)  NOT NULL,
  upload_batch_id VARCHAR(36)  NULL,
  month           VARCHAR(7)   NOT NULL COMMENT 'YYYY-MM, e.g. 2026-09',
  process         VARCHAR(100) NOT NULL COMMENT 'e.g. Bla Bli Blu, Reginald, Molecular, GS1, Finnable',
  lob             VARCHAR(100) NOT NULL COMMENT 'e.g. Inbound, Cart ABC, Abandon Cart, Email, MEmail, GS1',
  approved_headcount INT NOT NULL DEFAULT 0,
  fte_rate        DECIMAL(10,2) NOT NULL DEFAULT 35000.00 COMMENT 'Monthly per-seat rate (₹)',
  planning_rule   ENUM('SUNDAY_OFF','ALL_DAYS') NOT NULL DEFAULT 'ALL_DAYS'
                  COMMENT 'SUNDAY_OFF = Sundays excluded from working-day count',
  active          TINYINT      NOT NULL DEFAULT 1,
  data_source     VARCHAR(50)  NULL,
  source_reference VARCHAR(36) NULL,
  created_by      VARCHAR(36)  NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_month_process_lob (month, process, lob)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 2. Seed default targets for 2026-09 (INSERT IGNORE — safe to replay)
-- ------------------------------------------------------------
INSERT IGNORE INTO domestic_billing_approved_hc
  (id, month, process, lob, approved_headcount, fte_rate, planning_rule)
VALUES
  (UUID(), '2026-09', 'Bla Bli Blu', 'Inbound',      5,  42000.00, 'SUNDAY_OFF'),
  (UUID(), '2026-09', 'Bla Bli Blu', 'Cart ABC',     9,  42000.00, 'ALL_DAYS'),
  (UUID(), '2026-09', 'Finnable',    'Finnable',     25, 35000.00, 'SUNDAY_OFF'),
  (UUID(), '2026-09', 'Molecular',   'MEmail',       3,  35000.00, 'ALL_DAYS'),
  (UUID(), '2026-09', 'Reginald',    'RTO',          6,  35000.00, 'ALL_DAYS'),
  (UUID(), '2026-09', 'Reginald',    'Email',        7,  35000.00, 'ALL_DAYS'),
  (UUID(), '2026-09', 'Reginald',    'Abandon Cart', 10, 35000.00, 'ALL_DAYS'),
  (UUID(), '2026-09', 'GS1',         'GS1',          0,  35000.00, 'ALL_DAYS');

-- ------------------------------------------------------------
-- 3. Register upload template (INSERT IGNORE — safe to replay)
-- ------------------------------------------------------------
INSERT IGNORE INTO upload_template_master (template_key, label)
VALUES ('DOMESTIC_BILLING_APPROVED_HC', 'Domestic Billing — Approved Headcount Config');
