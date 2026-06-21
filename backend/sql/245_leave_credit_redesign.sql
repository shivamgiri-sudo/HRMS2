-- 245_leave_credit_redesign.sql
-- Monthly leave credit redesign: whole-number alternating schedule + HDCL/HDML
-- Replaces fractional 0.583/0.417 with 1-day whole credits via schedule table

-- Step 1: Update leave_policy_config to disable old fractional rates
UPDATE leave_policy_config lpc
JOIN leave_type_master lt ON lt.id = lpc.leave_type_id
SET lpc.monthly_credit_days = 0
WHERE lt.leave_code IN ('CL', 'ML');

-- Step 2: Create leave_credit_schedule table
CREATE TABLE IF NOT EXISTS leave_credit_schedule (
  month        TINYINT NOT NULL COMMENT '1-12',
  leave_code   VARCHAR(20) NOT NULL,
  credit_days  DECIMAL(4,1) NOT NULL DEFAULT 1.0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (month, leave_code),
  FOREIGN KEY (leave_code) REFERENCES leave_type_master(leave_code)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_month (month)
);

-- Step 3: Seed 12-month schedule (7 CL + 5 ML = 12 total)
INSERT INTO leave_credit_schedule (month, leave_code, credit_days) VALUES
  (1,  'CL', 1.0),
  (2,  'ML', 1.0),
  (3,  'CL', 1.0),
  (4,  'ML', 1.0),
  (5,  'CL', 1.0),
  (6,  'ML', 1.0),
  (7,  'CL', 1.0),
  (8,  'CL', 1.0),
  (9,  'ML', 1.0),
  (10, 'CL', 1.0),
  (11, 'ML', 1.0),
  (12, 'CL', 1.0)
ON DUPLICATE KEY UPDATE credit_days = VALUES(credit_days);

-- Step 4: Fix existing fractional CL/ML balances (round down to nearest integer)
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
SET lbl.allocated_days = FLOOR(lbl.allocated_days)
WHERE lt.leave_code IN ('CL', 'ML')
  AND lbl.balance_year = YEAR(NOW())
  AND lbl.allocated_days > 0;

-- Step 5: Add audit columns to leave_request
ALTER TABLE leave_request
ADD COLUMN IF NOT EXISTS requires_branch_head_approval TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
ADD COLUMN IF NOT EXISTS cross_type_deduction JSON NULL COMMENT 'Deduction breakdown: {"CL": 1.0, "ML": 0.5}' AFTER requires_branch_head_approval,
ADD COLUMN IF NOT EXISTS payroll_closed_flag TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Set if month payroll already closed' AFTER cross_type_deduction,
ADD COLUMN IF NOT EXISTS backdated_applied TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Flag for backdated requests (up to 5th only)' AFTER payroll_closed_flag,
ADD INDEX idx_requires_branch_head (requires_branch_head_approval),
ADD INDEX idx_payroll_closed (payroll_closed_flag);

-- Step 6: Update leave_policy_config pool_with to include HDCL/HDML
UPDATE leave_policy_config lpc
JOIN leave_type_master lt ON lt.id = lpc.leave_type_id
SET lpc.pool_with = 'ML,HDCL'
WHERE lt.leave_code = 'CL';

UPDATE leave_policy_config lpc
JOIN leave_type_master lt ON lt.id = lpc.leave_type_id
SET lpc.pool_with = 'CL,HDML'
WHERE lt.leave_code = 'ML';

-- Audit log
INSERT INTO audit_log (action, module, details, created_at)
VALUES ('leave_credit_redesign', 'leave', 'Migrated to whole-number monthly schedule. Created leave_credit_schedule table.', NOW());
