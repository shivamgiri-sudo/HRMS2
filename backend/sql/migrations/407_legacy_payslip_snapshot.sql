-- =============================================================================
-- Migration 407: Legacy Payslip Snapshot from db_bill.salary_data
--
-- Creates a flat snapshot table to store historical payslips from db_bill.
-- These are read-only legacy records; future payslips go through salary_prep_run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS legacy_payslip_snapshot (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  employee_code           VARCHAR(50)     NOT NULL,
  employee_id             VARCHAR(36)     NULL,           -- mapped from mas_hrms.employees
  sal_date                DATE            NOT NULL,        -- last day of pay month
  pay_month               VARCHAR(7)      NOT NULL,        -- YYYY-MM derived from sal_date
  employee_name           VARCHAR(200),
  branch                  VARCHAR(100),
  designation             VARCHAR(100),
  department              VARCHAR(100),

  -- Earnings (gross components)
  basic                   DECIMAL(12,2)   DEFAULT 0,
  hra                     DECIMAL(12,2)   DEFAULT 0,
  conveyance              DECIMAL(12,2)   DEFAULT 0,
  portfolio               DECIMAL(12,2)   DEFAULT 0,
  medical_allowance       DECIMAL(12,2)   DEFAULT 0,
  lta                     DECIMAL(12,2)   DEFAULT 0,
  special_allowance       DECIMAL(12,2)   DEFAULT 0,
  other_allowance         DECIMAL(12,2)   DEFAULT 0,
  bonus                   DECIMAL(12,2)   DEFAULT 0,
  incentive               DECIMAL(12,2)   DEFAULT 0,
  arrear                  DECIMAL(12,2)   DEFAULT 0,
  extra_day               DECIMAL(12,2)   DEFAULT 0,
  pli                     DECIMAL(12,2)   DEFAULT 0,

  -- Earned (pro-rated)
  gross_earned            DECIMAL(12,2)   DEFAULT 0,       -- Gross1 in db_bill

  -- Deductions
  epf_employee            DECIMAL(12,2)   DEFAULT 0,
  esic_employee           DECIMAL(12,2)   DEFAULT 0,
  professional_tax        DECIMAL(12,2)   DEFAULT 0,
  income_tax              DECIMAL(12,2)   DEFAULT 0,
  advance_paid            DECIMAL(12,2)   DEFAULT 0,
  loan_deduction          DECIMAL(12,2)   DEFAULT 0,
  other_deduction         DECIMAL(12,2)   DEFAULT 0,
  other_deduction_remarks VARCHAR(500),
  short_collection        DECIMAL(12,2)   DEFAULT 0,
  asset_recovery          DECIMAL(12,2)   DEFAULT 0,
  leave_deduction         DECIMAL(12,2)   DEFAULT 0,
  total_deductions        DECIMAL(12,2)   DEFAULT 0,

  -- Totals
  gross_salary            DECIMAL(12,2)   DEFAULT 0,       -- Gross (full month)
  net_salary              DECIMAL(12,2)   DEFAULT 0,
  ctc_monthly             DECIMAL(12,2)   DEFAULT 0,       -- CTC field from db_bill
  ctc_offered             DECIMAL(12,2)   DEFAULT 0,

  -- Attendance
  working_days            DECIMAL(5,2)    DEFAULT 0,
  earned_days             DECIMAL(5,2)    DEFAULT 0,
  leave_days              DECIMAL(5,2)    DEFAULT 0,

  -- Statutory numbers
  epf_number              VARCHAR(50),
  esic_number             VARCHAR(50),
  account_number          VARCHAR(50),
  salary_payment_mode     VARCHAR(50),
  cheque_number           VARCHAR(50),

  -- Employer share
  epf_employer            DECIMAL(12,2)   DEFAULT 0,
  esic_employer           DECIMAL(12,2)   DEFAULT 0,
  admin_charges           DECIMAL(12,2)   DEFAULT 0,

  -- Flags
  status                  TINYINT(1)      DEFAULT 1,       -- 1=approved
  is_fnf                  TINYINT(1)      DEFAULT 0,

  -- Source tracking
  db_bill_id              INT,
  db_bill_created_date    DATETIME,
  snapshot_taken_at       TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_emp_code   (employee_code),
  INDEX idx_employee   (employee_id),
  INDEX idx_pay_month  (pay_month),
  INDEX idx_emp_month  (employee_id, pay_month),
  UNIQUE KEY uk_emp_month (employee_code, pay_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
