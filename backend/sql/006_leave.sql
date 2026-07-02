-- 006_leave.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS leave_type_master (
  id                CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  leave_code        VARCHAR(20) NOT NULL UNIQUE,
  leave_name        VARCHAR(100) NOT NULL,
  max_days_per_year INT         NOT NULL DEFAULT 0,
  carry_forward     TINYINT(1)  NOT NULL DEFAULT 0,
  requires_approval TINYINT(1)  NOT NULL DEFAULT 1,
  paid_leave        TINYINT(1)  NOT NULL DEFAULT 1,
  active_status     TINYINT(1)  NOT NULL DEFAULT 1,
  created_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leave_holiday_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  holiday_name  VARCHAR(255) NOT NULL,
  holiday_date  DATE         NOT NULL,
  holiday_type  VARCHAR(50)  NOT NULL DEFAULT 'national',
  branch_id     CHAR(36),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL,
  INDEX idx_holiday_date (holiday_date)
);

CREATE TABLE IF NOT EXISTS leave_balance_ledger (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id    CHAR(36)      NOT NULL,
  leave_type_id  CHAR(36)      NOT NULL,
  balance_year   INT           NOT NULL,
  allocated_days DECIMAL(6,2)  NOT NULL DEFAULT 0,
  used_days      DECIMAL(6,2)  NOT NULL DEFAULT 0,
  adjusted_days  DECIMAL(6,2)  NOT NULL DEFAULT 0,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_leave_year (employee_id, leave_type_id, balance_year),
  FOREIGN KEY (employee_id)  REFERENCES employees(id)        ON DELETE CASCADE,
  FOREIGN KEY (leave_type_id) REFERENCES leave_type_master(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leave_request (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id   CHAR(36)      NOT NULL,
  leave_type_id CHAR(36)      NOT NULL,
  from_date     DATE          NOT NULL,
  to_date       DATE          NOT NULL,
  total_days    DECIMAL(6,2)  NOT NULL,
  reason        TEXT,
  status        VARCHAR(50)   NOT NULL DEFAULT 'pending',
  applied_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id)   REFERENCES employees(id)          ON DELETE CASCADE,
  FOREIGN KEY (leave_type_id) REFERENCES leave_type_master(id),
  INDEX idx_leave_emp (employee_id),
  INDEX idx_leave_status (status)
);

CREATE TABLE IF NOT EXISTS leave_approval_log (
  id               CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  leave_request_id CHAR(36)    NOT NULL,
  action           VARCHAR(50) NOT NULL,
  action_by        CHAR(36)    NOT NULL,
  action_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remarks          TEXT,
  FOREIGN KEY (leave_request_id) REFERENCES leave_request(id) ON DELETE CASCADE
);

INSERT INTO leave_type_master (leave_code, leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave) VALUES
  ('CL',  'Casual Leave',      12, 0, 1, 1),
  ('SL',  'Sick Leave',         7, 0, 1, 1),
  ('EL',  'Earned Leave',      15, 1, 1, 1),
  ('ML',  'Maternity Leave',   90, 0, 1, 1),
  ('PL',  'Paternity Leave',    5, 0, 1, 1),
  ('LWP', 'Leave Without Pay',  0, 0, 1, 0)
ON DUPLICATE KEY UPDATE leave_name = VALUES(leave_name);
