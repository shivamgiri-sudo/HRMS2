-- Migration 1765: portal_sessions — stores active client-portal JWT sessions so that
-- HR Admin impersonation tokens can be tracked and revoked if needed.
-- Additive only (new table). Idempotent via CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS portal_sessions (
  id           CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
  portal_user_id INT UNSIGNED NOT NULL,
  token_hash   CHAR(64)     NOT NULL,
  expires_at   DATETIME     NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_portal_sessions_token (token_hash),
  KEY idx_portal_sessions_user (portal_user_id),
  KEY idx_portal_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
