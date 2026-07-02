-- 009_dialer_ispark.sql
USE mas_hrms;

-- One row per employee per dialer per day.
-- A user active on 3 dialers = 3 rows, same employee_code + session_date.
-- Consolidated total for payroll/KPI: SELECT employee_code, session_date, SUM(login_minutes) GROUP BY employee_code, session_date
CREATE TABLE IF NOT EXISTS dialer_session_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_code   VARCHAR(50)  NOT NULL,
  employee_id     CHAR(36),
  session_date    DATE         NOT NULL,
  integration_key VARCHAR(100) NOT NULL,
  dialer_name     VARCHAR(255),
  login_minutes   INT          NOT NULL DEFAULT 0,
  process_name    VARCHAR(255),
  branch_name     VARCHAR(255),
  run_id          CHAR(36),
  imported_by     CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dialer_emp_date_key (employee_code, session_date, integration_key),
  INDEX idx_dialer_emp (employee_code),
  INDEX idx_dialer_date (session_date),
  INDEX idx_dialer_key (integration_key),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ispark_migration_batch (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  batch_ref    VARCHAR(100) NOT NULL UNIQUE,
  source_file  VARCHAR(500),
  total_rows   INT          NOT NULL DEFAULT 0,
  valid_rows   INT          NOT NULL DEFAULT 0,
  invalid_rows INT          NOT NULL DEFAULT 0,
  promoted_rows INT         NOT NULL DEFAULT 0,
  batch_status VARCHAR(50)  NOT NULL DEFAULT 'uploaded',
  created_by   CHAR(36),
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ispark_employee_staging (
  id                   CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  batch_id             CHAR(36)    NOT NULL,
  raw_json             JSON        NOT NULL,
  emp_code             VARCHAR(50),
  first_name           VARCHAR(100),
  last_name            VARCHAR(100),
  email                VARCHAR(255),
  mobile               VARCHAR(20),
  department_name      VARCHAR(255),
  designation_name     VARCHAR(255),
  branch_name          VARCHAR(255),
  process_name         VARCHAR(255),
  date_of_joining      DATE,
  validation_status    VARCHAR(50) NOT NULL DEFAULT 'pending',
  validation_errors    JSON,
  promoted_employee_id CHAR(36),
  promoted_at          DATETIME,
  uploaded_by          CHAR(36),
  created_at           DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id)             REFERENCES ispark_migration_batch(id) ON DELETE CASCADE,
  FOREIGN KEY (promoted_employee_id) REFERENCES employees(id)              ON DELETE SET NULL,
  INDEX idx_ispark_batch (batch_id),
  INDEX idx_ispark_status (validation_status)
);
