-- 020_roster_governance.sql
-- Package B: Roster and Shift Governance
-- Additive only. Do not execute on production without explicit approval.
USE mas_hrms;

CREATE TABLE IF NOT EXISTS wfm_shift_template (
  id                 CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  shift_code         VARCHAR(50)    NOT NULL,
  version            INT            NOT NULL DEFAULT 1,
  shift_name         VARCHAR(255)   NOT NULL,
  process_id         CHAR(36),
  branch_id          CHAR(36),
  start_time         TIME           NOT NULL,
  end_time           TIME           NOT NULL,
  productive_minutes INT            NOT NULL DEFAULT 420,
  grace_minutes      INT            NOT NULL DEFAULT 5,
  break_entitlement  INT            NOT NULL DEFAULT 30,
  weekly_off_pattern VARCHAR(50)    DEFAULT 'sunday',
  night_shift        TINYINT(1)     NOT NULL DEFAULT 0,
  eligibility_rules  JSON,
  effective_from     DATE           NOT NULL,
  effective_to       DATE,
  active_status      TINYINT(1)     NOT NULL DEFAULT 1,
  created_by         CHAR(36),
  created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shift_version (shift_code, version),
  INDEX idx_st_process (process_id),
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id)  REFERENCES branch_master(id)  ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS weekly_roster_cycle (
  id                CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id        CHAR(36)       NOT NULL,
  branch_id         CHAR(36),
  week_start_date   DATE           NOT NULL,
  week_end_date     DATE           NOT NULL,
  status            ENUM('draft','submitted','reviewed','published','acknowledged','active','variance_review','attendance_locked','payroll_input_ready','closed') NOT NULL DEFAULT 'draft',
  required_hc_json  JSON,
  published_by      CHAR(36),
  published_at      DATETIME,
  locked_at         DATETIME,
  payroll_ready_at  DATETIME,
  created_by        CHAR(36)       NOT NULL,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cycle (process_id, week_start_date),
  INDEX idx_cycle_process (process_id),
  INDEX idx_cycle_status (status),
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id)  REFERENCES branch_master(id)  ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS roster_daily_assignment (
  id                CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cycle_id          CHAR(36)       NOT NULL,
  employee_id       CHAR(36)       NOT NULL,
  roster_date       DATE           NOT NULL,
  shift_template_id CHAR(36),
  is_week_off       TINYINT(1)     NOT NULL DEFAULT 0,
  is_holiday        TINYINT(1)     NOT NULL DEFAULT 0,
  acknowledgement_status ENUM('pending','acknowledged','disputed') DEFAULT 'pending',
  acknowledged_at   DATETIME,
  notes             TEXT,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rda (cycle_id, employee_id, roster_date),
  INDEX idx_rda_employee (employee_id),
  INDEX idx_rda_date (roster_date),
  FOREIGN KEY (cycle_id)          REFERENCES weekly_roster_cycle(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id)       REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (shift_template_id) REFERENCES wfm_shift_template(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS roster_change_log (
  id                CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cycle_id          CHAR(36)       NOT NULL,
  employee_id       CHAR(36)       NOT NULL,
  change_type       ENUM('shift_change','week_off_change','swap','addition','removal') NOT NULL,
  old_value_json    JSON,
  new_value_json    JSON,
  reason            TEXT           NOT NULL,
  change_date       DATE           NOT NULL,
  changed_by        CHAR(36)       NOT NULL,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rcl_cycle (cycle_id),
  FOREIGN KEY (cycle_id) REFERENCES weekly_roster_cycle(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS roster_coverage_action (
  id                CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cycle_id          CHAR(36)       NOT NULL,
  action_date       DATE           NOT NULL,
  process_id        CHAR(36),
  coverage_gap      INT            NOT NULL DEFAULT 0,
  root_cause        TEXT,
  recovery_plan     TEXT,
  owner_user_id     CHAR(36),
  due_by            DATE,
  status            ENUM('open','in_progress','resolved','escalated') NOT NULL DEFAULT 'open',
  resolved_at       DATETIME,
  created_by        CHAR(36)       NOT NULL,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rca_cycle (cycle_id),
  INDEX idx_rca_status (status),
  FOREIGN KEY (cycle_id) REFERENCES weekly_roster_cycle(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS portal_roster_aggregate (
  id                CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cycle_id          CHAR(36)       NOT NULL,
  process_id        CHAR(36)       NOT NULL,
  week_start_date   DATE           NOT NULL,
  required_hc       INT            NOT NULL DEFAULT 0,
  rostered_hc       INT            NOT NULL DEFAULT 0,
  coverage_pct      DECIMAL(5,2),
  published_at      DATETIME,
  UNIQUE KEY uq_pra (cycle_id, process_id),
  FOREIGN KEY (cycle_id)   REFERENCES weekly_roster_cycle(id) ON DELETE CASCADE,
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE CASCADE
);
