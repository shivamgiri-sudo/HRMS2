-- 411_branch_budget_grn_approval_flow.sql
-- Tax-aware branch budgets, quantity-aware GRN controls and staged vendor payments.
-- Additive and idempotent for the existing 310/405 finance schema.

CREATE TABLE IF NOT EXISTS finance_budget_header (
  id CHAR(36) PRIMARY KEY,
  budget_number VARCHAR(80) NOT NULL UNIQUE,
  branch_id CHAR(36) NOT NULL,
  period_code CHAR(7) NOT NULL,
  financial_year VARCHAR(10) NOT NULL,
  status ENUM(
    'draft','submitted','branch_head_approved','finance_head_approved',
    'accounts_head_approved','active','rejected','revision_required','closed'
  ) NOT NULL DEFAULT 'draft',
  base_budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  gross_budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  pnl_budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
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
  UNIQUE KEY uq_budget_branch_period (branch_id, period_code),
  INDEX idx_budget_branch_period (branch_id, period_code),
  INDEX idx_budget_status (status),
  INDEX idx_budget_fy (financial_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_budget_line (
  id CHAR(36) PRIMARY KEY,
  budget_id CHAR(36) NOT NULL,
  cost_centre_id CHAR(36) NULL,
  process_id CHAR(36) NULL,
  head VARCHAR(255) NOT NULL,
  sub_head VARCHAR(255) NULL,
  item_name VARCHAR(255) NOT NULL,
  item_description TEXT NULL,
  quantity DECIMAL(18,4) NOT NULL DEFAULT 1,
  unit VARCHAR(60) NOT NULL,
  unit_rate DECIMAL(18,4) NOT NULL DEFAULT 0,
  tax_treatment ENUM('inclusive','exclusive','exempt','reverse_charge','non_gst') NOT NULL DEFAULT 'exclusive',
  gst_rate DECIMAL(7,4) NOT NULL DEFAULT 18,
  gst_type ENUM('cgst_sgst','igst','none') NOT NULL DEFAULT 'cgst_sgst',
  recoverable_tax_pct DECIMAL(7,4) NOT NULL DEFAULT 100,
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
  reserved_quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
  consumed_quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
  reserved_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  consumed_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_budget_line_header
    FOREIGN KEY (budget_id) REFERENCES finance_budget_header(id) ON DELETE CASCADE,
  INDEX idx_budget_line_budget (budget_id),
  INDEX idx_budget_line_attribution (cost_centre_id, process_id),
  INDEX idx_budget_line_head (head, sub_head),
  INDEX idx_budget_line_vendor (preferred_vendor_id),
  INDEX idx_budget_line_available (budget_id, reserved_amount, consumed_amount)
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
  CONSTRAINT fk_budget_approval_header
    FOREIGN KEY (budget_id) REFERENCES finance_budget_header(id) ON DELETE CASCADE,
  INDEX idx_budget_approval_budget (budget_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Complete a table created by an earlier partial execution of this migration.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='finance_budget_line'
      AND column_name='reserved_quantity')=0,
  'ALTER TABLE finance_budget_line ADD COLUMN reserved_quantity DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER justification',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='finance_budget_line'
      AND column_name='consumed_quantity')=0,
  'ALTER TABLE finance_budget_line ADD COLUMN consumed_quantity DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER reserved_quantity',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @duplicate_budget_count = (
  SELECT COUNT(*) FROM (
    SELECT branch_id, period_code
    FROM finance_budget_header
    GROUP BY branch_id, period_code
    HAVING COUNT(*) > 1
  ) duplicate_periods
);
SET @sql = IF(
  @duplicate_budget_count = 0
  AND (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema=DATABASE() AND table_name='finance_budget_header'
      AND index_name='uq_budget_branch_period')=0,
  'ALTER TABLE finance_budget_header ADD UNIQUE KEY uq_budget_branch_period (branch_id, period_code)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Extend existing GRN table one guarded column at a time.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='budget_id')=0,
  'ALTER TABLE grn_request ADD COLUMN budget_id CHAR(36) NULL AFTER financial_year', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='budget_line_id')=0,
  'ALTER TABLE grn_request ADD COLUMN budget_line_id CHAR(36) NULL AFTER budget_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='quantity')=0,
  'ALTER TABLE grn_request ADD COLUMN quantity DECIMAL(18,4) NOT NULL DEFAULT 1 AFTER sub_head', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='unit')=0,
  'ALTER TABLE grn_request ADD COLUMN unit VARCHAR(60) NULL AFTER quantity', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='unit_rate')=0,
  'ALTER TABLE grn_request ADD COLUMN unit_rate DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER unit', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='tax_treatment')=0,
  'ALTER TABLE grn_request ADD COLUMN tax_treatment ENUM(''inclusive'',''exclusive'',''exempt'',''reverse_charge'',''non_gst'') NOT NULL DEFAULT ''exclusive'' AFTER unit_rate', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='gst_rate')=0,
  'ALTER TABLE grn_request ADD COLUMN gst_rate DECIMAL(7,4) NOT NULL DEFAULT 18 AFTER tax_treatment', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='gst_type')=0,
  'ALTER TABLE grn_request ADD COLUMN gst_type ENUM(''cgst_sgst'',''igst'',''none'') NOT NULL DEFAULT ''cgst_sgst'' AFTER gst_rate', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='recoverable_tax_pct')=0,
  'ALTER TABLE grn_request ADD COLUMN recoverable_tax_pct DECIMAL(7,4) NOT NULL DEFAULT 100 AFTER gst_type', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='amount_without_tax')=0,
  'ALTER TABLE grn_request ADD COLUMN amount_without_tax DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER recoverable_tax_pct', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='tax_amount')=0,
  'ALTER TABLE grn_request ADD COLUMN tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER amount_without_tax', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='amount_with_tax')=0,
  'ALTER TABLE grn_request ADD COLUMN amount_with_tax DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER tax_amount', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='pnl_cost_amount')=0,
  'ALTER TABLE grn_request ADD COLUMN pnl_cost_amount DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER amount_with_tax', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='branch_head_reviewed_by')=0,
  'ALTER TABLE grn_request ADD COLUMN branch_head_reviewed_by CHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='branch_head_reviewed_at')=0,
  'ALTER TABLE grn_request ADD COLUMN branch_head_reviewed_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='branch_head_review_note')=0,
  'ALTER TABLE grn_request ADD COLUMN branch_head_review_note TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='finance_head_reviewed_by')=0,
  'ALTER TABLE grn_request ADD COLUMN finance_head_reviewed_by CHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='finance_head_reviewed_at')=0,
  'ALTER TABLE grn_request ADD COLUMN finance_head_reviewed_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='finance_head_review_note')=0,
  'ALTER TABLE grn_request ADD COLUMN finance_head_review_note TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='accounts_payment_status')=0,
  'ALTER TABLE grn_request ADD COLUMN accounts_payment_status ENUM(''not_required'',''pending'',''scheduled'',''partially_paid'',''paid'',''on_hold'',''failed'',''cancelled'') NOT NULL DEFAULT ''not_required''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE grn_request
  MODIFY COLUMN status ENUM(
    'draft','submitted','branch_head_approved','finance_head_approved',
    'pending_accounts_payment','payment_scheduled','partially_paid','paid',
    'approved','rejected','cancelled'
  ) NOT NULL DEFAULT 'draft';

