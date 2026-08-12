-- Phase 1: Core AP controls — TDS on payments, HSN/SAC codes, advance payments, debit notes
-- Safe: all additive. No existing columns altered, no data removed.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-A  TDS columns on vendor_payment_transaction (per-installment)
-- ─────────────────────────────────────────────────────────────────────────────
SET @exists_tds = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'vendor_payment_transaction'
     AND COLUMN_NAME  = 'tds_amount'
);
SET @sql = IF(@exists_tds = 0,
  'ALTER TABLE vendor_payment_transaction
     ADD COLUMN tds_amount   DECIMAL(18,2) NOT NULL DEFAULT 0    AFTER amount,
     ADD COLUMN tds_section  VARCHAR(20)   NULL                  AFTER tds_amount,
     ADD COLUMN net_amount   DECIMAL(18,2) NOT NULL DEFAULT 0    AFTER tds_section',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-A  TDS aggregate on vendor_payment_tracking
-- ─────────────────────────────────────────────────────────────────────────────
SET @exists_tds2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'vendor_payment_tracking'
     AND COLUMN_NAME  = 'tds_deducted_amount'
);
SET @sql = IF(@exists_tds2 = 0,
  'ALTER TABLE vendor_payment_tracking
     ADD COLUMN tds_deducted_amount DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER paid_amount',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-D  HSN / SAC code on grn_invoice_component
-- ─────────────────────────────────────────────────────────────────────────────
SET @exists_hsn = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'grn_invoice_component'
     AND COLUMN_NAME  = 'hsn_sac_code'
);
SET @sql = IF(@exists_hsn = 0,
  'ALTER TABLE grn_invoice_component
     ADD COLUMN hsn_sac_code VARCHAR(10) NULL AFTER gst_rate',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-E  split_method: allow 'custom' in grn_period_allocation
--      The ENUM was originally 'equal' only; extend it.
-- ─────────────────────────────────────────────────────────────────────────────
SET @sm_type = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'grn_period_allocation'
     AND COLUMN_NAME  = 'split_method'
  LIMIT 1
);
SET @sql = IF(LOCATE('custom', @sm_type) = 0 AND @sm_type IS NOT NULL,
  "ALTER TABLE grn_period_allocation
     MODIFY COLUMN split_method ENUM('equal','custom','manual') NOT NULL DEFAULT 'equal'",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-B  Vendor advance payment tracking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_advance_payment (
  id              CHAR(36)       NOT NULL PRIMARY KEY,
  vendor_id       CHAR(36)       NOT NULL,
  branch_id       CHAR(36)       NOT NULL,
  advance_amount  DECIMAL(18,2)  NOT NULL,
  purpose         TEXT           NULL,
  payment_date    DATE           NULL,
  payment_mode    VARCHAR(30)    NULL,
  transaction_id  VARCHAR(100)   NULL,
  status          ENUM('open','partially_adjusted','fully_adjusted','reversed')
                                 NOT NULL DEFAULT 'open',
  adjusted_amount DECIMAL(18,2)  NOT NULL DEFAULT 0,
  remarks         TEXT           NULL,
  raised_by       CHAR(36)       NOT NULL,
  approved_by     CHAR(36)       NULL,
  approved_at     DATETIME       NULL,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by      CHAR(36)       NOT NULL,
  updated_by      CHAR(36)       NULL,
  INDEX idx_vap_vendor (vendor_id),
  INDEX idx_vap_branch (branch_id),
  INDEX idx_vap_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_advance_adjustment (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  advance_id       CHAR(36)      NOT NULL,
  grn_id           CHAR(36)      NOT NULL,
  adjusted_amount  DECIMAL(18,2) NOT NULL,
  adjusted_by      CHAR(36)      NOT NULL,
  adjusted_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vaa_advance (advance_id),
  INDEX idx_vaa_grn     (grn_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-C  Vendor debit note
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_debit_note (
  id                      CHAR(36)     NOT NULL PRIMARY KEY,
  dn_number               VARCHAR(60)  NOT NULL,
  grn_id                  CHAR(36)     NOT NULL,
  vendor_id               CHAR(36)     NOT NULL,
  branch_id               CHAR(36)     NOT NULL,
  dn_date                 DATE         NOT NULL,
  reason                  ENUM('quality_deficiency','short_supply',
                               'price_difference','returns','other')
                                        NOT NULL DEFAULT 'other',
  amount                  DECIMAL(18,2) NOT NULL,
  gst_amount              DECIMAL(18,2) NOT NULL DEFAULT 0,
  status                  ENUM('draft','approved','settled','cancelled')
                                        NOT NULL DEFAULT 'draft',
  settled_against_grn_id  CHAR(36)     NULL,
  remarks                 TEXT         NULL,
  raised_by               CHAR(36)     NOT NULL,
  approved_by             CHAR(36)     NULL,
  approved_at             DATETIME     NULL,
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by              CHAR(36)     NOT NULL,
  updated_by              CHAR(36)     NULL,
  UNIQUE KEY uq_vdn_number (dn_number),
  INDEX idx_vdn_grn    (grn_id),
  INDEX idx_vdn_vendor (vendor_id),
  INDEX idx_vdn_branch (branch_id),
  INDEX idx_vdn_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
