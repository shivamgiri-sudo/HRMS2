-- Phases 2, 3 and 4: Budget Enhancement, Compliance, Reporting
-- Safe: all additive. No existing columns altered, no data removed.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2-C  CAPEX / OPEX classification on budget lines
-- ─────────────────────────────────────────────────────────────────────────────
SET @exists_exptype = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'finance_budget_line'
     AND COLUMN_NAME  = 'expenditure_type'
);
SET @sql = IF(@exists_exptype = 0,
  "ALTER TABLE finance_budget_line
     ADD COLUMN expenditure_type ENUM('opex','capex') NOT NULL DEFAULT 'opex' AFTER justification",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2-D  Per-line alert threshold (default 80%)
-- ─────────────────────────────────────────────────────────────────────────────
SET @exists_thresh = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'finance_budget_line'
     AND COLUMN_NAME  = 'alert_threshold_pct'
);
SET @sql = IF(@exists_thresh = 0,
  'ALTER TABLE finance_budget_line
     ADD COLUMN alert_threshold_pct TINYINT UNSIGNED NOT NULL DEFAULT 80 AFTER expenditure_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2-A  Budget transfer / virement
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_budget_transfer (
  id              CHAR(36)       NOT NULL PRIMARY KEY,
  budget_id       CHAR(36)       NOT NULL,
  from_line_id    CHAR(36)       NOT NULL,
  to_line_id      CHAR(36)       NOT NULL,
  transfer_amount DECIMAL(18,2)  NOT NULL,
  reason          TEXT           NOT NULL,
  status          ENUM('pending','approved','rejected')
                                 NOT NULL DEFAULT 'approved',
  approved_by     CHAR(36)       NULL,
  approved_at     DATETIME       NULL,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      CHAR(36)       NOT NULL,
  INDEX idx_fbt_budget   (budget_id),
  INDEX idx_fbt_from     (from_line_id),
  INDEX idx_fbt_to       (to_line_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3-C  IRN (e-invoice reference) on GRN
-- ─────────────────────────────────────────────────────────────────────────────
SET @exists_irn = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'grn_request'
     AND COLUMN_NAME  = 'irn'
);
SET @sql = IF(@exists_irn = 0,
  'ALTER TABLE grn_request
     ADD COLUMN irn        VARCHAR(100) NULL AFTER invoice_number,
     ADD COLUMN irn_ack_no VARCHAR(30)  NULL AFTER irn',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3-A  Provision / accrual GRN type
-- ─────────────────────────────────────────────────────────────────────────────
SET @grn_type_col = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'grn_request'
     AND COLUMN_NAME  = 'grn_type'
  LIMIT 1
);
SET @sql = IF(LOCATE('provision', @grn_type_col) = 0 AND @grn_type_col IS NOT NULL,
  "ALTER TABLE grn_request
     MODIFY COLUMN grn_type ENUM('vendor','imprest','provision') NOT NULL DEFAULT 'vendor'",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_rev_period = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'grn_request'
     AND COLUMN_NAME  = 'provision_reversal_period'
);
SET @sql = IF(@exists_rev_period = 0,
  'ALTER TABLE grn_request
     ADD COLUMN provision_reversal_period CHAR(7)  NULL AFTER grn_type,
     ADD COLUMN reversal_grn_id           CHAR(36) NULL AFTER provision_reversal_period',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
