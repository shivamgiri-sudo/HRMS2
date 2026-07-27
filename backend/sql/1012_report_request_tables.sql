-- Migration: 1012_report_request_tables.sql
-- Purpose: Secure report request → generate → email → audit platform
-- Creates: report_request, report_generated_file, report_email_delivery, report_audit_event
-- Direction: ADDITIVE ONLY — no existing tables modified
-- Safe to apply: YES — all CREATE TABLE IF NOT EXISTS

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. report_request: full lifecycle tracking for every report request
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_request (
  id                           CHAR(36) NOT NULL,
  request_reference            VARCHAR(30) NOT NULL,
  report_code                  VARCHAR(100) NOT NULL,
  report_name_snapshot         VARCHAR(255) NOT NULL,
  requested_by_user_id         CHAR(36) NOT NULL,
  requested_by_employee_id     CHAR(36),
  requested_by_employee_code   VARCHAR(50),
  requested_by_employee_name   VARCHAR(255),
  requester_role_snapshot      VARCHAR(100),
  requester_branch_id          CHAR(36),
  requester_process_id         CHAR(36),
  official_email               VARCHAR(255) NOT NULL,
  official_email_source        VARCHAR(100) NOT NULL DEFAULT 'employees.official_email',
  official_email_verified      TINYINT(1) NOT NULL DEFAULT 1,
  requested_filters_json       JSON,
  resolved_scope_json          JSON,
  requested_format             ENUM('xlsx','csv','pdf') NOT NULL DEFAULT 'xlsx',
  request_source               VARCHAR(50) NOT NULL DEFAULT 'portal',
  request_ip                   VARCHAR(45),
  request_user_agent           TEXT,
  correlation_id               CHAR(36),
  status                       VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
  priority                     TINYINT(1) NOT NULL DEFAULT 5,
  requested_at                 DATETIME NOT NULL,
  queued_at                    DATETIME,
  processing_started_at        DATETIME,
  generation_completed_at      DATETIME,
  email_queued_at              DATETIME,
  email_sent_at                DATETIME,
  completed_at                 DATETIME,
  failed_at                    DATETIME,
  cancelled_at                 DATETIME,
  failure_stage                VARCHAR(50),
  failure_code                 VARCHAR(100),
  failure_message              TEXT,
  retry_count                  INT NOT NULL DEFAULT 0,
  last_retry_at                DATETIME,
  expires_at                   DATETIME,
  created_at                   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rr_reference (request_reference),
  INDEX idx_rr_user (requested_by_user_id),
  INDEX idx_rr_status (status),
  INDEX idx_rr_code (report_code),
  INDEX idx_rr_requested_at (requested_at),
  INDEX idx_rr_status_priority (status, priority, requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. report_generated_file: file metadata and retention/deletion tracking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_generated_file (
  id                     CHAR(36) NOT NULL,
  report_request_id      CHAR(36) NOT NULL,
  storage_provider       VARCHAR(50) NOT NULL DEFAULT 'local',
  storage_key            VARCHAR(500) NOT NULL,
  original_filename      VARCHAR(255) NOT NULL,
  stored_filename        VARCHAR(255) NOT NULL,
  mime_type              VARCHAR(100),
  file_extension         VARCHAR(10),
  file_size_bytes        BIGINT,
  sha256_checksum        VARCHAR(64),
  encryption_status      VARCHAR(20) NOT NULL DEFAULT 'none',
  generated_row_count    INT,
  generated_column_count INT,
  generated_at           DATETIME,
  expires_at             DATETIME NOT NULL,
  deleted_at             DATETIME,
  deletion_status        VARCHAR(20),
  deletion_error         TEXT,
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_rgf_request (report_request_id),
  INDEX idx_rgf_expires (expires_at),
  INDEX idx_rgf_deletion (deletion_status, expires_at),
  CONSTRAINT fk_rgf_request FOREIGN KEY (report_request_id)
    REFERENCES report_request(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. report_email_delivery: per-attempt delivery tracking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_email_delivery (
  id                       CHAR(36) NOT NULL,
  report_request_id        CHAR(36) NOT NULL,
  delivery_attempt_number  INT NOT NULL DEFAULT 1,
  recipient_email          VARCHAR(255) NOT NULL,
  recipient_employee_id    CHAR(36),
  recipient_employee_code  VARCHAR(50),
  email_subject            VARCHAR(500),
  email_provider           VARCHAR(50),
  provider_message_id      VARCHAR(255),
  attachment_filename      VARCHAR(255),
  attachment_size_bytes    BIGINT,
  status                   VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
  queued_at                DATETIME,
  sending_started_at       DATETIME,
  sent_at                  DATETIME,
  delivered_at             DATETIME,
  bounced_at               DATETIME,
  failed_at                DATETIME,
  failure_code             VARCHAR(100),
  failure_message          TEXT,
  provider_response_json   JSON,
  next_retry_at            DATETIME,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_red_request (report_request_id),
  INDEX idx_red_status (status),
  INDEX idx_red_retry (status, next_retry_at),
  CONSTRAINT fk_red_request FOREIGN KEY (report_request_id)
    REFERENCES report_request(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. report_audit_event: immutable chronological event log (INSERT-only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_audit_event (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  report_request_id     CHAR(36),
  event_sequence        INT,
  event_type            VARCHAR(80) NOT NULL,
  event_status          VARCHAR(30),
  activity_at           DATETIME NOT NULL,
  actor_type            VARCHAR(20) NOT NULL DEFAULT 'user',
  actor_user_id         CHAR(36),
  actor_employee_id     CHAR(36),
  actor_employee_code   VARCHAR(50),
  actor_name            VARCHAR(255),
  actor_role            VARCHAR(100),
  report_code           VARCHAR(100),
  report_name           VARCHAR(255),
  recipient_email       VARCHAR(255),
  filters_snapshot_json JSON,
  scope_snapshot_json   JSON,
  file_id               CHAR(36),
  delivery_id           CHAR(36),
  correlation_id        CHAR(36),
  ip_address            VARCHAR(45),
  user_agent            TEXT,
  message               TEXT,
  error_code            VARCHAR(100),
  error_detail          TEXT,
  metadata_json         JSON,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_rae_request (report_request_id),
  INDEX idx_rae_event_type (event_type),
  INDEX idx_rae_activity (activity_at),
  INDEX idx_rae_actor (actor_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Seed worker_config entries for the three new report workers
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO worker_config
  (worker_name, enabled, description, schedule_cron, max_retries, timeout_seconds)
VALUES
  ('report-generation',      1, 'Generates queued report files server-side and stores to disk',          '*/1 * * * *',  3, 300),
  ('report-email-delivery',  1, 'Delivers generated report files as email attachments to official email','*/1 * * * *',  4, 120),
  ('report-stale-recovery',  1, 'Detects stuck report jobs and recovers / expires report files',         '*/15 * * * *', 1, 60);
