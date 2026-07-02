-- 007_payroll.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS statutory_config (
  id             CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  config_key     VARCHAR(100)   NOT NULL UNIQUE,
  config_value   DECIMAL(10,4)  NOT NULL,
  description    VARCHAR(255),
  effective_from DATE,
  updated_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salary_structure_master (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  structure_code VARCHAR(50)  NOT NULL UNIQUE,
  structure_name VARCHAR(255) NOT NULL,
  description    TEXT,
  basic_pct      DECIMAL(5,2) NOT NULL DEFAULT 40.00,
  hra_pct        DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salary_component_master (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  component_code VARCHAR(50)  NOT NULL UNIQUE,
  component_name VARCHAR(100) NOT NULL,
  component_type VARCHAR(50)  NOT NULL,
  taxable        TINYINT(1)   NOT NULL DEFAULT 1,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salary_structure_component (
  id           CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  structure_id CHAR(36)       NOT NULL,
  component_id CHAR(36)       NOT NULL,
  calc_type    VARCHAR(50)    NOT NULL DEFAULT 'fixed',
  value        DECIMAL(10,4)  NOT NULL DEFAULT 0,
  sequence     INT            NOT NULL DEFAULT 1,
  UNIQUE KEY uq_struct_comp (structure_id, component_id),
  FOREIGN KEY (structure_id) REFERENCES salary_structure_master(id)  ON DELETE CASCADE,
  FOREIGN KEY (component_id) REFERENCES salary_component_master(id)  ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_salary_assignment (
  id            CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id   CHAR(36)       NOT NULL,
  structure_id  CHAR(36)       NOT NULL,
  ctc_annual    DECIMAL(12,2)  NOT NULL DEFAULT 0,
  effective_from DATE          NOT NULL,
  effective_to  DATE,
  active_status TINYINT(1)     NOT NULL DEFAULT 1,
  created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id)  REFERENCES employees(id)               ON DELETE CASCADE,
  FOREIGN KEY (structure_id) REFERENCES salary_structure_master(id),
  INDEX idx_sal_emp (employee_id)
);

CREATE TABLE IF NOT EXISTS salary_deduction_rule (
  id            CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  rule_name     VARCHAR(255)   NOT NULL,
  rule_type     VARCHAR(50)    NOT NULL,
  applies_to    VARCHAR(100)   NOT NULL DEFAULT 'all',
  value         DECIMAL(10,4)  NOT NULL DEFAULT 0,
  active_status TINYINT(1)     NOT NULL DEFAULT 1,
  created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salary_prep_run (
  id               CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_month        VARCHAR(7)     NOT NULL,
  branch_filter    VARCHAR(255),
  process_filter   VARCHAR(255),
  status           VARCHAR(50)    NOT NULL DEFAULT 'draft',
  total_employees  INT            NOT NULL DEFAULT 0,
  total_gross      DECIMAL(14,2)  NOT NULL DEFAULT 0,
  total_deductions DECIMAL(14,2)  NOT NULL DEFAULT 0,
  total_net        DECIMAL(14,2)  NOT NULL DEFAULT 0,
  created_by       CHAR(36),
  approved_by      CHAR(36),
  disbursed_by     CHAR(36),
  disbursed_at     DATETIME,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_run_month_branch_process (run_month, branch_filter, process_filter),
  INDEX idx_run_month (run_month)
);

CREATE TABLE IF NOT EXISTS salary_prep_line (
  id               CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_id           CHAR(36)       NOT NULL,
  employee_id      CHAR(36)       NOT NULL,
  employee_code    VARCHAR(50)    NOT NULL,
  working_days     DECIMAL(6,2)   NOT NULL DEFAULT 0,
  present_days     DECIMAL(6,2)   NOT NULL DEFAULT 0,
  leave_days       DECIMAL(6,2)   NOT NULL DEFAULT 0,
  lwp_days         DECIMAL(6,2)   NOT NULL DEFAULT 0,
  late_marks       INT            NOT NULL DEFAULT 0,
  dialer_hours     DECIMAL(8,2),
  gross_salary     DECIMAL(12,2)  NOT NULL DEFAULT 0,
  total_deductions DECIMAL(12,2)  NOT NULL DEFAULT 0,
  net_salary       DECIMAL(12,2)  NOT NULL DEFAULT 0,
  pf_employee      DECIMAL(10,2)  NOT NULL DEFAULT 0,
  pf_employer      DECIMAL(10,2)  NOT NULL DEFAULT 0,
  esic_employee    DECIMAL(10,2)  NOT NULL DEFAULT 0,
  esic_employer    DECIMAL(10,2)  NOT NULL DEFAULT 0,
  professional_tax DECIMAL(10,2)  NOT NULL DEFAULT 0,
  tds              DECIMAL(10,2)  NOT NULL DEFAULT 0,
  remarks          TEXT,
  status           VARCHAR(50)    NOT NULL DEFAULT 'draft',
  UNIQUE KEY uq_run_emp (run_id, employee_id),
  FOREIGN KEY (run_id)      REFERENCES salary_prep_run(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id)       ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS salary_advance_log (
  id               CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id      CHAR(36)       NOT NULL,
  advance_date     DATE           NOT NULL,
  amount           DECIMAL(12,2)  NOT NULL,
  recovery_months  INT            NOT NULL DEFAULT 1,
  recovered_amount DECIMAL(12,2)  NOT NULL DEFAULT 0,
  status           VARCHAR(50)    NOT NULL DEFAULT 'active',
  notes            TEXT,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS salary_payslip (
  id           CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  prep_line_id CHAR(36)    NOT NULL UNIQUE,
  employee_id  CHAR(36)    NOT NULL,
  run_month    VARCHAR(7)  NOT NULL,
  file_url     VARCHAR(500),
  generated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prep_line_id) REFERENCES salary_prep_line(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id)  REFERENCES employees(id)        ON DELETE CASCADE
);

INSERT INTO statutory_config (config_key, config_value, description) VALUES
  ('PF_EMPLOYEE_PCT',   12.00,    'Employee PF contribution % of Basic'),
  ('PF_EMPLOYER_PCT',   12.00,    'Employer PF contribution % of Basic'),
  ('ESIC_EMPLOYEE_PCT',  0.75,    'Employee ESIC contribution % of Gross'),
  ('ESIC_EMPLOYER_PCT',  3.25,    'Employer ESIC contribution % of Gross'),
  ('ESIC_WAGE_LIMIT',  21000.00,  'ESIC applicable if gross <= this amount'),
  ('PF_WAGE_LIMIT',    15000.00,  'PF statutory ceiling on Basic')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

INSERT INTO salary_component_master (component_code, component_name, component_type, taxable) VALUES
  ('BASIC',    'Basic Salary',          'earning',   1),
  ('HRA',      'House Rent Allowance',  'earning',   1),
  ('TA',       'Travel Allowance',      'earning',   0),
  ('SPECIAL',  'Special Allowance',     'earning',   1),
  ('PF_EMP',   'PF Employee',           'deduction', 0),
  ('ESIC_EMP', 'ESIC Employee',         'deduction', 0),
  ('PT',       'Professional Tax',      'statutory', 0),
  ('TDS',      'Tax Deducted at Source','statutory', 0),
  ('LWP_DED',  'LWP Deduction',         'deduction', 0)
ON DUPLICATE KEY UPDATE component_name = VALUES(component_name);
