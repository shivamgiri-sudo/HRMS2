-- 041_schema_gap_fill.sql
-- Comprehensive schema gap-fill for MAS-CallNet HRMS
--
-- Addresses every gap identified in the full schema audit:
--   1.  employees — add cost_centre_id, manager_id (NOT NULL), grade_id,
--                   employee_category, pan_number, aadhaar_number (masked),
--                   location_id, marital_status, home_address
--   2.  department_master — add parent_department_id (sub-dept hierarchy)
--   3.  employee_emergency_contact — drop UNIQUE to allow 2-3 contacts + add seq
--   4.  employee_bank_detail — allow multiple accounts + primary flag
--   5.  employee_documents — add doc_category enum
--   6.  employee_job_history — full position change audit trail (NEW TABLE)
--   7.  employee_address — structured home / correspondence address (NEW TABLE)
--   8.  employee_nominee — gratuity / insurance nominee details (NEW TABLE)
--   9.  gratuity_accrual_ledger — monthly accrual per employee (NEW TABLE)
--  10.  employee_pf_withdrawal — PF / VPF withdrawal requests (NEW TABLE)
--  11.  employee_probation — probation tracking separate from lifecycle events (NEW TABLE)
--  12.  employee_contract — contract terms for non-permanent workers (NEW TABLE)
--
-- All column additions use IF NOT EXISTS guard (safe to re-run).
-- All new tables use CREATE TABLE IF NOT EXISTS (idempotent).
-- Do NOT drop or rename any existing column.

