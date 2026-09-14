-- ============================================================================
-- Migration 1007: Legacy Salary Snapshot from db_bill
-- Purpose: One-time snapshot of db_bill.masjclrentry before db_bill shutdown
-- Run from: Production server (where db_bill is accessible)
-- ============================================================================

-- Step 1: Create snapshot table in mas_hrms
CREATE TABLE IF NOT EXISTS legacy_salary_snapshot (
  id INT AUTO_INCREMENT PRIMARY KEY,

  -- Employee identity
  employee_code VARCHAR(20) NOT NULL,
  employee_name VARCHAR(200),

  -- Effective date (derived from lastUpdated or record date)
  effective_date DATE,

  -- Salary components (match db_bill.masjclrentry columns)
  basic DECIMAL(12,2) DEFAULT 0,
  hra DECIMAL(12,2) DEFAULT 0,
  conveyance DECIMAL(12,2) DEFAULT 0,
  medical DECIMAL(12,2) DEFAULT 0,
  special_allowance DECIMAL(12,2) DEFAULT 0,
  other_allowance DECIMAL(12,2) DEFAULT 0,

  -- Deductions
  pf_employee DECIMAL(12,2) DEFAULT 0,
  pf_employer DECIMAL(12,2) DEFAULT 0,
  esic_employee DECIMAL(12,2) DEFAULT 0,
  esic_employer DECIMAL(12,2) DEFAULT 0,
  pt DECIMAL(12,2) DEFAULT 0,
  tds DECIMAL(12,2) DEFAULT 0,

  -- Totals
  gross DECIMAL(12,2) DEFAULT 0,
  total_deductions DECIMAL(12,2) DEFAULT 0,
  net_salary DECIMAL(12,2) DEFAULT 0,
  ctc_monthly DECIMAL(12,2) DEFAULT 0,
  ctc_annual DECIMAL(14,2) DEFAULT 0,

  -- Original db_bill metadata
  db_bill_last_updated DATETIME,
  db_bill_raw_json JSON,

  -- Snapshot metadata
  snapshot_taken_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  migrated_to_hrms TINYINT(1) DEFAULT 0,
  migrated_at DATETIME DEFAULT NULL,
  migration_notes TEXT,

  -- Indexes
  INDEX idx_emp_code (employee_code),
  INDEX idx_effective (effective_date),
  INDEX idx_migrated (migrated_to_hrms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Step 2: Import from db_bill (ADJUST COLUMN NAMES TO MATCH ACTUAL db_bill SCHEMA)
--
-- NOTE: Run this SELECT first to see actual columns in db_bill.masjclrentry:
--   SHOW COLUMNS FROM db_bill.masjclrentry;
--
-- Then adjust the INSERT below to match actual column names.
-- ============================================================================

-- TEMPLATE (adjust column names after checking db_bill schema):
/*
INSERT INTO mas_hrms.legacy_salary_snapshot (
  employee_code,
  employee_name,
  effective_date,
  basic,
  hra,
  conveyance,
  medical,
  special_allowance,
  other_allowance,
  pf_employee,
  pf_employer,
  esic_employee,
  esic_employer,
  pt,
  tds,
  gross,
  total_deductions,
  net_salary,
  ctc_monthly,
  ctc_annual,
  db_bill_last_updated,
  db_bill_raw_json
)
SELECT
  emp_code,
  emp_name,
  COALESCE(DATE(lastUpdated), CURDATE()) AS effective_date,
  COALESCE(basic, 0),
  COALESCE(hra, 0),
  COALESCE(conveyance, 0),
  COALESCE(medical, 0),
  COALESCE(special_allowance, 0),
  COALESCE(other_allowance, 0),
  COALESCE(pf_emp, 0),
  COALESCE(pf_er, 0),
  COALESCE(esic_emp, 0),
  COALESCE(esic_er, 0),
  COALESCE(pt, 0),
  COALESCE(tds, 0),
  COALESCE(gross, 0),
  COALESCE(total_ded, 0),
  COALESCE(net, 0),
  COALESCE(ctc, 0),
  COALESCE(ctc, 0) * 12,
  lastUpdated,
  NULL
FROM db_bill.masjclrentry;
*/

-- ============================================================================
-- Step 3: Add source column to salary_increment_request
-- ============================================================================

ALTER TABLE salary_increment_request
ADD COLUMN IF NOT EXISTS source ENUM('hrms','legacy') NOT NULL DEFAULT 'hrms' AFTER status;

-- ============================================================================
-- Verification queries (run after import)
-- ============================================================================

-- Check row count
-- SELECT COUNT(*) AS snapshot_count FROM legacy_salary_snapshot;

-- Check for duplicates
-- SELECT employee_code, effective_date, COUNT(*) as cnt
-- FROM legacy_salary_snapshot
-- GROUP BY employee_code, effective_date
-- HAVING cnt > 1;

-- Check date distribution
-- SELECT YEAR(effective_date) AS yr, COUNT(*) AS cnt
-- FROM legacy_salary_snapshot
-- GROUP BY yr ORDER BY yr;
