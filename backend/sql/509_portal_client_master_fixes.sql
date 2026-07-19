-- 509_portal_client_master_fixes.sql
-- Fixes the broken ALTER statements in 101_client_master_enhancement.sql
-- (that migration referenced non-existent table names 'processes' and 'portal_users').
-- This migration patches the correct tables: process_master and client_user.
USE mas_hrms;

-- ── 1. Enrich client_master with full business fields ────────────────────────
-- (safe: IF NOT EXISTS / IF NOT ADD pattern via INFORMATION_SCHEMA checks)

SET @col_check = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='client_master' AND COLUMN_NAME='logo_url'
);
SET @sql_cm = IF(@col_check = 0,
  'ALTER TABLE client_master
     ADD COLUMN legal_entity_name       VARCHAR(255) NULL AFTER client_name,
     ADD COLUMN industry                VARCHAR(100) NULL,
     ADD COLUMN primary_contact_name    VARCHAR(255) NULL,
     ADD COLUMN primary_contact_email   VARCHAR(255) NULL,
     ADD COLUMN primary_contact_phone   VARCHAR(20)  NULL,
     ADD COLUMN escalation_contact_name VARCHAR(255) NULL,
     ADD COLUMN escalation_contact_email VARCHAR(255) NULL,
     ADD COLUMN escalation_contact_phone VARCHAR(20) NULL,
     ADD COLUMN address_line1           VARCHAR(255) NULL,
     ADD COLUMN address_line2           VARCHAR(255) NULL,
     ADD COLUMN city                    VARCHAR(100) NULL,
     ADD COLUMN state                   VARCHAR(100) NULL,
     ADD COLUMN country                 VARCHAR(100) NULL DEFAULT ''India'',
     ADD COLUMN postal_code             VARCHAR(20)  NULL,
     ADD COLUMN logo_url                VARCHAR(500) NULL,
     ADD COLUMN website                 VARCHAR(255) NULL,
     ADD COLUMN contract_start_date     DATE         NULL,
     ADD COLUMN contract_end_date       DATE         NULL,
     ADD COLUMN billing_cycle           ENUM(''MONTHLY'',''QUARTERLY'',''ANNUAL'') DEFAULT ''MONTHLY'',
     ADD COLUMN subscription_status     ENUM(''ACTIVE'',''SUSPENDED'',''TRIAL'',''EXPIRED'') DEFAULT ''ACTIVE'',
     ADD COLUMN api_key                 VARCHAR(255) NULL,
     ADD COLUMN webhook_url             VARCHAR(500) NULL,
     ADD COLUMN updated_at              DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP',
  'SELECT 1'
);
PREPARE stmt_cm FROM @sql_cm;
EXECUTE stmt_cm;
DEALLOCATE PREPARE stmt_cm;

-- ── 2. Enrich process_master with client-facing SLA/escalation fields ────────
SET @col_pm = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='process_master' AND COLUMN_NAME='sla_response_hours'
);
SET @sql_pm = IF(@col_pm = 0,
  'ALTER TABLE process_master
     ADD COLUMN process_owner_name        VARCHAR(255) NULL,
     ADD COLUMN process_owner_email       VARCHAR(255) NULL,
     ADD COLUMN sla_response_hours        INT          NULL,
     ADD COLUMN sla_resolution_hours      INT          NULL,
     ADD COLUMN escalation_level_1_email  VARCHAR(255) NULL,
     ADD COLUMN escalation_level_2_email  VARCHAR(255) NULL,
     ADD COLUMN process_type              ENUM(''INBOUND'',''OUTBOUND'',''BACK_OFFICE'',''TECHNICAL_SUPPORT'',''CHAT'',''EMAIL'') NULL,
     ADD COLUMN billing_rate_per_hour     DECIMAL(10,2) NULL',
  'SELECT 1'
);
PREPARE stmt_pm FROM @sql_pm;
EXECUTE stmt_pm;
DEALLOCATE PREPARE stmt_pm;

-- ── 3. Enrich client_user with fields expected by enhanced-portal-user.service ─
SET @col_cu = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='client_user' AND COLUMN_NAME='phone'
);
SET @sql_cu = IF(@col_cu = 0,
  'ALTER TABLE client_user
     ADD COLUMN phone               VARCHAR(20)  NULL,
     ADD COLUMN department          VARCHAR(100) NULL,
     ADD COLUMN access_level        ENUM(''READ_ONLY'',''FULL_ACCESS'',''ADMIN'') DEFAULT ''READ_ONLY'',
     ADD COLUMN access_start_date   DATE         NULL,
     ADD COLUMN access_end_date     DATE         NULL,
     ADD COLUMN last_login_at       DATETIME     NULL,
     ADD COLUMN last_login_ip       VARCHAR(45)  NULL,
     ADD COLUMN login_count         INT          NOT NULL DEFAULT 0,
     ADD COLUMN deactivated_by      CHAR(36)     NULL,
     ADD COLUMN deactivated_at      DATETIME     NULL,
     ADD COLUMN deactivation_reason TEXT         NULL,
     ADD INDEX  idx_last_login (last_login_at)',
  'SELECT 1'
);
PREPARE stmt_cu FROM @sql_cu;
EXECUTE stmt_cu;
DEALLOCATE PREPARE stmt_cu;

-- ── 4. portal_user_sessions — for token revocation tracking ─────────────────
CREATE TABLE IF NOT EXISTS portal_user_sessions (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  client_user_id CHAR(36)     NOT NULL,
  jti            VARCHAR(36)  NOT NULL UNIQUE COMMENT 'JWT ID embedded in token for revocation',
  ip_address     VARCHAR(45)  NULL,
  user_agent     TEXT         NULL,
  issued_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at     DATETIME     NOT NULL,
  revoked_at     DATETIME     NULL,
  INDEX idx_pus_user   (client_user_id),
  INDEX idx_pus_jti    (jti),
  INDEX idx_pus_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. portal_user_permissions (granular — from migration 101, correct table) ─
CREATE TABLE IF NOT EXISTS portal_user_permissions (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  client_user_id  CHAR(36)     NOT NULL,
  permission_type VARCHAR(100) NOT NULL,
  resource_scope  VARCHAR(100) NULL,
  resource_ids    JSON         NULL,
  granted_by      CHAR(36)     NOT NULL,
  granted_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME     NULL,
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_user_perm (client_user_id, permission_type, resource_scope),
  INDEX idx_pup_user (client_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6. kpi_process_assignment — links a KPI template to a portal process ────
-- (separate from kpi_assignment which links to employees/designations)
CREATE TABLE IF NOT EXISTS kpi_process_assignment (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id     CHAR(36)     NOT NULL,
  template_id    CHAR(36)     NOT NULL,
  effective_from DATE         NOT NULL,
  effective_to   DATE         NULL COMMENT 'NULL = still active',
  assigned_by    CHAR(36)     NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_proc_tpl (process_id, template_id, effective_from),
  INDEX idx_kpa_process (process_id),
  FOREIGN KEY (template_id) REFERENCES kpi_template(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
