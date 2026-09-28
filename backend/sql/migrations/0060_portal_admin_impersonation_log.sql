CREATE TABLE IF NOT EXISTS portal_admin_impersonation_log (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_user_id INT UNSIGNED NOT NULL,
  portal_user_id INT UNSIGNED NOT NULL,
  client_email  VARCHAR(255) NOT NULL,
  reason        TEXT NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin (admin_user_id),
  INDEX idx_portal_user (portal_user_id),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
