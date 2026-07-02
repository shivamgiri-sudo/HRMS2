-- 100_user_page_access.sql
-- User-level page access overrides for super admin to assign specific pages to individual users
USE mas_hrms;

CREATE TABLE IF NOT EXISTS user_page_access (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id       CHAR(36)     NOT NULL,
  page_code     VARCHAR(100) NOT NULL,
  can_view      TINYINT(1)   NOT NULL DEFAULT 1,
  can_create    TINYINT(1)   NOT NULL DEFAULT 0,
  can_edit      TINYINT(1)   NOT NULL DEFAULT 0,
  can_delete    TINYINT(1)   NOT NULL DEFAULT 0,
  can_export    TINYINT(1)   NOT NULL DEFAULT 0,
  assigned_by   CHAR(36)     NOT NULL COMMENT 'Admin user who assigned access',
  assigned_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_by    CHAR(36)     NULL,
  revoked_at    DATETIME     NULL,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  notes         TEXT         NULL COMMENT 'Reason for assignment',
  UNIQUE KEY uq_user_page (user_id, page_code),
  INDEX idx_user_page_user (user_id),
  INDEX idx_user_page_code (page_code),
  INDEX idx_user_page_assigned (assigned_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Per-user page access overrides - takes precedence over role_page_access';

-- Create page catalog if not exists
CREATE TABLE IF NOT EXISTS page_catalog (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  page_code     VARCHAR(100) NOT NULL UNIQUE,
  page_name     VARCHAR(255) NOT NULL,
  page_path     VARCHAR(255) NULL COMMENT 'Frontend route path',
  module        VARCHAR(100) NULL COMMENT 'Module grouping',
  description   TEXT         NULL,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Master list of all pages in the system';

-- Seed page catalog from existing role_page_access
INSERT INTO page_catalog (page_code, page_name, module, page_path)
SELECT DISTINCT
  page_code,
  REPLACE(REPLACE(page_code, '_', ' '), 'DASHBOARD', 'Dashboard') AS page_name,
  CASE
    WHEN page_code LIKE 'ATS_%' THEN 'ATS'
    WHEN page_code LIKE 'LMS_%' THEN 'LMS'
    WHEN page_code LIKE 'WFM_%' THEN 'WFM'
    WHEN page_code LIKE 'QUALITY_%' THEN 'Quality'
    WHEN page_code LIKE 'OPERATIONS_%' THEN 'Operations'
    WHEN page_code LIKE 'WORKFORCE_%' THEN 'Workforce'
    ELSE 'System'
  END AS module,
  NULL AS page_path
FROM role_page_access
WHERE page_code NOT IN (SELECT page_code FROM page_catalog)
ON DUPLICATE KEY UPDATE page_name = VALUES(page_name);

-- Audit trail for page access assignments
CREATE TABLE IF NOT EXISTS user_page_access_audit (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id       CHAR(36)     NOT NULL,
  page_code     VARCHAR(100) NOT NULL,
  action        ENUM('ASSIGN', 'REVOKE', 'MODIFY') NOT NULL,
  actor_user_id CHAR(36)     NOT NULL COMMENT 'Admin who performed action',
  old_permissions JSON       NULL COMMENT 'Previous permission state',
  new_permissions JSON       NULL COMMENT 'New permission state',
  notes         TEXT         NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_page (page_code),
  INDEX idx_audit_actor (actor_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Audit log for all page access assignments';
