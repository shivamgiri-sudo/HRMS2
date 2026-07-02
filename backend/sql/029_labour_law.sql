USE mas_hrms;

-- Bonus Act 1965
CREATE TABLE IF NOT EXISTS bonus_calculation (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  financial_year  VARCHAR(9)   NOT NULL COMMENT 'e.g. 2025-2026',
  monthly_salary  DECIMAL(10,2) NOT NULL,
  annual_salary   DECIMAL(12,2) NOT NULL,
  eligible        TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 if salary ≤ ₹21,000/month',
  allocable_surplus_pct DECIMAL(5,2) NOT NULL DEFAULT 8.33,
  calculated_bonus DECIMAL(12,2) NOT NULL DEFAULT 0,
  min_bonus       DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '8.33% of ₹7,000 or min wage',
  max_bonus       DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '20% of salary',
  status          ENUM('calculated','approved','paid') NOT NULL DEFAULT 'calculated',
  approved_by     CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bonus (employee_id, financial_year),
  INDEX idx_bonus_emp (employee_id)
);

-- POSH Act 2013 — ICC Complaint Register
CREATE TABLE IF NOT EXISTS posh_complaint (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  complaint_ref   VARCHAR(32)  NOT NULL UNIQUE,
  complainant_anon_id VARCHAR(64) NOT NULL COMMENT 'Anonymised — no real name stored in this field',
  respondent_anon_id  VARCHAR(64) COMMENT 'Anonymised',
  branch_id       CHAR(36),
  date_of_complaint DATE        NOT NULL,
  nature_of_complaint TEXT,
  icc_members     JSON         COMMENT 'Array of user_ids of ICC committee members',
  status          ENUM('received','under_inquiry','settled','closed','referred_to_police') NOT NULL DEFAULT 'received',
  outcome         ENUM('substantiated','not_substantiated','malicious_complaint','conciliation') NULL,
  closure_date    DATE,
  annual_report_year INT        COMMENT 'For annual report aggregation',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_posh_year (annual_report_year)
);

-- Maternity Benefit Act 1961
CREATE TABLE IF NOT EXISTS maternity_benefit_record (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  expected_delivery_date DATE,
  actual_delivery_date   DATE,
  leave_start_date       DATE  NOT NULL,
  leave_end_date         DATE,
  paid_weeks      INT          NOT NULL DEFAULT 26 COMMENT 'Standard 26 weeks',
  nursing_break_weeks INT      NOT NULL DEFAULT 0,
  complications   TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 if additional 4 weeks granted',
  status          ENUM('applied','approved','active','completed','rejected') NOT NULL DEFAULT 'applied',
  approved_by     CHAR(36),
  notes           TEXT,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_maternity_emp (employee_id)
);
