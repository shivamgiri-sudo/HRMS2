-- 002_employees.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS employees (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_code        VARCHAR(50)  NOT NULL UNIQUE,
  user_id              CHAR(36),
  first_name           VARCHAR(100) NOT NULL,
  last_name            VARCHAR(100),
  full_name            VARCHAR(255) GENERATED ALWAYS AS (CONCAT(first_name, ' ', COALESCE(last_name,''))) STORED,
  email                VARCHAR(255),
  mobile               VARCHAR(20),
  gender               ENUM('Male','Female','Other'),
  date_of_birth        DATE,
  date_of_joining      DATE         NOT NULL,  -- physical joining date (day 1 in office)
  salary_start_date    DATE,                   -- payroll counts from this date; defaults to date_of_joining if NULL
  date_of_exit         DATE,
  employment_type      VARCHAR(50)  NOT NULL DEFAULT 'Full Time',
  employment_status    VARCHAR(50)  NOT NULL DEFAULT 'Active',
  branch_id            CHAR(36),
  department_id        CHAR(36),
  process_id           CHAR(36),
  designation_id       CHAR(36),
  reporting_manager_id CHAR(36),
  active_status        TINYINT(1)   NOT NULL DEFAULT 1,
  photo_url            VARCHAR(500),
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_emp_code (employee_code),
  INDEX idx_emp_user (user_id),
  INDEX idx_emp_branch (branch_id),
  INDEX idx_emp_process (process_id),
  FOREIGN KEY (branch_id)      REFERENCES branch_master(id)      ON DELETE SET NULL,
  FOREIGN KEY (department_id)  REFERENCES department_master(id)  ON DELETE SET NULL,
  FOREIGN KEY (process_id)     REFERENCES process_master(id)     ON DELETE SET NULL,
  FOREIGN KEY (designation_id) REFERENCES designation_master(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36)     NOT NULL,
  doc_type    VARCHAR(100) NOT NULL,
  doc_name    VARCHAR(255),
  file_url    VARCHAR(500),
  verified    TINYINT(1)   NOT NULL DEFAULT 0,
  uploaded_by CHAR(36),
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_emp_doc_emp (employee_id)
);

CREATE TABLE IF NOT EXISTS employee_emergency_contact (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id  CHAR(36)     NOT NULL UNIQUE,
  name         VARCHAR(255) NOT NULL,
  relationship VARCHAR(100),
  mobile       VARCHAR(20)  NOT NULL,
  address      TEXT,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_bank_detail (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id    CHAR(36)      NOT NULL UNIQUE,
  bank_name      VARCHAR(255),
  account_number VARBINARY(500),
  ifsc_code      VARCHAR(20),
  account_type   VARCHAR(50)   DEFAULT 'Savings',
  upi_id         VARCHAR(255),
  verified       TINYINT(1)    NOT NULL DEFAULT 0,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_journey_log (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36)     NOT NULL,
  event_type  VARCHAR(100) NOT NULL,
  event_date  DATE         NOT NULL,
  description TEXT,
  old_value   VARCHAR(500),
  new_value   VARCHAR(500),
  module      VARCHAR(50),
  triggered_by CHAR(36),
  metadata    JSON,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_journey_emp (employee_id),
  INDEX idx_journey_date (event_date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);
