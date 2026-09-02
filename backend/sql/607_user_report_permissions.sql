-- Per-employee report access grants
-- Allows admins to grant specific employees access to specific reports
-- independently of their assigned role.
CREATE TABLE IF NOT EXISTS user_report_permissions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT          NOT NULL,
  report_code   VARCHAR(100) NOT NULL,
  can_view      TINYINT(1)   NOT NULL DEFAULT 1,
  can_export    TINYINT(1)   NOT NULL DEFAULT 0,
  granted_by    INT          NOT NULL,
  granted_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME     NULL,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_user_report  (user_id, report_code),
  KEY           idx_user_id  (user_id)
);

-- Role-based report access grants
-- Allows admins to assign specific reports to a role, extending the
-- hardcoded catalog viewRoles/exportRoles without touching source code.
CREATE TABLE IF NOT EXISTS role_report_permissions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  role_key      VARCHAR(100) NOT NULL,
  report_code   VARCHAR(100) NOT NULL,
  can_view      TINYINT(1)   NOT NULL DEFAULT 1,
  can_export    TINYINT(1)   NOT NULL DEFAULT 0,
  granted_by    INT          NOT NULL,
  granted_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_role_report  (role_key, report_code),
  KEY           idx_role_key (role_key)
);