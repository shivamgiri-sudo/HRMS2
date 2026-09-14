-- 1248_grn_dbbill_migration_schema.sql
-- Schema prep for complete db_bill → mas_hrms GRN / vendor / imprest migration.
--
-- WHAT THIS DOES
-- --------------
-- 1. Adds 'salary' to grn_request.grn_type ENUM (db_bill has Salary-type GRN entries,
--    "Automated Salary Generation For EmpCode …", which carry real GRN numbers and are
--    part of the P&L expense record).
-- 2. Adds bill_source_id INT NULL to grn_request, vendor_payment_tracking, and
--    imprest_allocation so every migrated row is traceable back to the db_bill source row.
-- 3. Creates grn_migration_branch_map: hard-coded db_bill BranchId → mas_hrms branch_master
--    UUID lookup. Verified 2026-08-19 against both branch_master tables.
-- 4. Creates a MIGRATION_SYSTEM auth_user sentinel row used as created_by for every
--    migrated record. It has a deliberately invalid password hash and is blocked from login.
--
-- SAFE TO APPLY — additive only. No existing rows changed, no existing columns dropped.
-- Idempotent: every ALTER uses IF NOT EXISTS / MODIFY only when column doesn't exist.

-- ---------------------------------------------------------------------------
-- 1. Add 'salary' to grn_request.grn_type ENUM
-- ---------------------------------------------------------------------------
-- db_bill ExpenseEntryType='Salary' = automated per-employee monthly salary cost GRNs.
-- They carry GRN numbers in the same sequence as Vendor/Imprest entries and are needed
-- for a complete P&L expense record. grn_type='provision' already exists but is unused;
-- 'salary' is added alongside it.
SET @col_def = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request' AND COLUMN_NAME = 'grn_type'
);
SET @needs_salary = IF(LOCATE('salary', IFNULL(@col_def,'')) = 0, 1, 0);
SET @sql = IF(@needs_salary = 1,
  "ALTER TABLE grn_request MODIFY COLUMN grn_type
     ENUM('vendor','imprest','provision','salary') NOT NULL DEFAULT 'vendor'",
  "SELECT 'grn_type already has salary' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. bill_source_id on grn_request
-- ---------------------------------------------------------------------------
SET @has_bsi = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request'
    AND COLUMN_NAME = 'bill_source_id'
);
SET @sql = IF(@has_bsi = 0,
  "ALTER TABLE grn_request
     ADD COLUMN bill_source_id INT NULL COMMENT 'db_bill.expense_entry_master.Id — set for migrated rows, NULL for native HRMS',
     ADD KEY idx_grn_bill_source (bill_source_id)",
  "SELECT 'bill_source_id already on grn_request' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 3. bill_source_id on vendor_payment_tracking
-- ---------------------------------------------------------------------------
SET @has_bsi = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendor_payment_tracking'
    AND COLUMN_NAME = 'bill_source_id'
);
SET @sql = IF(@has_bsi = 0,
  "ALTER TABLE vendor_payment_tracking
     ADD COLUMN bill_source_id INT NULL COMMENT 'db_bill.tbl_payment_processing.Id',
     ADD KEY idx_vpt_bill_source (bill_source_id)",
  "SELECT 'bill_source_id already on vendor_payment_tracking' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 4. bill_source_id on imprest_allocation
-- ---------------------------------------------------------------------------
SET @has_bsi = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imprest_allocation'
    AND COLUMN_NAME = 'bill_source_id'
);
SET @sql = IF(@has_bsi = 0,
  "ALTER TABLE imprest_allocation
     ADD COLUMN bill_source_id INT NULL COMMENT 'db_bill.imprest_allotment_master.Id',
     ADD KEY idx_ia_bill_source (bill_source_id)",
  "SELECT 'bill_source_id already on imprest_allocation' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 5. branch map — db_bill BranchId → mas_hrms branch_master UUID
-- ---------------------------------------------------------------------------
-- Verified 2026-08-19 by comparing both branch_master tables side-by-side.
-- fe* UUIDs are the authoritative finance-module branches (from migration 534).
-- 77* UUIDs are older HRMS1-era branches kept for compatibility; only used where
-- there is no fe* equivalent (db_bill branch 9 NOIDA → 77769026).
CREATE TABLE IF NOT EXISTS grn_migration_branch_map (
  dbbill_branch_id   INT          NOT NULL,
  dbbill_branch_name VARCHAR(100) NOT NULL,
  hrms_branch_id     CHAR(36)     NOT NULL COMMENT 'mas_hrms branch_master.id',
  PRIMARY KEY (dbbill_branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='One-time lookup for the db_bill migration. Safe to keep after migration.';

INSERT IGNORE INTO grn_migration_branch_map (dbbill_branch_id, dbbill_branch_name, hrms_branch_id) VALUES
  ( 1, 'AHMEDABAD HOUSE',               'fe9c9d14-6583-11f1-adb1-00155d0ab410'),
  ( 2, 'DELHI',                         'fea43dc9-6583-11f1-adb1-00155d0ab410'),
  ( 3, 'HEAD OFFICE',                   'fea9fdc3-6583-11f1-adb1-00155d0ab410'),
  ( 4, 'HYDERABAD',                     '6a90bb9d-5caf-11f1-adb1-00155d0ab410'),
  ( 5, 'JAIPUR',                        'fead2650-6583-11f1-adb1-00155d0ab410'),
  ( 6, 'KARNAL',                        'feb03b3a-6583-11f1-adb1-00155d0ab410'),
  ( 7, 'MEERUT',                        'feb79faa-6583-11f1-adb1-00155d0ab410'),
  ( 8, 'MOHALI',                        'feb94bca-6583-11f1-adb1-00155d0ab410'),
  ( 9, 'NOIDA',                         '77769026-5e88-11f1-adb1-00155d0ab410'),
  (11, 'AHMEDABAD OTHERS',              'fe9e502c-6583-11f1-adb1-00155d0ab410'),
  (12, 'JAIPUR IDC',                    'feae8bc7-6583-11f1-adb1-00155d0ab410'),
  (13, 'MAYAPURI',                      'feb3ff2d-6583-11f1-adb1-00155d0ab410'),
  (14, 'MAYAPURI-MP',                   'feb60126-6583-11f1-adb1-00155d0ab410'),
  (15, 'NOIDA-ISPARK',                  'fec0d5da-6583-11f1-adb1-00155d0ab410'),
  (16, 'NOIDA-DIALDESK',               'febeee54-6583-11f1-adb1-00155d0ab410'),
  (17, 'VDF MANPOWER',                  'fea5b34a-6583-11f1-adb1-00155d0ab410'),
  (18, 'AHMEDABAD-JALDARSHAN',          'fea10538-6583-11f1-adb1-00155d0ab410'),
  (19, 'NOIDA-2',                       'febd8777-6583-11f1-adb1-00155d0ab410'),
  (20, 'PAYPIK',                        'fec24b2c-6583-11f1-adb1-00155d0ab410'),
  (21, 'NOIDA ISPARK-2',               'febb909f-6583-11f1-adb1-00155d0ab410'),
  (22, 'MAS-SKILL DEVELOPMENT PROJECT', 'feb1fdad-6583-11f1-adb1-00155d0ab410'),
  (23, 'GENLEAP',                       'fea80658-6583-11f1-adb1-00155d0ab410'),
  (24, 'AHMEDABAD-NEELAKANTH',          'fea2c991-6583-11f1-adb1-00155d0ab410'),
  (25, 'DELHI (NEW)',                   'fea43dc9-6583-11f1-adb1-00155d0ab410'),
  -- Branch 10 does not exist in db_bill branch_master but appears in one GRN row;
  -- mapped to HEAD OFFICE as the safe fallback.
  (10, 'UNKNOWN (mapped to HEAD OFFICE)', 'fea9fdc3-6583-11f1-adb1-00155d0ab410');

-- ---------------------------------------------------------------------------
-- 6. MIGRATION_SYSTEM sentinel user in auth_user
-- ---------------------------------------------------------------------------
-- Every row inserted by the migration scripts carries this UUID as created_by.
-- The password hash is intentionally invalid — no one can log in as this account.
-- is_blocked = 1 as an additional guard.
INSERT IGNORE INTO auth_user (id, email, password_hash, is_blocked, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-dbbill000001',
  'migration@system.internal',
  'MIGRATION_SENTINEL_NOT_A_VALID_HASH',
  1,
  NOW(),
  NOW()
);

SELECT '1248_grn_dbbill_migration_schema.sql applied' AS migration_status;
