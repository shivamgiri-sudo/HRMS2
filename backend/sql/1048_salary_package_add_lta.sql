-- Migration 1048: Add lta (Leave Travel Allowance) column to salary_package_master.
-- Additive ALTER only. Default 0.00 — all existing rows stay valid.
-- db_bill.mas_packagemaster has no LTA column (it lives in the payslip data only),
-- so this column will be 0 for all synced rows until manually populated by HR/Payroll.
--
-- REWRITTEN 2026-08-20 while registering this file in the manifest for the first time —
-- it had been applied out of band (both lta columns already exist live) but was never
-- registered, and its original `ADD COLUMN IF NOT EXISTS` is MariaDB-only syntax MySQL
-- 8.0.42 rejects with ER_PARSE_ERROR, which would have failed on the very next boot
-- regardless of the columns already existing (the statement fails to parse before it
-- gets anywhere near evaluating IF NOT EXISTS). Rewritten as information_schema-guarded
-- PREPARE/EXECUTE blocks, matching 1110/1123/1218/1118/1500/1503 in this directory. No
-- declared type, nullability, default or position changed from the original file.

SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'salary_package_master'
              AND column_name = 'lta');
SET @ddl := IF(@c = 0,
  'ALTER TABLE salary_package_master ADD COLUMN lta DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''Leave Travel Allowance monthly amount. 0 for db_bill-synced rows; populate manually.'' AFTER hra',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Also add to salary_package_state_wise for consistency (state-wise packages may have LTA).
SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'salary_package_state_wise'
              AND column_name = 'lta');
SET @ddl := IF(@c = 0,
  'ALTER TABLE salary_package_state_wise ADD COLUMN lta DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT ''Leave Travel Allowance for state-wise minimum wage packages.'' AFTER hra',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Diagnostic: confirm column exists and all rows default to 0.
SELECT
  COUNT(*)                           AS total_packages,
  SUM(lta = 0)                       AS lta_zero,
  SUM(lta > 0)                       AS lta_populated,
  MAX(lta)                           AS max_lta
FROM salary_package_master
WHERE active_status = 1;
