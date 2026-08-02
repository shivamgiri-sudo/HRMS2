-- ============================================================================
-- Migration 1007: Legacy Salary Snapshot from db_bill.masjclrentry
--
-- RUN THIS ON PRODUCTION SERVER where both db_bill and mas_hrms are accessible
--
-- db_bill: 14.97.30.236 (or 192.168.10.22 from internal)
-- mas_hrms: 192.168.10.6
--
-- Command: mysql -h 192.168.10.6 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms < 1007_legacy_salary_snapshot_FINAL.sql
-- ============================================================================

-- Step 1: Create snapshot table
CREATE TABLE IF NOT EXISTS legacy_salary_snapshot (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_code VARCHAR(50) NOT NULL,
  employee_name VARCHAR(200),
  branch_name VARCHAR(100),
  process VARCHAR(255),
  designation VARCHAR(100),
  effective_date DATE,
  doj DATE,
  dol DATE,

  -- Salary components (VARCHAR in source, convert to DECIMAL)
  basic DECIMAL(12,2) DEFAULT 0,
  hra DECIMAL(12,2) DEFAULT 0,
  conveyance DECIMAL(12,2) DEFAULT 0,
  da DECIMAL(12,2) DEFAULT 0,
  medical DECIMAL(12,2) DEFAULT 0,
  special_allowance DECIMAL(12,2) DEFAULT 0,
  other_allowance DECIMAL(12,2) DEFAULT 0,

  -- Deductions
  pf_employee DECIMAL(12,2) DEFAULT 0,
  pf_employer DECIMAL(12,2) DEFAULT 0,
  esic_employee DECIMAL(12,2) DEFAULT 0,
  esic_employer DECIMAL(12,2) DEFAULT 0,
  pt DECIMAL(12,2) DEFAULT 0,

  -- Totals
  gross DECIMAL(12,2) DEFAULT 0,
  net_salary DECIMAL(12,2) DEFAULT 0,
  ctc_monthly DECIMAL(12,2) DEFAULT 0,
  ctc_annual DECIMAL(14,2) DEFAULT 0,

  -- Eligibility flags
  pf_eligible VARCHAR(10),
  esic_eligible VARCHAR(10),

  -- db_bill metadata
  db_bill_last_updated DATETIME,
  db_bill_id INT,

  -- Snapshot metadata
  snapshot_taken_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  migrated_to_hrms TINYINT(1) DEFAULT 0,
  migrated_at DATETIME DEFAULT NULL,

  INDEX idx_emp_code (employee_code),
  INDEX idx_effective (effective_date),
  INDEX idx_migrated (migrated_to_hrms),
  UNIQUE KEY uk_emp_code (employee_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Step 2: Add source column to salary_increment_request if not exists
ALTER TABLE salary_increment_request
ADD COLUMN IF NOT EXISTS source ENUM('hrms','legacy') NOT NULL DEFAULT 'hrms' AFTER status;

SELECT 'Tables ready' AS status;
