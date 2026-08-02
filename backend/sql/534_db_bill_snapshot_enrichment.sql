-- ============================================================
-- Migration 534: db_bill snapshot enrichment
-- Adds operational fields to cost_centre_master so db_bill
-- data can be synced as a read-only snapshot.
-- Additive only — no existing columns removed or renamed.
-- ============================================================

-- 1. cost_centre_master — new enrichment columns
-- ------------------------------------------------------------

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='bill_source_id');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN bill_source_id INT(11) NULL COMMENT "db_bill.cost_master.id"',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='client_name');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN client_name VARCHAR(255) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='tally_head');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN tally_head VARCHAR(200) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='stream');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN stream VARCHAR(200) NULL COMMENT "Business LOB from db_bill"',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='process_type');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN process_type VARCHAR(200) NULL COMMENT "Process name from db_bill.cost_master.process"',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='process_name_bill');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN process_name_bill VARCHAR(200) NULL COMMENT "Client-specific process name from db_bill"',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='cc_category');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN cc_category VARCHAR(100) NULL COMMENT "Voice/Non-Voice/Blended"',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='cc_type');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN cc_type VARCHAR(100) NULL COMMENT "Inbound/Outbound/Blended"',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='tower');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN tower VARCHAR(100) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='mandated_seats');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN mandated_seats VARCHAR(50) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='shrinkage_pct');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN shrinkage_pct VARCHAR(20) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='attrition_pct');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN attrition_pct VARCHAR(20) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='shift_count');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN shift_count VARCHAR(10) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='working_days_pw');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN working_days_pw VARCHAR(10) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='process_manager');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN process_manager VARCHAR(200) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='ops_email');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN ops_email VARCHAR(500) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='hr_email');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN hr_email VARCHAR(500) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='gst_type');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN gst_type VARCHAR(50) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='sac_code');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN sac_code VARCHAR(50) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='vendor_gst_no');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN vendor_gst_no VARCHAR(50) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='vendor_gst_state');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN vendor_gst_state VARCHAR(100) NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='go_live_date');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN go_live_date DATE NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='close_date');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN close_date DATE NULL',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='bill_source_branch');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN bill_source_branch VARCHAR(100) NULL COMMENT "db_bill branch_name for reference"',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

SET @s = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='bill_snapshot_at');
SET @q = IF(@s=0,
  'ALTER TABLE cost_centre_master ADD COLUMN bill_snapshot_at DATETIME NULL COMMENT "Last sync from db_bill"',
  'SELECT 1');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

-- 2. billing_provision_snapshot — monthly provision + billing from db_bill.provision_master
-- (new table; billing_invoice already exists for actual invoices)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_provision_snapshot (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cost_centre_code  VARCHAR(100) NOT NULL,
  bill_source_id    INT(11) NOT NULL COMMENT 'db_bill.provision_master.id',
  finance_year      VARCHAR(20)  NOT NULL,
  month_label       VARCHAR(20)  NOT NULL COMMENT 'e.g. Apr-24',
  invoice_type      VARCHAR(50)  NULL,
  provision_amt     BIGINT       NOT NULL DEFAULT 0,
  billing_amt       BIGINT       NOT NULL DEFAULT 0,
  billing_status    TINYINT(1)   NOT NULL DEFAULT 0,
  revenue_active    TINYINT(1)   NOT NULL DEFAULT 0,
  agreement         VARCHAR(50)  NULL,
  acknowledgment    VARCHAR(50)  NULL,
  remarks           VARCHAR(500) NULL,
  bill_client_name  VARCHAR(255) NULL COMMENT 'Denormalised from cost_master for fast queries',
  bill_stream       VARCHAR(200) NULL,
  bill_branch       VARCHAR(100) NULL,
  synced_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_provision_source (bill_source_id),
  INDEX idx_cc_period (cost_centre_code, finance_year, month_label),
  INDEX idx_fy (finance_year),
  INDEX idx_client (bill_client_name(80))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Read-only monthly provision + billing snapshot from db_bill.provision_master';

-- 3. billing_invoice_snapshot — actual invoices from db_bill.tbl_invoice
-- (separate from billing_invoice which is the HRMS-native invoice table)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_invoice_snapshot (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bill_source_id    INT(11)      NOT NULL COMMENT 'db_bill.tbl_invoice.id',
  invoice_type      VARCHAR(50)  NULL,
  category          VARCHAR(100) NULL,
  cost_centre_code  VARCHAR(100) NOT NULL,
  finance_year      VARCHAR(50)  NULL,
  month_label       VARCHAR(50)  NULL,
  invoice_date      VARCHAR(50)  NULL,
  bill_no           VARCHAR(200) NULL,
  po_no             VARCHAR(200) NULL,
  grn               VARCHAR(200) NULL,
  total_amt         BIGINT       NOT NULL DEFAULT 0,
  tax_amt           BIGINT       NOT NULL DEFAULT 0,
  igst              BIGINT       NOT NULL DEFAULT 0,
  sgst              BIGINT       NOT NULL DEFAULT 0,
  cgst              BIGINT       NOT NULL DEFAULT 0,
  grand_total       BIGINT       NOT NULL DEFAULT 0,
  gst_type          VARCHAR(50)  NULL,
  status            TINYINT(1)   NOT NULL DEFAULT 0,
  payment_status    VARCHAR(5)   NULL,
  receipt_status    TINYINT(1)   NOT NULL DEFAULT 0,
  bill_client       VARCHAR(255) NULL,
  bill_stream       VARCHAR(200) NULL,
  bill_process_name VARCHAR(200) NULL,
  bill_branch       VARCHAR(100) NULL,
  bill_finance_year VARCHAR(20)  NULL,
  carry_forward     TINYINT(1)   NOT NULL DEFAULT 0,
  synced_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoice_source (bill_source_id),
  INDEX idx_cc_period (cost_centre_code, finance_year, month_label),
  INDEX idx_fy (finance_year),
  INDEX idx_client (bill_client(80)),
  INDEX idx_bill_no (bill_no(50))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Read-only invoice snapshot from db_bill.tbl_invoice';

-- 4. bill_client_snapshot — distinct clients from db_bill.client_master
-- (does not replace client_master; used to reconcile new clients)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bill_client_snapshot (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bill_source_id    INT(20)      NOT NULL COMMENT 'db_bill.client_master.id',
  client_type       VARCHAR(100) NULL,
  client_name       VARCHAR(255) NOT NULL,
  branch_name       VARCHAR(200) NULL,
  client_status     TINYINT(1)   NOT NULL DEFAULT 1,
  synced_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bill_client_source (bill_source_id),
  INDEX idx_client_name (client_name(100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Read-only client snapshot from db_bill.client_master (893 rows)';
