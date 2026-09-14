-- Migration 1218: GRN Phase A — all new columns for company, late invoice,
-- unbudgeted flag, and GST state codes. One migration, two tables touched.
--
-- Rewritten 2026-08-15 into this repository's guarded-per-object idiom. The schema
-- this file declares is UNCHANGED — same seven grn_request columns with the same
-- types, nullability, defaults and AFTER positions, the same grn_cost_allocation
-- column, the same four indexes and the same foreign key. Only the execution shape
-- changed, for two reasons:
--
--  1. It was written as one multi-column ALTER plus four bare CREATE INDEX plus an
--     inline ADD CONSTRAINT. That form is not re-runnable: a second execution raises
--     ER_DUP_FIELDNAME (1060) on the first column and ER_DUP_KEYNAME (1061) on the
--     first index. Migrations here run at boot, so a non-idempotent file is a boot
--     failure waiting to happen rather than a no-op.
--  2. Every object it declares ALREADY EXISTS on production — verified live
--     2026-08-15 against mas_hrms 8.0.42: all seven grn_request columns, the
--     grn_cost_allocation column, all four indexes and fk_grn_company_code are
--     present, while schema_migrations has NO row for this file. It was applied out
--     of band. Registering the original text would therefore have failed on its very
--     first scheduled run against the one database that matters.
--
-- MySQL 8.0 rejects ADD COLUMN IF NOT EXISTS at the token, hence information_schema
-- + PREPARE/EXECUTE per object rather than IF NOT EXISTS. Purely additive: no DROP,
-- no DELETE, no UPDATE, no row touched. On production every guard evaluates false and
-- the file is a complete no-op; on a rebuilt database it creates the objects in order.
--
-- Dependency order is satisfied at this file's natural manifest position: grn_request
-- is created by 310_vendor_payment_tracking.sql, grn_cost_allocation by
-- 416_smart_grn_allocation_document_intelligence.sql and finance_company by
-- 1090_finance_grn_monthly_sequence.sql — all before 1218. So unlike 440/441 this
-- file does NOT need to be pushed to the end of the manifest.

USE mas_hrms;

-- ---------------------------------------------------------------------------
-- grn_request columns
-- ---------------------------------------------------------------------------

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request'
                 AND COLUMN_NAME = 'company_code') = 0,
  'ALTER TABLE grn_request ADD COLUMN company_code VARCHAR(20) NULL AFTER branch_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request'
                 AND COLUMN_NAME = 'vendor_state_code') = 0,
  'ALTER TABLE grn_request ADD COLUMN vendor_state_code CHAR(2) NULL AFTER company_code',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request'
                 AND COLUMN_NAME = 'billing_state_code') = 0,
  'ALTER TABLE grn_request ADD COLUMN billing_state_code CHAR(2) NULL AFTER vendor_state_code',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request'
                 AND COLUMN_NAME = 'gst_enabled') = 0,
  'ALTER TABLE grn_request ADD COLUMN gst_enabled TINYINT(1) NULL AFTER billing_state_code',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request'
                 AND COLUMN_NAME = 'is_late_invoice') = 0,
  'ALTER TABLE grn_request ADD COLUMN is_late_invoice TINYINT(1) NOT NULL DEFAULT 0 AFTER accounting_period',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request'
                 AND COLUMN_NAME = 'late_invoice_reason') = 0,
  'ALTER TABLE grn_request ADD COLUMN late_invoice_reason VARCHAR(500) NULL AFTER is_late_invoice',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request'
                 AND COLUMN_NAME = 'is_unbudgeted') = 0,
  'ALTER TABLE grn_request ADD COLUMN is_unbudgeted TINYINT(1) NOT NULL DEFAULT 0 AFTER is_late_invoice',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- grn_cost_allocation column
-- ---------------------------------------------------------------------------

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_cost_allocation'
                 AND COLUMN_NAME = 'is_unbudgeted') = 0
              AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_cost_allocation') = 1,
  'ALTER TABLE grn_cost_allocation ADD COLUMN is_unbudgeted TINYINT(1) NOT NULL DEFAULT 0 AFTER sequence_no',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Indexes (created before the FK so the FK can use idx_grn_request_company)
-- ---------------------------------------------------------------------------

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request'
                 AND INDEX_NAME = 'idx_grn_request_company') = 0,
  'CREATE INDEX idx_grn_request_company ON grn_request(company_code)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request'
                 AND INDEX_NAME = 'idx_grn_request_late_invoice') = 0,
  'CREATE INDEX idx_grn_request_late_invoice ON grn_request(is_late_invoice)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request'
                 AND INDEX_NAME = 'idx_grn_request_unbudgeted') = 0,
  'CREATE INDEX idx_grn_request_unbudgeted ON grn_request(is_unbudgeted)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_cost_allocation'
                 AND INDEX_NAME = 'idx_grn_alloc_unbudgeted') = 0
              AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_cost_allocation') = 1,
  'CREATE INDEX idx_grn_alloc_unbudgeted ON grn_cost_allocation(is_unbudgeted)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Foreign key
--
-- Guarded on the constraint being absent AND on finance_company existing, so a
-- rebuilt database that has not yet reached 1090 skips it rather than dying. Both
-- sides are utf8mb4_unicode_ci (verified live), which is what InnoDB requires;
-- the differing declared lengths (grn_request.company_code VARCHAR(20) referencing
-- finance_company.company_code VARCHAR(16)) are permitted for varchar and are what
-- the live constraint already runs on.
-- ---------------------------------------------------------------------------

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request'
                 AND CONSTRAINT_NAME = 'fk_grn_company_code'
                 AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0
              AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_company') = 1,
  'ALTER TABLE grn_request ADD CONSTRAINT fk_grn_company_code FOREIGN KEY (company_code) REFERENCES finance_company(company_code) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
