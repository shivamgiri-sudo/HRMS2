USE mas_hrms;

CREATE TABLE IF NOT EXISTS auth_user (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  email        VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_blocked          TINYINT(1)   NOT NULL DEFAULT 0,
  must_change_password TINYINT(1)   NOT NULL DEFAULT 0,
  last_login_at DATETIME    NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_auth_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT 'Replaces Supabase auth.users — application-level user authentication';

CREATE TABLE IF NOT EXISTS auth_refresh_token (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id      CHAR(36)     NOT NULL,
  token_hash   VARCHAR(255) NOT NULL UNIQUE,
  expires_at   DATETIME     NOT NULL,
  revoked      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE,
  INDEX idx_rt_user_active (user_id, revoked),
  INDEX idx_rt_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 050 applied: auth_user and auth_refresh_token tables created' AS status;
