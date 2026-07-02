-- 010_kpi_migration.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS kpi_target_master (
  id            CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  role_key      VARCHAR(100)   NOT NULL,
  kpi_name      VARCHAR(255)   NOT NULL,
  kpi_code      VARCHAR(100)   NOT NULL,
  target_value  DECIMAL(10,4),
  unit          VARCHAR(50),
  active_status TINYINT(1)     NOT NULL DEFAULT 1,
  created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kpi_role_code (role_key, kpi_code)
);

CREATE TABLE IF NOT EXISTS role_kpi_snapshot (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)      NOT NULL,
  snapshot_date   DATE          NOT NULL,
  role_key        VARCHAR(100)  NOT NULL,
  kpi_code        VARCHAR(100)  NOT NULL,
  actual_value    DECIMAL(10,4),
  target_value    DECIMAL(10,4),
  achievement_pct DECIMAL(6,2),
  source          VARCHAR(50)   NOT NULL DEFAULT 'manual',
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kpi_snap (employee_id, snapshot_date, kpi_code),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_kpi_snap_emp (employee_id),
  INDEX idx_kpi_snap_date (snapshot_date)
);

CREATE TABLE IF NOT EXISTS migration_run (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  module       VARCHAR(100) NOT NULL,
  status       VARCHAR(50)  NOT NULL DEFAULT 'running',
  rows_read    INT          NOT NULL DEFAULT 0,
  rows_written INT          NOT NULL DEFAULT 0,
  rows_failed  INT          NOT NULL DEFAULT 0,
  source_count INT,
  target_count INT,
  triggered_by CHAR(36),
  started_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  error_log    TEXT,
  INDEX idx_migration_module (module)
);

CREATE TABLE IF NOT EXISTS migration_row_log (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_id        CHAR(36)     NOT NULL,
  source_table  VARCHAR(100) NOT NULL,
  source_id     VARCHAR(100) NOT NULL,
  target_table  VARCHAR(100) NOT NULL,
  status        VARCHAR(50)  NOT NULL DEFAULT 'written',
  error_message TEXT,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES migration_run(id) ON DELETE CASCADE,
  INDEX idx_migrow_run (run_id),
  INDEX idx_migrow_status (status)
);

INSERT INTO kpi_target_master (role_key, kpi_name, kpi_code, target_value, unit) VALUES
  ('tl',          'Team AHT (seconds)',      'TEAM_AHT',       300, 'seconds'),
  ('tl',          'Team CSAT Score',         'TEAM_CSAT',       90, 'percent'),
  ('tl',          'Attendance %',            'ATTENDANCE_PCT',   95, 'percent'),
  ('qa',          'Audits Per Day',          'AUDITS_PER_DAY',   8, 'count'),
  ('qa',          'Fatal Error Rate %',      'FATAL_RATE',        2, 'percent'),
  ('wfm',         'Shrinkage %',             'SHRINKAGE',        10, 'percent'),
  ('wfm',         'Schedule Adherence %',    'ADHERENCE',        90, 'percent'),
  ('manager',     'Process SLA Achievement', 'SLA_ACH',          95, 'percent'),
  ('branch_head', 'Branch Headcount Fill %', 'HEADCOUNT_FILL',   90, 'percent'),
  ('branch_head', 'Branch CSAT Average',     'BRANCH_CSAT',      88, 'percent')
ON DUPLICATE KEY UPDATE target_value = VALUES(target_value);
