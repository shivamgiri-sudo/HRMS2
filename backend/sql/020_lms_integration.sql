USE mas_hrms;

CREATE TABLE IF NOT EXISTS lms_employee_mapping (
  id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36) NOT NULL,
  lms_learner_id  VARCHAR(128) NOT NULL,
  email           VARCHAR(255),
  mapped_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_lms_emp (employee_id),
  INDEX idx_lms_learner (lms_learner_id)
);

CREATE TABLE IF NOT EXISTS lms_learning_progress_snapshot (
  id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36) NOT NULL,
  lms_learner_id  VARCHAR(128) NOT NULL,
  course_id       VARCHAR(128),
  course_name     VARCHAR(255),
  completion_pct  DECIMAL(5,2) NOT NULL DEFAULT 0,
  score           DECIMAL(5,2),
  status          ENUM('not_started','in_progress','completed','failed') NOT NULL DEFAULT 'not_started',
  last_accessed   DATETIME,
  synced_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lms_prog_emp (employee_id),
  INDEX idx_lms_prog_synced (synced_at)
);

CREATE TABLE IF NOT EXISTS lms_certification_snapshot (
  id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36) NOT NULL,
  certification_name VARCHAR(255) NOT NULL,
  issued_date     DATE,
  expiry_date     DATE,
  status          ENUM('active','expired','revoked') NOT NULL DEFAULT 'active',
  synced_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lms_cert_emp (employee_id)
);

CREATE TABLE IF NOT EXISTS lms_sync_audit_log (
  id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  sync_type       VARCHAR(64) NOT NULL,
  records_synced  INT NOT NULL DEFAULT 0,
  errors_count    INT NOT NULL DEFAULT 0,
  status          ENUM('success','partial','failed') NOT NULL DEFAULT 'success',
  initiated_by    CHAR(36),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
