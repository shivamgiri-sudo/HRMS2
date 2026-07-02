-- 060_legacy_sync_schema.sql
USE mas_hrms;

-- Table profiles from legacy DB analysis
CREATE TABLE IF NOT EXISTS legacy_source_table_profile (
  id                      CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  source_db               VARCHAR(100) NOT NULL DEFAULT 'db_bill',
  schema_name             VARCHAR(100) NOT NULL,
  table_name              VARCHAR(255) NOT NULL,
  row_count               BIGINT,
  last_user_update        DATETIME NULL,
  candidate_latest_column VARCHAR(255),
  max_candidate_date      DATETIME NULL,
  relevance_score         INT DEFAULT 0,
  relevance_reason        TEXT,
  scan_status             VARCHAR(50) DEFAULT 'pending',
  scanned_at              DATETIME,
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_legacy_table (source_db, schema_name, table_name),
  INDEX idx_relevance (relevance_score DESC),
  INDEX idx_scan_status (scan_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Column profiles
CREATE TABLE IF NOT EXISTS legacy_source_column_profile (
  id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  source_db       VARCHAR(100) NOT NULL DEFAULT 'db_bill',
  schema_name     VARCHAR(100) NOT NULL,
  table_name      VARCHAR(255) NOT NULL,
  column_name     VARCHAR(255) NOT NULL,
  data_type       VARCHAR(100),
  max_length      INT,
  is_nullable     TINYINT(1),
  ordinal_position INT,
  matched_domain  VARCHAR(100),
  confidence_score INT DEFAULT 0,
  scanned_at      DATETIME,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_legacy_column (source_db, schema_name, table_name, column_name),
  INDEX idx_domain (matched_domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Suggested mappings (pending approval)
CREATE TABLE IF NOT EXISTS legacy_mapping_candidates (
  id                   CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  hrms_domain          VARCHAR(100) NOT NULL,
  hrms_target_table    VARCHAR(255),
  hrms_target_column   VARCHAR(255),
  legacy_schema        VARCHAR(100) NOT NULL,
  legacy_table         VARCHAR(255) NOT NULL,
  legacy_column        VARCHAR(255),
  confidence_score     INT DEFAULT 0,
  mapping_reason       TEXT,
  sample_safe_values   TEXT,
  approved_status      VARCHAR(50) DEFAULT 'pending',
  approved_by          CHAR(36),
  approved_at          DATETIME,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_domain (hrms_domain),
  INDEX idx_approved (approved_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Active sync configurations (approved only)
CREATE TABLE IF NOT EXISTS legacy_sync_map (
  id                       CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  hrms_domain              VARCHAR(100) NOT NULL,
  source_schema            VARCHAR(100) NOT NULL,
  source_table             VARCHAR(255) NOT NULL,
  source_key_column        VARCHAR(255) NOT NULL,
  source_watermark_column  VARCHAR(255),
  target_table             VARCHAR(255) NOT NULL,
  target_key_column        VARCHAR(255) NOT NULL,
  column_mapping_json      JSON NOT NULL,
  transform_rules_json     JSON,
  sync_mode                VARCHAR(50) DEFAULT 'upsert',
  sync_order               INT DEFAULT 100,
  active_status            TINYINT(1) NOT NULL DEFAULT 1,
  approved_by              CHAR(36),
  approved_at              DATETIME,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sync_map (hrms_domain, source_schema, source_table),
  INDEX idx_active (active_status),
  INDEX idx_sync_order (sync_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Checkpoint per sync map
CREATE TABLE IF NOT EXISTS legacy_sync_checkpoint (
  id                    CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  sync_map_id           CHAR(36) NOT NULL,
  last_watermark_value  VARCHAR(255),
  last_source_key       VARCHAR(255),
  last_ct_version       BIGINT,
  last_success_at       DATETIME,
  last_run_status       VARCHAR(50),
  last_error            TEXT,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_checkpoint (sync_map_id),
  FOREIGN KEY (sync_map_id) REFERENCES legacy_sync_map(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sync run audit log
CREATE TABLE IF NOT EXISTS legacy_sync_run_log (
  id             CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  sync_map_id    CHAR(36) NOT NULL,
  run_type       VARCHAR(50) DEFAULT 'incremental',
  started_at     DATETIME NOT NULL,
  finished_at    DATETIME,
  rows_read      INT DEFAULT 0,
  rows_inserted  INT DEFAULT 0,
  rows_updated   INT DEFAULT 0,
  rows_skipped   INT DEFAULT 0,
  rows_failed    INT DEFAULT 0,
  status         VARCHAR(50) DEFAULT 'running',
  error_message  TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sync_map (sync_map_id),
  INDEX idx_status (status),
  INDEX idx_started (started_at DESC),
  FOREIGN KEY (sync_map_id) REFERENCES legacy_sync_map(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Exceptions requiring manual intervention
CREATE TABLE IF NOT EXISTS legacy_sync_exception (
  id                CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  sync_map_id       CHAR(36) NOT NULL,
  sync_run_log_id   CHAR(36),
  exception_type    VARCHAR(100) NOT NULL,
  source_key        VARCHAR(255),
  source_data_json  JSON,
  target_data_json  JSON,
  error_message     TEXT,
  resolved_status   VARCHAR(50) DEFAULT 'pending',
  resolved_by       CHAR(36),
  resolved_at       DATETIME,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_type (exception_type),
  INDEX idx_resolved (resolved_status),
  FOREIGN KEY (sync_map_id) REFERENCES legacy_sync_map(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staging for employee domain
CREATE TABLE IF NOT EXISTS stg_legacy_employee_master (
  id                    CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  sync_run_id           CHAR(36) NOT NULL,
  source_db             VARCHAR(100) NOT NULL,
  source_schema         VARCHAR(100) NOT NULL,
  source_table          VARCHAR(255) NOT NULL,
  source_key            VARCHAR(255) NOT NULL,
  source_updated_at     DATETIME,
  raw_payload_json      JSON NOT NULL,
  -- Normalized columns
  employee_code         VARCHAR(100),
  full_name             VARCHAR(255),
  first_name            VARCHAR(100),
  last_name             VARCHAR(100),
  official_email        VARCHAR(255),
  personal_email        VARCHAR(255),
  mobile                VARCHAR(20),
  date_of_joining       DATE,
  date_of_exit          DATE,
  branch_code           VARCHAR(50),
  branch_id             CHAR(36),
  process_code          VARCHAR(50),
  process_id            CHAR(36),
  department_code       VARCHAR(50),
  department_id         CHAR(36),
  designation_code      VARCHAR(50),
  designation_id        CHAR(36),
  reporting_manager_code VARCHAR(100),
  employment_status     VARCHAR(50),
  active_status         TINYINT(1),
  processed_status      VARCHAR(50) DEFAULT 'pending',
  processed_at          DATETIME,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_source_key (source_key),
  INDEX idx_processed (processed_status),
  INDEX idx_employee_code (employee_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staging for branch master
CREATE TABLE IF NOT EXISTS stg_legacy_branch_master (
  id                CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  sync_run_id       CHAR(36) NOT NULL,
  source_db         VARCHAR(100) NOT NULL,
  source_schema     VARCHAR(100) NOT NULL,
  source_table      VARCHAR(255) NOT NULL,
  source_key        VARCHAR(255) NOT NULL,
  raw_payload_json  JSON NOT NULL,
  branch_code       VARCHAR(50),
  branch_name       VARCHAR(255),
  city              VARCHAR(100),
  state             VARCHAR(100),
  active_status     TINYINT(1),
  processed_status  VARCHAR(50) DEFAULT 'pending',
  processed_at      DATETIME,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_source_key (source_key),
  INDEX idx_processed (processed_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staging for attendance
CREATE TABLE IF NOT EXISTS stg_legacy_attendance (
  id                CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  sync_run_id       CHAR(36) NOT NULL,
  source_db         VARCHAR(100) NOT NULL,
  source_schema     VARCHAR(100) NOT NULL,
  source_table      VARCHAR(255) NOT NULL,
  source_key        VARCHAR(255) NOT NULL,
  raw_payload_json  JSON NOT NULL,
  employee_code     VARCHAR(100),
  attendance_date   DATE,
  in_time           DATETIME,
  out_time          DATETIME,
  total_hours       DECIMAL(5,2),
  status            VARCHAR(50),
  shift_code        VARCHAR(50),
  processed_status  VARCHAR(50) DEFAULT 'pending',
  processed_at      DATETIME,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_source_key (source_key),
  INDEX idx_processed (processed_status),
  INDEX idx_attendance_date (attendance_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 060 applied: legacy sync schema created' AS status;
