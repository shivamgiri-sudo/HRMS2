-- 421_process_lob_pnl_foundation.sql
-- Adds an effective-dated Line of Business dimension beneath Process and creates
-- immutable period-close snapshots. Existing process-level records are backfilled
-- to a DEFAULT LOB so the migration is additive and backward compatible.

CREATE TABLE IF NOT EXISTS process_lob_master (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  lob_code VARCHAR(64) NOT NULL,
  lob_name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  cost_centre_id CHAR(36) NULL,
  allocation_scope ENUM('direct_lob','shared_process') NOT NULL DEFAULT 'direct_lob',
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  approval_status ENUM('draft','approved','inactive') NOT NULL DEFAULT 'draft',
  created_by CHAR(36) NULL,
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_lob_code (process_id, lob_code),
  INDEX idx_process_lob_effective (process_id, active_status, effective_from, effective_to),
  INDEX idx_process_lob_cost_centre (cost_centre_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_lob_monthly_plan (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_lob_id CHAR(36) NOT NULL,
  period_code CHAR(7) NOT NULL,
  contracted_seats DECIMAL(12,2) NULL,
  billable_seats DECIMAL(12,2) NULL,
  occupied_seats DECIMAL(12,2) NULL,
  required_productive_hc DECIMAL(12,2) NULL,
  required_roster_hc DECIMAL(12,2) NULL,
  revenue_budget DECIMAL(18,2) NULL,
  agent_cost_budget DECIMAL(18,2) NULL,
  direct_vendor_cost_budget DECIMAL(18,2) NULL,
  shared_cost_budget DECIMAL(18,2) NULL,
  ebitda_budget DECIMAL(18,2) NULL,
  shared_cost_driver ENUM('contracted_seats','billable_seats','occupied_seats','active_hc','revenue','equal','manual') NOT NULL DEFAULT 'contracted_seats',
  manual_allocation_pct DECIMAL(7,4) NULL,
  status ENUM('draft','approved','locked') NOT NULL DEFAULT 'draft',
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_process_lob_plan_period (process_lob_id, period_code),
  INDEX idx_process_lob_plan_period (period_code, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_lob_assignment (
  id CHAR(36) NOT NULL PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  process_lob_id CHAR(36) NOT NULL,
  cost_bucket ENUM('agent_salary','dsc_people') NOT NULL DEFAULT 'agent_salary',
  allocation_pct DECIMAL(7,4) NOT NULL DEFAULT 100,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  assignment_source ENUM('manual','roster','timesheet','bulk_upload','system') NOT NULL DEFAULT 'manual',
  status ENUM('draft','approved','inactive') NOT NULL DEFAULT 'draft',
  created_by CHAR(36) NULL,
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_lob_assignment (employee_id, process_lob_id, effective_from),
  INDEX idx_employee_lob_effective (employee_id, status, effective_from, effective_to),
  INDEX idx_lob_employee_effective (process_lob_id, status, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_payment_allocation (
  id CHAR(36) NOT NULL PRIMARY KEY,
  vendor_payment_id CHAR(36) NOT NULL,
  grn_allocation_id CHAR(36) NULL,
  process_id CHAR(36) NULL,
  process_lob_id CHAR(36) NULL,
  cost_centre_id CHAR(36) NULL,
  pnl_bucket VARCHAR(60) NOT NULL,
  recognition_period CHAR(7) NOT NULL,
  pnl_cost_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  gross_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vendor_payment_grn_allocation (vendor_payment_id, grn_allocation_id),
  INDEX idx_vendor_payment_lob_period (recognition_period, process_id, process_lob_id, pnl_bucket)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pnl_period_snapshot (
  id CHAR(36) NOT NULL PRIMARY KEY,
  finance_period_id CHAR(36) NOT NULL,
  period_code CHAR(7) NOT NULL,
  snapshot_version INT NOT NULL,
  calculation_engine VARCHAR(80) NOT NULL DEFAULT 'bpo_allocation_v2',
  source_hash CHAR(64) NOT NULL,
  summary_json JSON NOT NULL,
  status ENUM('locked','superseded') NOT NULL DEFAULT 'locked',
  locked_by CHAR(36) NOT NULL,
  locked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pnl_period_snapshot_version (finance_period_id, snapshot_version),
  INDEX idx_pnl_snapshot_period (period_code, status, snapshot_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pnl_period_snapshot_row (
  id CHAR(36) NOT NULL PRIMARY KEY,
  snapshot_id CHAR(36) NOT NULL,
  branch_id CHAR(36) NULL,
  client_id CHAR(36) NULL,
  process_id CHAR(36) NOT NULL,
  process_lob_id CHAR(36) NULL,
  row_type ENUM('process','lob','unallocated') NOT NULL DEFAULT 'process',
  row_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pnl_snapshot_row_process (snapshot_id, process_id, process_lob_id),
  INDEX idx_pnl_snapshot_row_branch (snapshot_id, branch_id, client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add the LOB dimension to the existing commercial, delivery, cost and allocation ledgers.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='process_revenue_rule' AND column_name='process_lob_id')=0,
  'ALTER TABLE process_revenue_rule ADD COLUMN process_lob_id CHAR(36) NULL AFTER process_id, ADD INDEX idx_revenue_rule_lob_effective (process_lob_id, effective_from, effective_to, status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='process_delivery_actual' AND column_name='process_lob_id')=0,
  'ALTER TABLE process_delivery_actual ADD COLUMN process_lob_id CHAR(36) NULL AFTER process_id, ADD INDEX idx_delivery_lob_period (process_lob_id, period_code, metric_key, status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @old_delivery_uq = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='process_delivery_actual' AND index_name='uq_process_delivery_source');
SET @sql = IF(@old_delivery_uq > 0, 'ALTER TABLE process_delivery_actual DROP INDEX uq_process_delivery_source', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @new_delivery_uq = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='process_delivery_actual' AND index_name='uq_process_lob_delivery_source');
SET @sql = IF(@new_delivery_uq = 0,
  'ALTER TABLE process_delivery_actual ADD UNIQUE KEY uq_process_lob_delivery_source (process_id, process_lob_id, period_code, metric_key, data_source, source_reference)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='process_revenue_component' AND column_name='process_lob_id')=0,
  'ALTER TABLE process_revenue_component ADD COLUMN process_lob_id CHAR(36) NULL AFTER process_id, ADD INDEX idx_revenue_component_lob_period (process_lob_id, period_code, status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='process_pnl_cost_component' AND column_name='process_lob_id')=0,
  'ALTER TABLE process_pnl_cost_component ADD COLUMN process_lob_id CHAR(36) NULL AFTER process_id, ADD INDEX idx_cost_component_lob_period (process_lob_id, period_code, status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='pnl_adjustment_journal' AND column_name='process_lob_id')=0,
  'ALTER TABLE pnl_adjustment_journal ADD COLUMN process_lob_id CHAR(36) NULL AFTER process_id, ADD INDEX idx_pnl_adjustment_lob_period (process_lob_id, period_code, approval_status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_cost_allocation' AND column_name='process_lob_id')=0,
  'ALTER TABLE grn_cost_allocation ADD COLUMN process_lob_id CHAR(36) NULL AFTER process_id, ADD INDEX idx_grn_allocation_lob_period (process_lob_id, recognition_period, pnl_bucket, lifecycle_status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='finance_budget_line' AND column_name='process_lob_id')=0,
  'ALTER TABLE finance_budget_line ADD COLUMN process_lob_id CHAR(36) NULL AFTER process_id, ADD INDEX idx_budget_line_lob (process_lob_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Every process starts with a governed default LOB. It is deliberately visible so
-- unmigrated data is never silently hidden.
INSERT INTO process_lob_master
  (id, process_id, lob_code, lob_name, description, allocation_scope, effective_from,
   active_status, approval_status, created_at, updated_at)
SELECT UUID(), p.id, 'DEFAULT', 'Core / Unallocated',
       'System-created default LOB for backward-compatible process attribution',
       'direct_lob', '2000-01-01', 1, 'approved', NOW(), NOW()
  FROM process_master p
  LEFT JOIN process_lob_master l ON l.process_id = p.id AND l.lob_code = 'DEFAULT'
 WHERE l.id IS NULL;

UPDATE process_revenue_rule r
JOIN process_lob_master l ON l.process_id = r.process_id AND l.lob_code = 'DEFAULT'
SET r.process_lob_id = l.id
WHERE r.process_lob_id IS NULL;

UPDATE process_delivery_actual d
JOIN process_lob_master l ON l.process_id = d.process_id AND l.lob_code = 'DEFAULT'
SET d.process_lob_id = l.id
WHERE d.process_lob_id IS NULL;

UPDATE process_revenue_component c
JOIN process_lob_master l ON l.process_id = c.process_id AND l.lob_code = 'DEFAULT'
SET c.process_lob_id = l.id
WHERE c.process_lob_id IS NULL;

UPDATE process_pnl_cost_component c
JOIN process_lob_master l ON l.process_id = c.process_id AND l.lob_code = 'DEFAULT'
SET c.process_lob_id = l.id
WHERE c.process_lob_id IS NULL AND c.process_id IS NOT NULL;

UPDATE pnl_adjustment_journal a
JOIN process_lob_master l ON l.process_id = a.process_id AND l.lob_code = 'DEFAULT'
SET a.process_lob_id = l.id
WHERE a.process_lob_id IS NULL;

UPDATE grn_cost_allocation a
JOIN process_lob_master l ON l.process_id = a.process_id AND l.lob_code = 'DEFAULT'
SET a.process_lob_id = l.id
WHERE a.process_lob_id IS NULL AND a.process_id IS NOT NULL;

UPDATE finance_budget_line b
JOIN process_lob_master l ON l.process_id = b.process_id AND l.lob_code = 'DEFAULT'
SET b.process_lob_id = l.id
WHERE b.process_lob_id IS NULL AND b.process_id IS NOT NULL;

-- Allocation-aware payment bridge. Cash payment remains at payment header/transaction
-- level; P&L attribution remains at GRN allocation line level.
INSERT INTO vendor_payment_allocation
  (id, vendor_payment_id, grn_allocation_id, process_id, process_lob_id, cost_centre_id,
   pnl_bucket, recognition_period, pnl_cost_amount, gross_amount)
SELECT UUID(), vpt.id, a.id, a.process_id, a.process_lob_id, a.cost_centre_id,
       COALESCE(a.pnl_bucket, CASE WHEN a.cost_class='direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END),
       COALESCE(a.recognition_period, vpt.recognition_period,
                DATE_FORMAT(COALESCE(vpt.due_date, vpt.payment_date, vpt.created_at), '%Y-%m')),
       COALESCE(a.pnl_cost_amount, 0), COALESCE(a.amount_with_tax, 0)
  FROM vendor_payment_tracking vpt
  JOIN grn_cost_allocation a ON a.grn_request_id = vpt.grn_request_id
  LEFT JOIN vendor_payment_allocation existing
    ON existing.vendor_payment_id = vpt.id AND existing.grn_allocation_id = a.id
 WHERE existing.id IS NULL;

CREATE OR REPLACE VIEW vw_process_lob_grn_allocation AS
SELECT
  a.process_id,
  a.process_lob_id,
  a.cost_centre_id,
  a.branch_id,
  COALESCE(a.recognition_period,
           DATE_FORMAT(COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at), '%Y-%m')) AS period_code,
  COALESCE(a.pnl_bucket,
           sh.pnl_bucket,
           CASE WHEN a.cost_class='direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END) AS pnl_bucket,
  SUM(COALESCE(a.pnl_cost_amount, 0)) AS pnl_cost_amount,
  SUM(COALESCE(a.amount_with_tax, 0)) AS gross_amount,
  COUNT(DISTINCT a.id) AS allocation_count,
  COUNT(DISTINCT a.grn_request_id) AS grn_count,
  MAX(COALESCE(a.consumed_at, a.updated_at, a.created_at)) AS freshness
FROM grn_cost_allocation a
JOIN grn_request g ON g.id = a.grn_request_id
JOIN finance_budget_line b ON b.id = a.budget_line_id
LEFT JOIN finance_expense_head_master h
  ON (LOWER(h.head_code)=LOWER(b.head) OR LOWER(h.head_name)=LOWER(b.head))
 AND h.active_status=1
LEFT JOIN finance_expense_sub_head_master sh
  ON sh.head_id=h.id
 AND (LOWER(sh.sub_head_code)=LOWER(COALESCE(b.sub_head,''))
      OR LOWER(sh.sub_head_name)=LOWER(COALESCE(b.sub_head,'')))
 AND sh.active_status=1
WHERE a.lifecycle_status='consumed'
  AND LOWER(COALESCE(g.status,'')) NOT IN ('rejected','cancelled','reversed')
GROUP BY a.process_id, a.process_lob_id, a.cost_centre_id, a.branch_id,
         COALESCE(a.recognition_period,
                  DATE_FORMAT(COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at), '%Y-%m')),
         COALESCE(a.pnl_bucket,
                  sh.pnl_bucket,
                  CASE WHEN a.cost_class='direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END);

SELECT '421_process_lob_pnl_foundation.sql applied' AS migration_status;
