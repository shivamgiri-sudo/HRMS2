-- 005_attendance_wfm.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS wfm_shift_master (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  shift_code       VARCHAR(50)  NOT NULL UNIQUE,
  shift_name       VARCHAR(255) NOT NULL,
  start_time       TIME         NOT NULL,
  end_time         TIME         NOT NULL,
  required_minutes INT          NOT NULL DEFAULT 540,
  branch_name      VARCHAR(255),
  process_name     VARCHAR(255),
  active_status    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wfm_roster_plan (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  plan_name          VARCHAR(255) NOT NULL,
  process_id         CHAR(36),
  branch_id          CHAR(36),
  shift_id           CHAR(36),
  from_date          DATE         NOT NULL,
  to_date            DATE         NOT NULL,
  required_headcount INT          NOT NULL DEFAULT 0,
  assigned_headcount INT          NOT NULL DEFAULT 0,
  plan_status        VARCHAR(50)  NOT NULL DEFAULT 'draft',
  created_by         CHAR(36),
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (process_id) REFERENCES process_master(id)    ON DELETE SET NULL,
  FOREIGN KEY (branch_id)  REFERENCES branch_master(id)     ON DELETE SET NULL,
  FOREIGN KEY (shift_id)   REFERENCES wfm_shift_master(id)  ON DELETE SET NULL,
  INDEX idx_roster_plan_dates (from_date, to_date)
);

CREATE TABLE IF NOT EXISTS wfm_roster_assignment (
  id                      CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id             CHAR(36)    NOT NULL,
  shift_id                CHAR(36),
  plan_id                 CHAR(36),
  roster_date             DATE        NOT NULL,
  roster_status           VARCHAR(50) NOT NULL DEFAULT 'Rostered',
  branch_name             VARCHAR(255),
  process_name            VARCHAR(255),
  manager_employee_id     CHAR(36),
  team_leader_employee_id CHAR(36),
  publish_status          VARCHAR(50) NOT NULL DEFAULT 'draft',
  created_at              DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_date (employee_id, roster_date),
  FOREIGN KEY (employee_id) REFERENCES employees(id)        ON DELETE CASCADE,
  FOREIGN KEY (shift_id)    REFERENCES wfm_shift_master(id) ON DELETE SET NULL,
  FOREIGN KEY (plan_id)     REFERENCES wfm_roster_plan(id)  ON DELETE SET NULL,
  INDEX idx_roster_date (roster_date)
);

CREATE TABLE IF NOT EXISTS wfm_attendance_session (
  id                   CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id          CHAR(36)    NOT NULL,
  roster_assignment_id CHAR(36),
  session_date         DATE        NOT NULL,
  login_time           DATETIME,
  logout_time          DATETIME,
  total_login_minutes  INT         NOT NULL DEFAULT 0,
  current_status       VARCHAR(50) NOT NULL DEFAULT 'Rostered',
  punch_source         VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
  external_punch_id    VARCHAR(255),
  facial_device_id     CHAR(36),
  biometric_user_code  VARCHAR(100),
  branch_name          VARCHAR(255),
  process_name         VARCHAR(255),
  regularization_id    CHAR(36),
  created_at           DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_session_date (employee_id, session_date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_session_date (session_date),
  INDEX idx_session_status (current_status)
);

CREATE TABLE IF NOT EXISTS wfm_break_log (
  id               CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  session_id       CHAR(36)    NOT NULL,
  employee_id      CHAR(36)    NOT NULL,
  break_start      DATETIME    NOT NULL,
  break_end        DATETIME,
  duration_minutes INT         NOT NULL DEFAULT 0,
  break_type       VARCHAR(50) NOT NULL DEFAULT 'Break',
  punch_source     VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
  created_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id)  REFERENCES wfm_attendance_session(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id)              ON DELETE CASCADE,
  INDEX idx_break_session (session_id)
);

-- secret_name stores Supabase Vault key name — NOT the actual device IP or password
CREATE TABLE IF NOT EXISTS wfm_facial_device_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  device_code   VARCHAR(100) NOT NULL UNIQUE,
  device_name   VARCHAR(255),
  branch_id     CHAR(36),
  location      VARCHAR(255),
  device_type   VARCHAR(100),
  secret_name   VARCHAR(255),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wfm_external_punch_staging (
  id                 CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  device_id          CHAR(36),
  external_punch_id  VARCHAR(255),
  employee_code      VARCHAR(50),
  punch_time         DATETIME    NOT NULL,
  punch_type         VARCHAR(50) NOT NULL DEFAULT 'IN',
  raw_data           JSON,
  apply_status       VARCHAR(50) NOT NULL DEFAULT 'pending',
  applied_session_id CHAR(36),
  error_message      TEXT,
  created_at         DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES wfm_facial_device_master(id) ON DELETE SET NULL,
  INDEX idx_punch_staging_status (apply_status),
  INDEX idx_punch_staging_code (employee_code)
);

CREATE TABLE IF NOT EXISTS attendance_regularization (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id           CHAR(36)     NOT NULL,
  session_date          DATE         NOT NULL,
  reason                VARCHAR(500) NOT NULL,
  supporting_note       TEXT,
  status                VARCHAR(50)  NOT NULL DEFAULT 'pending',
  reviewed_by           CHAR(36),
  reviewed_at           DATETIME,
  reviewer_note         TEXT,
  applied_to_session_id CHAR(36),
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_reg_employee (employee_id),
  INDEX idx_reg_status (status)
);