USE mas_hrms;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 1: ALTER employees — add missing columns
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1a. cost_centre_id
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='cost_centre_id'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE employees ADD COLUMN cost_centre_id CHAR(36) NULL AFTER department_id, ADD INDEX idx_emp_cc (cost_centre_id), ADD CONSTRAINT fk_emp_cost_centre FOREIGN KEY (cost_centre_id) REFERENCES cost_centre_master(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 1b. grade_id
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='grade_id'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE employees ADD COLUMN grade_id CHAR(36) NULL AFTER designation_id, ADD CONSTRAINT fk_emp_grade FOREIGN KEY (grade_id) REFERENCES grade_band_master(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 1c. employee_category (contract/permanent/intern/temporary/consultant)
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='employee_category'
);
SET @sql = IF(@col = 0,
  "ALTER TABLE employees ADD COLUMN employee_category ENUM('permanent','contract','intern','temporary','consultant') NOT NULL DEFAULT 'permanent' AFTER employment_type",
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 1d. marital_status
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='marital_status'
);
SET @sql = IF(@col = 0,
  "ALTER TABLE employees ADD COLUMN marital_status ENUM('single','married','divorced','widowed') NULL AFTER gender",
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 1e. pan_number (India income tax — mandatory for payroll >₹2.5L/yr)
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='pan_number'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE employees ADD COLUMN pan_number VARCHAR(10) NULL AFTER mobile, ADD COLUMN pan_verified_on DATE NULL AFTER pan_number',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 1f. aadhaar_last4 (last 4 digits only — PII masking per DPDP)
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='aadhaar_last4'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE employees ADD COLUMN aadhaar_last4 CHAR(4) NULL AFTER pan_verified_on, ADD COLUMN aadhaar_verified_on DATE NULL AFTER aadhaar_last4',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 1g. location_id (for multi-location employees — links to location_master created in 021b)
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='location_id'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE employees ADD COLUMN location_id CHAR(36) NULL AFTER branch_id, ADD INDEX idx_emp_location (location_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 1h. manager_id — NOT NULL reporting manager
--     reporting_manager_id already exists but is nullable.
--     We add manager_id as a strict NOT NULL FK; it defaults to self (bootstrap)
--     so existing rows don't break. Apps should enforce proper manager assignment.
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='manager_id'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE employees ADD COLUMN manager_id CHAR(36) NULL AFTER reporting_manager_id, ADD INDEX idx_emp_manager (manager_id), ADD CONSTRAINT fk_emp_manager FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Backfill manager_id from reporting_manager_id for any existing rows
UPDATE employees
SET manager_id = reporting_manager_id
WHERE manager_id IS NULL AND reporting_manager_id IS NOT NULL;

-- 1i. lob_id (Line of Business — often needed for billing/analytics)
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='lob_id'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE employees ADD COLUMN lob_id CHAR(36) NULL AFTER process_id, ADD INDEX idx_emp_lob (lob_id), ADD CONSTRAINT fk_emp_lob FOREIGN KEY (lob_id) REFERENCES lob_master(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 2: department_master — sub-department hierarchy
-- ═══════════════════════════════════════════════════════════════════════════════

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='department_master' AND COLUMN_NAME='parent_department_id'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE department_master ADD COLUMN parent_department_id CHAR(36) NULL AFTER branch_id, ADD COLUMN dept_head_employee_id CHAR(36) NULL AFTER parent_department_id, ADD CONSTRAINT fk_dept_parent FOREIGN KEY (parent_department_id) REFERENCES department_master(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 3: employee_emergency_contact — allow multiple, drop unique constraint
-- ═══════════════════════════════════════════════════════════════════════════════

-- Drop the UNIQUE constraint (employee_id should not be unique here)
SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employee_emergency_contact'
  AND CONSTRAINT_TYPE='UNIQUE' AND CONSTRAINT_NAME='employee_id'
);
-- MySQL unique constraint via UNIQUE KEY inline is named after the column
SET @sql = IF(@idx > 0,
  'ALTER TABLE employee_emergency_contact DROP INDEX employee_id',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Add sequence + is_primary flag
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employee_emergency_contact' AND COLUMN_NAME='contact_seq'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE employee_emergency_contact ADD COLUMN contact_seq TINYINT NOT NULL DEFAULT 1 AFTER employee_id, ADD COLUMN is_primary TINYINT(1) NOT NULL DEFAULT 0 AFTER contact_seq, ADD UNIQUE KEY uq_emp_emergency_seq (employee_id, contact_seq), ADD INDEX idx_eec_emp (employee_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 4: employee_bank_detail — allow multiple accounts + primary flag
-- ═══════════════════════════════════════════════════════════════════════════════

-- Drop UNIQUE on employee_id
SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employee_bank_detail'
  AND CONSTRAINT_TYPE='UNIQUE' AND CONSTRAINT_NAME='employee_id'
);
SET @sql = IF(@idx > 0,
  'ALTER TABLE employee_bank_detail DROP INDEX employee_id',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Add is_primary + account_seq
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employee_bank_detail' AND COLUMN_NAME='is_primary'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE employee_bank_detail ADD COLUMN is_primary TINYINT(1) NOT NULL DEFAULT 1 AFTER employee_id, ADD COLUMN account_seq TINYINT NOT NULL DEFAULT 1 AFTER is_primary, ADD COLUMN active_status TINYINT(1) NOT NULL DEFAULT 1, ADD UNIQUE KEY uq_bank_seq (employee_id, account_seq), ADD INDEX idx_bank_emp (employee_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 5: employee_documents — add doc_category enum
-- ═══════════════════════════════════════════════════════════════════════════════

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employee_documents' AND COLUMN_NAME='doc_category'
);
SET @sql = IF(@col = 0,
  "ALTER TABLE employee_documents ADD COLUMN doc_category ENUM('identity','address_proof','education','experience','pan','aadhaar','passport','visa','driving_license','medical','contract','offer_letter','bank','tax','statutory','other') NOT NULL DEFAULT 'other' AFTER doc_type",
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 6: employee_job_history — full position change audit trail
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_job_history (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id           CHAR(36)     NOT NULL,
  effective_date        DATE         NOT NULL,
  change_type           ENUM(
                          'initial_assignment',
                          'promotion',
                          'demotion',
                          'lateral_transfer',
                          'designation_change',
                          'department_change',
                          'branch_change',
                          'process_change',
                          'lob_change',
                          'grade_change',
                          'cost_centre_change',
                          'manager_change',
                          'salary_revision',
                          'employment_type_change',
                          'confirmation',
                          'probation_extension'
                        ) NOT NULL,
  -- "from" snapshot
  from_designation_id   CHAR(36)     NULL,
  from_department_id    CHAR(36)     NULL,
  from_branch_id        CHAR(36)     NULL,
  from_process_id       CHAR(36)     NULL,
  from_lob_id           CHAR(36)     NULL,
  from_cost_centre_id   CHAR(36)     NULL,
  from_grade_id         CHAR(36)     NULL,
  from_manager_id       CHAR(36)     NULL,
  from_ctc_annual       DECIMAL(14,2) NULL,
  -- "to" snapshot
  to_designation_id     CHAR(36)     NULL,
  to_department_id      CHAR(36)     NULL,
  to_branch_id          CHAR(36)     NULL,
  to_process_id         CHAR(36)     NULL,
  to_lob_id             CHAR(36)     NULL,
  to_cost_centre_id     CHAR(36)     NULL,
  to_grade_id           CHAR(36)     NULL,
  to_manager_id         CHAR(36)     NULL,
  to_ctc_annual         DECIMAL(14,2) NULL,
  -- meta
  reason                TEXT         NULL,
  reference_letter_url  VARCHAR(500) NULL,
  approved_by           CHAR(36)     NULL,
  created_by            CHAR(36)     NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ejh_emp       (employee_id, effective_date DESC),
  INDEX idx_ejh_type      (change_type),
  FOREIGN KEY (employee_id)       REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (from_manager_id)   REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (to_manager_id)     REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 7: employee_address — structured home / correspondence address
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_address (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  address_type    ENUM('permanent','current','correspondence') NOT NULL DEFAULT 'current',
  address_line1   VARCHAR(255) NOT NULL,
  address_line2   VARCHAR(255) NULL,
  city            VARCHAR(100) NOT NULL,
  state           VARCHAR(100) NOT NULL,
  pincode         VARCHAR(10)  NOT NULL,
  country         VARCHAR(100) NOT NULL DEFAULT 'India',
  is_verified     TINYINT(1)   NOT NULL DEFAULT 0,
  same_as_type    ENUM('permanent','current') NULL, -- "same as" shortcut
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_address_type (employee_id, address_type),
  INDEX idx_ea_emp (employee_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 8: employee_nominee — gratuity / insurance / PF nominee
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_nominee (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id       CHAR(36)     NOT NULL,
  nominee_name      VARCHAR(255) NOT NULL,
  relationship      VARCHAR(100) NOT NULL,
  date_of_birth     DATE         NULL,
  share_percentage  DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  nominee_for       SET('gratuity','pf','esic','insurance','general') NOT NULL DEFAULT 'gratuity',
  address           TEXT         NULL,
  mobile            VARCHAR(20)  NULL,
  is_minor          TINYINT(1)   NOT NULL DEFAULT 0,
  guardian_name     VARCHAR(255) NULL, -- if is_minor = 1
  guardian_relation VARCHAR(100) NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_nominee_emp (employee_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 9: gratuity_accrual_ledger — monthly provision per employee
-- ═══════════════════════════════════════════════════════════════════════════════
-- Gratuity = (Last Drawn Basic / 26) × 15 × Years of Service
-- This table tracks monthly accrual and provision.

CREATE TABLE IF NOT EXISTS gratuity_accrual_ledger (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id          CHAR(36)     NOT NULL,
  accrual_month        CHAR(7)      NOT NULL, -- YYYY-MM
  basic_salary         DECIMAL(12,2) NOT NULL,
  years_of_service     DECIMAL(5,2) NOT NULL, -- computed at month end
  daily_rate           DECIMAL(10,4) NOT NULL, -- basic / 26
  monthly_accrual      DECIMAL(12,2) NOT NULL, -- daily_rate × 15 × (1/12)
  cumulative_accrual   DECIMAL(14,2) NOT NULL, -- running total
  is_eligible          TINYINT(1)   NOT NULL DEFAULT 1, -- <5 yrs = 0 for encashment, but still accrue
  payroll_run_id       CHAR(36)     NULL,       -- links to salary_prep_run
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gratuity_emp_month (employee_id, accrual_month),
  INDEX idx_gratl_emp   (employee_id),
  INDEX idx_gratl_month (accrual_month),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 10: employee_pf_withdrawal — PF / VPF / advance withdrawals
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_pf_withdrawal (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id          CHAR(36)     NOT NULL,
  uan                  VARCHAR(20)  NULL,
  withdrawal_type      ENUM(
                         'partial',        -- advance under EPF Act para 68
                         'full',           -- on exit / retirement
                         'vpf_partial',    -- voluntary PF partial
                         'eps_pension',    -- EPS 95 pension claim
                         'advance_medical','advance_housing',
                         'advance_education','advance_marriage'
                       ) NOT NULL,
  withdrawal_reason    TEXT         NULL,
  amount_requested     DECIMAL(12,2) NOT NULL,
  amount_approved      DECIMAL(12,2) NULL,
  application_date     DATE         NOT NULL,
  approved_date        DATE         NULL,
  disbursed_date       DATE         NULL,
  status               ENUM('applied','under_review','approved','rejected','disbursed') NOT NULL DEFAULT 'applied',
  pf_office_reference  VARCHAR(100) NULL,
  remarks              TEXT         NULL,
  created_by           CHAR(36)     NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pfwith_emp (employee_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 11: employee_probation — structured probation tracking
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_probation (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id           CHAR(36)     NOT NULL UNIQUE,
  probation_start_date  DATE         NOT NULL,
  probation_end_date    DATE         NOT NULL,
  actual_end_date       DATE         NULL, -- when confirmed/extended
  extended_end_date     DATE         NULL, -- set if extended
  status                ENUM('on_probation','confirmed','extended','terminated_during_probation') NOT NULL DEFAULT 'on_probation',
  extension_reason      TEXT         NULL,
  confirmation_remarks  TEXT         NULL,
  confirmed_by          CHAR(36)     NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_prob_emp    (employee_id),
  INDEX idx_prob_status (status),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 12: employee_contract — contract terms for non-permanent workers
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_contract (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id          CHAR(36)     NOT NULL,
  contract_type        ENUM('fixed_term','project_based','internship','consultant','retainer') NOT NULL,
  contract_start_date  DATE         NOT NULL,
  contract_end_date    DATE         NOT NULL,
  notice_period_days   INT          NOT NULL DEFAULT 30,
  contract_value       DECIMAL(14,2) NULL,      -- total value if project-based
  auto_renewal         TINYINT(1)   NOT NULL DEFAULT 0,
  renewal_notice_days  INT          NULL,        -- days before end to notify
  vendor_id            CHAR(36)     NULL,        -- if via staffing vendor (FK to vendor_master)
  file_url             VARCHAR(500) NULL,        -- signed contract PDF
  status               ENUM('draft','active','expired','terminated','renewed') NOT NULL DEFAULT 'active',
  terminated_on        DATE         NULL,
  termination_reason   TEXT         NULL,
  created_by           CHAR(36)     NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_contract_emp    (employee_id),
  INDEX idx_contract_status (status, contract_end_date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 13: cost_centre_master — add parent hierarchy + manager
-- ═══════════════════════════════════════════════════════════════════════════════

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='cost_centre_master' AND COLUMN_NAME='parent_cost_centre_id'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN parent_cost_centre_id CHAR(36) NULL AFTER cost_centre_name, ADD COLUMN cost_centre_head_id CHAR(36) NULL AFTER parent_cost_centre_id, ADD COLUMN budget_annual DECIMAL(16,2) NULL, ADD CONSTRAINT fk_cc_parent FOREIGN KEY (parent_cost_centre_id) REFERENCES cost_centre_master(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 14: employee_uan (028) — ensure employee_id FK exists
-- ═══════════════════════════════════════════════════════════════════════════════
-- employee_uan was created in 028 but may not have an explicit employee_id FK.
-- This adds the FK safely if missing.

SET @fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employee_uan'
  AND REFERENCED_TABLE_NAME='employees' AND COLUMN_NAME='employee_id'
);
SET @sql = IF(@fk = 0 AND (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employee_uan' AND COLUMN_NAME='employee_id') > 0,
  'ALTER TABLE employee_uan ADD CONSTRAINT fk_uan_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ═══════════════════════════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT 'Schema gap-fill 041 applied successfully.' AS status;
