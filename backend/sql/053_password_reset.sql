-- 053_password_reset.sql
-- Adds auth_password_reset table for MySQL-native password reset flow.
-- Run once on mas_hrms before using forgot-password endpoint.
USE mas_hrms;

CREATE TABLE IF NOT EXISTS auth_password_reset (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id    CHAR(36)     NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME     NOT NULL,
  used       TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE,
  INDEX idx_prt_token (token_hash),
  INDEX idx_prt_user (user_id)
);
