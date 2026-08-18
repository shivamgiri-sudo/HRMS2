-- Migration 1048: Add lta (Leave Travel Allowance) column to salary_package_master.
-- Additive ALTER only. Default 0.00 — all 295 existing rows stay valid.
-- db_bill.mas_packagemaster has no LTA column (it lives in the payslip data only),
-- so this column will be 0 for all synced rows until manually populated by HR/Payroll.

ALTER TABLE salary_package_master
  ADD COLUMN IF NOT EXISTS lta DECIMAL(12,2) NOT NULL DEFAULT 0.00
    COMMENT 'Leave Travel Allowance monthly amount. 0 for db_bill-synced rows; populate manually.'
    AFTER hra;

-- Also add to salary_package_state_wise for consistency (state-wise packages may have LTA).
ALTER TABLE salary_package_state_wise
  ADD COLUMN IF NOT EXISTS lta DECIMAL(12,2) NOT NULL DEFAULT 0.00
    COMMENT 'Leave Travel Allowance for state-wise minimum wage packages.'
    AFTER hra;

-- Diagnostic: confirm column exists and all rows default to 0.
SELECT
  COUNT(*)                           AS total_packages,
  SUM(lta = 0)                       AS lta_zero,
  SUM(lta > 0)                       AS lta_populated,
  MAX(lta)                           AS max_lta
FROM salary_package_master
WHERE active_status = 1;