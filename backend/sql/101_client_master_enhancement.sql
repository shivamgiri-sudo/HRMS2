-- 101_client_master_enhancement.sql
-- Comprehensive client master enhancement with full entity management
USE mas_hrms;

-- ============================================================
-- 1. CLIENT MASTER ENTITY
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  client_code         VARCHAR(50)  NOT NULL UNIQUE COMMENT 'Short code for client (e.g., ABC, XYZ)',
  client_name         VARCHAR(255) NOT NULL,
  legal_entity_name   VARCHAR(255) NULL COMMENT 'Registered company name',
  industry            VARCHAR(100) NULL,

  -- Contact Information
  primary_contact_name  VARCHAR(255) NULL,
  primary_contact_email VARCHAR(255) NULL,
  primary_contact_phone VARCHAR(20)  NULL,
  escalation_contact_name VARCHAR(255) NULL,
  escalation_contact_email VARCHAR(255) NULL,
  escalation_contact_phone VARCHAR(20) NULL,

  -- Address
  address_line1       VARCHAR(255) NULL,
  address_line2       VARCHAR(255) NULL,
  city                VARCHAR(100) NULL,
  state               VARCHAR(100) NULL,
  country             VARCHAR(100) NULL DEFAULT 'India',
  postal_code         VARCHAR(20)  NULL,

  -- Business Details
  logo_url            VARCHAR(500) NULL,
  website             VARCHAR(255) NULL,
  contract_start_date DATE         NULL,
  contract_end_date   DATE         NULL,
  billing_cycle       ENUM('MONTHLY', 'QUARTERLY', 'ANNUAL') DEFAULT 'MONTHLY',

  -- Technical
  api_key             VARCHAR(255) NULL COMMENT 'API key for integrations',
  webhook_url         VARCHAR(500) NULL COMMENT 'Callback URL for notifications',

  -- Status
  subscription_status ENUM('ACTIVE', 'SUSPENDED', 'TRIAL', 'EXPIRED') DEFAULT 'ACTIVE',
  active_status       TINYINT(1)   NOT NULL DEFAULT 1,
  created_by          CHAR(36)     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_client_code (client_code),
  INDEX idx_client_name (client_name),
  INDEX idx_subscription_status (subscription_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Master client entity with full business details';

-- Update existing processes table to reference clients
ALTER TABLE processes
  ADD COLUMN client_uuid CHAR(36) NULL AFTER client_id,
  ADD COLUMN process_owner_name VARCHAR(255) NULL COMMENT 'Process owner from client side',
  ADD COLUMN process_owner_email VARCHAR(255) NULL,
  ADD COLUMN sla_response_hours INT NULL COMMENT 'Response SLA in hours',
  ADD COLUMN sla_resolution_hours INT NULL COMMENT 'Resolution SLA in hours',
  ADD COLUMN escalation_level_1_email VARCHAR(255) NULL,
  ADD COLUMN escalation_level_2_email VARCHAR(255) NULL,
  ADD COLUMN process_type ENUM('INBOUND', 'OUTBOUND', 'BACK_OFFICE', 'TECHNICAL_SUPPORT', 'CHAT', 'EMAIL') NULL,
  ADD COLUMN billing_rate_per_hour DECIMAL(10,2) NULL,
  ADD INDEX idx_client_uuid (client_uuid);

-- ============================================================
-- 2. ENHANCED PORTAL USER MANAGEMENT
-- ============================================================

-- Add columns to portal_users (assuming table exists from earlier migrations)
ALTER TABLE portal_users
  ADD COLUMN full_name VARCHAR(255) NULL AFTER email,
  ADD COLUMN phone VARCHAR(20) NULL,
  ADD COLUMN designation VARCHAR(100) NULL,
  ADD COLUMN department VARCHAR(100) NULL,
  ADD COLUMN access_level ENUM('READ_ONLY', 'FULL_ACCESS', 'ADMIN') DEFAULT 'READ_ONLY',
  ADD COLUMN access_start_date DATE NULL COMMENT 'Temporary access start',
  ADD COLUMN access_end_date DATE NULL COMMENT 'Temporary access end',
  ADD COLUMN last_login_at DATETIME NULL,
  ADD COLUMN last_login_ip VARCHAR(45) NULL,
  ADD COLUMN login_count INT NOT NULL DEFAULT 0,
  ADD COLUMN deactivated_by CHAR(36) NULL,
  ADD COLUMN deactivated_at DATETIME NULL,
  ADD COLUMN deactivation_reason TEXT NULL,
  ADD INDEX idx_last_login (last_login_at),
  ADD INDEX idx_access_dates (access_start_date, access_end_date);

-- Portal user activity log
CREATE TABLE IF NOT EXISTS portal_user_activity_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id         CHAR(36)     NOT NULL,
  action_type     VARCHAR(100) NOT NULL COMMENT 'LOGIN, LOGOUT, VIEW_REPORT, DOWNLOAD, API_CALL',
  resource_type   VARCHAR(100) NULL COMMENT 'REPORT, DASHBOARD, API_ENDPOINT',
  resource_id     VARCHAR(255) NULL,
  ip_address      VARCHAR(45)  NULL,
  user_agent      TEXT         NULL,
  request_method  VARCHAR(10)  NULL,
  request_path    VARCHAR(500) NULL,
  response_status INT          NULL,
  duration_ms     INT          NULL,
  metadata        JSON         NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user_activity (user_id, created_at),
  INDEX idx_action_type (action_type),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Portal user activity audit trail';

-- Portal user sessions
CREATE TABLE IF NOT EXISTS portal_user_sessions (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id       CHAR(36)     NOT NULL,
  session_token VARCHAR(255) NOT NULL UNIQUE,
  ip_address    VARCHAR(45)  NULL,
  user_agent    TEXT         NULL,
  started_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME     NOT NULL,
  ended_at      DATETIME     NULL,

  INDEX idx_user_sessions (user_id, started_at),
  INDEX idx_session_token (session_token),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Active portal user sessions for concurrent session management';

-- ============================================================
-- 3. GRANULAR ACCESS CONTROL FOR PORTAL USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS portal_user_permissions (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id         CHAR(36)     NOT NULL,
  permission_type VARCHAR(100) NOT NULL COMMENT 'VIEW_REPORTS, DOWNLOAD_DATA, VIEW_EMPLOYEES, VIEW_ATTENDANCE, VIEW_PAYROLL',
  resource_scope  VARCHAR(100) NULL COMMENT 'ALL, PROCESS_SPECIFIC, BRANCH_SPECIFIC',
  resource_ids    JSON         NULL COMMENT 'Array of process_ids or branch_ids',
  granted_by      CHAR(36)     NOT NULL,
  granted_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME     NULL,
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,

  UNIQUE KEY uq_user_permission (user_id, permission_type, resource_scope),
  INDEX idx_user_permissions (user_id),
  INDEX idx_permission_type (permission_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Granular permission matrix for portal users';

-- ============================================================
-- 4. ANALYTICS & USAGE TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS client_usage_stats (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  client_id         CHAR(36)     NOT NULL,
  stat_date         DATE         NOT NULL,

  -- User activity
  active_users      INT          NOT NULL DEFAULT 0,
  total_logins      INT          NOT NULL DEFAULT 0,
  unique_users      INT          NOT NULL DEFAULT 0,

  -- Resource usage
  api_calls         INT          NOT NULL DEFAULT 0,
  report_views      INT          NOT NULL DEFAULT 0,
  downloads         INT          NOT NULL DEFAULT 0,

  -- Performance
  avg_response_time_ms DECIMAL(10,2) NULL,
  error_count       INT          NOT NULL DEFAULT 0,

  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_client_date (client_id, stat_date),
  INDEX idx_stat_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Daily aggregated usage statistics per client';

CREATE TABLE IF NOT EXISTS process_performance_metrics (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id          CHAR(36)     NOT NULL,
  metric_date         DATE         NOT NULL,

  -- Volume
  total_transactions  INT          NOT NULL DEFAULT 0,
  completed_transactions INT       NOT NULL DEFAULT 0,
  failed_transactions INT          NOT NULL DEFAULT 0,

  -- SLA
  within_sla_count    INT          NOT NULL DEFAULT 0,
  breached_sla_count  INT          NOT NULL DEFAULT 0,
  avg_resolution_hours DECIMAL(10,2) NULL,

  -- Quality
  quality_score       DECIMAL(5,2) NULL COMMENT 'Average quality score 0-100',
  error_rate          DECIMAL(5,2) NULL COMMENT 'Error percentage',

  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_process_date (process_id, metric_date),
  INDEX idx_metric_date (metric_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Daily process performance metrics';

-- ============================================================
-- 5. BULK OPERATIONS SUPPORT
-- ============================================================

CREATE TABLE IF NOT EXISTS bulk_operation_jobs (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  job_type        VARCHAR(100) NOT NULL COMMENT 'IMPORT_USERS, IMPORT_PROCESSES, BULK_DEACTIVATE, BULK_ASSIGN',
  entity_type     VARCHAR(100) NOT NULL COMMENT 'PORTAL_USERS, PROCESSES, CLIENTS',
  file_url        VARCHAR(500) NULL COMMENT 'Uploaded CSV file path',

  -- Status
  status          ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL') DEFAULT 'PENDING',
  total_records   INT          NOT NULL DEFAULT 0,
  processed_records INT        NOT NULL DEFAULT 0,
  success_count   INT          NOT NULL DEFAULT 0,
  error_count     INT          NOT NULL DEFAULT 0,

  -- Results
  error_log       JSON         NULL COMMENT 'Array of error messages',
  result_summary  JSON         NULL,

  -- Audit
  created_by      CHAR(36)     NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at      DATETIME     NULL,
  completed_at    DATETIME     NULL,

  INDEX idx_job_type (job_type),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Bulk operation job queue and tracking';

-- ============================================================
-- 6. AUDIT TRAIL
-- ============================================================

CREATE TABLE IF NOT EXISTS client_audit_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  entity_type     VARCHAR(100) NOT NULL COMMENT 'CLIENT, PROCESS, PORTAL_USER',
  entity_id       CHAR(36)     NOT NULL,
  action_type     VARCHAR(100) NOT NULL COMMENT 'CREATE, UPDATE, DELETE, ACTIVATE, DEACTIVATE',
  actor_user_id   CHAR(36)     NOT NULL,
  actor_email     VARCHAR(255) NULL,
  old_values      JSON         NULL,
  new_values      JSON         NULL,
  change_summary  TEXT         NULL,
  ip_address      VARCHAR(45)  NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_actor (actor_user_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Comprehensive audit trail for all client-related operations';

-- ============================================================
-- SEED DATA & MIGRATIONS
-- ============================================================

-- Migrate existing process client_id to new client entity
-- This will be handled by application logic to create clients from existing client_ids
