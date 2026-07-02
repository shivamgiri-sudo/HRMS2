-- 003_access_control.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS workforce_role_catalog (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  role_key      VARCHAR(100) NOT NULL UNIQUE,
  role_name     VARCHAR(255) NOT NULL,
  description   TEXT,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_roles (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id       CHAR(36)     NOT NULL,
  role_key      VARCHAR(100) NOT NULL,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_role (user_id, role_key),
  INDEX idx_user_roles_user (user_id),
  FOREIGN KEY (role_key) REFERENCES workforce_role_catalog(role_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_assignment_scope (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id             CHAR(36)     NOT NULL,
  role_key            VARCHAR(100) NOT NULL,
  scope_type          VARCHAR(50)  NOT NULL,
  branch_id           CHAR(36),
  process_id          CHAR(36),
  lob_id              CHAR(36),
  department_id       CHAR(36),
  manager_employee_id CHAR(36),
  active_status       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_scope_user (user_id)
);

CREATE TABLE IF NOT EXISTS role_page_access (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  role_key      VARCHAR(100) NOT NULL,
  page_code     VARCHAR(100) NOT NULL,
  can_view      TINYINT(1)   NOT NULL DEFAULT 0,
  can_create    TINYINT(1)   NOT NULL DEFAULT 0,
  can_edit      TINYINT(1)   NOT NULL DEFAULT 0,
  can_delete    TINYINT(1)   NOT NULL DEFAULT 0,
  can_export    TINYINT(1)   NOT NULL DEFAULT 0,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_page (role_key, page_code),
  INDEX idx_role_page_role (role_key)
);

INSERT INTO workforce_role_catalog (role_key, role_name) VALUES
  ('admin',       'System Administrator'),
  ('hr',          'HR Manager'),
  ('manager',     'Process Manager'),
  ('tl',          'Team Leader'),
  ('qa',          'Quality Analyst'),
  ('wfm',         'WFM Analyst'),
  ('recruiter',   'Recruiter'),
  ('employee',    'Employee'),
  ('branch_head', 'Branch Head'),
  ('ceo',         'CEO / Leadership')
ON DUPLICATE KEY UPDATE role_name = VALUES(role_name);

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
  ('admin','ATS_DASHBOARD',           1,1,1,1,1),
  ('admin','ATS_RECRUITER_QUEUE',      1,1,1,1,1),
  ('admin','LMS_MY_LEARNING',          1,1,1,1,1),
  ('admin','LMS_COORDINATOR',          1,1,1,1,1),
  ('admin','LMS_ADMIN',                1,1,1,1,1),
  ('admin','LMS_MANAGEMENT_DASHBOARD', 1,1,1,1,1),
  ('admin','WFM_ROSTER',               1,1,1,1,1),
  ('admin','WFM_LIVE_TRACKER',         1,1,1,1,1),
  ('admin','QUALITY_DASHBOARD',        1,1,1,1,1),
  ('admin','OPERATIONS_DASHBOARD',     1,1,1,1,1),
  ('admin','WORKFORCE_COMMAND_CENTER', 1,1,1,1,1),
  ('admin','ACCESS_CONTROL',           1,1,1,1,1),
  ('admin','DIALER_INTEGRATION',       1,1,1,1,1),
  ('admin','LEAVE_MANAGEMENT',         1,1,1,1,1),
  ('admin','SALARY_PREP',              1,1,1,1,1),
  ('admin','KPI_DASHBOARD',            1,1,1,1,1),
  ('admin','ISPARK_MIGRATION',         1,1,1,1,1),
  ('admin','INTEGRATION_HUB',          1,1,1,1,1),
  ('admin','MIGRATION_CONSOLE',        1,1,1,1,1)
ON DUPLICATE KEY UPDATE can_view=1, can_create=1, can_edit=1, can_delete=1, can_export=1;
