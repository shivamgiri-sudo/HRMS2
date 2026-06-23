-- 219_peopleos_foundation_read_models.sql
-- Additive workflow/read-model tables for PeopleOS enterprise surfaces.
-- No destructive statements and no seed/fake operational data.

CREATE TABLE IF NOT EXISTS attendance_exception (
  id                CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id       CHAR(36) NOT NULL,
  exception_date    DATE NOT NULL,
  exception_type    VARCHAR(80) NOT NULL,
  severity          ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status            ENUM('open','assigned','resolved','reopened','ignored') NOT NULL DEFAULT 'open',
  source_module     VARCHAR(80) NOT NULL DEFAULT 'attendance_engine',
  source_record_id  CHAR(36) NULL,
  branch_id         CHAR(36) NULL,
  process_id        CHAR(36) NULL,
  assigned_to       CHAR(36) NULL,
  resolution_notes  TEXT NULL,
  metadata_json     JSON NULL,
  detected_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_at       DATETIME NULL,
  resolved_at       DATETIME NULL,
  reopened_at       DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_att_exc_source (source_module, source_record_id, exception_type),
  INDEX idx_att_exc_employee_date (employee_id, exception_date),
  INDEX idx_att_exc_status (status, severity),
  INDEX idx_att_exc_scope (branch_id, process_id),
  CONSTRAINT fk_att_exc_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integration_sync_run (
  id                CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  integration_key   VARCHAR(80) NOT NULL,
  run_type          VARCHAR(80) NOT NULL DEFAULT 'scheduled',
  status            ENUM('running','success','warning','failed') NOT NULL DEFAULT 'running',
  started_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at      DATETIME NULL,
  records_read      INT NOT NULL DEFAULT 0,
  records_written   INT NOT NULL DEFAULT 0,
  records_failed    INT NOT NULL DEFAULT 0,
  error_summary     TEXT NULL,
  metadata_json     JSON NULL,
  created_by        CHAR(36) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_isr_key_started (integration_key, started_at),
  INDEX idx_isr_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_readiness_snapshot (
  id                CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id       CHAR(36) NOT NULL,
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  readiness_status  ENUM('ready','blocked','hold','released') NOT NULL DEFAULT 'blocked',
  blocker_codes     JSON NULL,
  blocker_summary   TEXT NULL,
  branch_id         CHAR(36) NULL,
  process_id        CHAR(36) NULL,
  confidence_score  INT NOT NULL DEFAULT 0,
  hold_reason       TEXT NULL,
  hold_by           CHAR(36) NULL,
  hold_at           DATETIME NULL,
  released_by       CHAR(36) NULL,
  released_at       DATETIME NULL,
  scanned_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_prs_emp_period (employee_id, period_start, period_end),
  INDEX idx_prs_status (readiness_status),
  INDEX idx_prs_scope (branch_id, process_id),
  CONSTRAINT fk_prs_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workforce_roster_draft (
  id                CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_id         CHAR(36) NULL,
  process_id        CHAR(36) NULL,
  roster_date       DATE NOT NULL,
  shift_code        VARCHAR(80) NULL,
  required_count    INT NOT NULL DEFAULT 0,
  planned_count     INT NOT NULL DEFAULT 0,
  shortage_count    INT NOT NULL DEFAULT 0,
  status            ENUM('draft','submitted','approved','rejected','cancelled') NOT NULL DEFAULT 'draft',
  simulation_json   JSON NULL,
  created_by        CHAR(36) NULL,
  approved_by       CHAR(36) NULL,
  approved_at       DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_wrd_date_scope (roster_date, branch_id, process_id),
  INDEX idx_wrd_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
