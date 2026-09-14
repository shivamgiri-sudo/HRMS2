-- 129_ats_recruiter_roster.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS ats_recruiter_roster (
  id                  CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  name                VARCHAR(255)   NOT NULL,
  recruiter_code      VARCHAR(50)    NOT NULL UNIQUE,
  pin_hash            VARCHAR(255)   NOT NULL COMMENT 'bcrypt hash of PIN',
  email               VARCHAR(255),
  mobile              VARCHAR(20),
  branch              VARCHAR(255),
  employee_id         CHAR(36),
  available_today     ENUM('Y','N')  NOT NULL DEFAULT 'N',
  assigned_today      INT            NOT NULL DEFAULT 0,
  daily_capacity      INT            NOT NULL DEFAULT 20,
  role_coverage       VARCHAR(500),
  reporting_manager   VARCHAR(255),
  branch_head_email   VARCHAR(255),
  active_status       TINYINT(1)     NOT NULL DEFAULT 1,
  last_assigned_at    DATETIME,
  created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_recruiter_branch (branch),
  INDEX idx_recruiter_active (active_status),
  INDEX idx_recruiter_available (available_today)
);