SET @sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='grn_request' AND index_name='idx_grn_budget_line')=0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_budget_line (budget_line_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='grn_request' AND index_name='idx_grn_budget')=0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_budget (budget_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Extend existing vendor payment table without replacing its legacy status values.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='budget_id')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN budget_id CHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='budget_line_id')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN budget_line_id CHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='amount_without_tax')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN amount_without_tax DECIMAL(18,2) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='tax_amount')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='amount_with_tax')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN amount_with_tax DECIMAL(18,2) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Preserve legacy rows as tax-neutral values until specifically reclassified.
UPDATE grn_request
   SET amount_without_tax = CASE WHEN amount_without_tax = 0 THEN amount ELSE amount_without_tax END,
       amount_with_tax = CASE WHEN amount_with_tax = 0 THEN amount ELSE amount_with_tax END,
       pnl_cost_amount = CASE WHEN pnl_cost_amount = 0 THEN amount ELSE pnl_cost_amount END
 WHERE amount > 0;

UPDATE vendor_payment_tracking v
JOIN grn_request g ON g.id = v.grn_request_id
   SET v.budget_id = COALESCE(v.budget_id, g.budget_id),
       v.budget_line_id = COALESCE(v.budget_line_id, g.budget_line_id),
       v.amount_without_tax = CASE
         WHEN v.amount_without_tax = 0 THEN COALESCE(NULLIF(g.amount_without_tax,0), g.amount)
         ELSE v.amount_without_tax END,
       v.tax_amount = CASE WHEN v.tax_amount = 0 THEN COALESCE(g.tax_amount,0) ELSE v.tax_amount END,
       v.amount_with_tax = CASE
         WHEN v.amount_with_tax = 0 THEN COALESCE(NULLIF(g.amount_with_tax,0), g.amount)
         ELSE v.amount_with_tax END;

SELECT '411_branch_budget_grn_approval_flow.sql applied' AS migration_status;
