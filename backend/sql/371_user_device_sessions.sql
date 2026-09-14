-- Migration 371: User Device Sessions Tracking
-- Purpose: Track individual device sessions for multi-device logout and session management
-- Author: Claude Code (Session Security & Audit Phase 2)
-- Date: 2026-07-08

CREATE TABLE IF NOT EXISTS user_device_sessions (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  refresh_token_hash VARCHAR(64) NOT NULL,
  device_fingerprint VARCHAR(100),
  device_name VARCHAR(100) COMMENT 'Human-readable device description: "Chrome on Windows", "Safari on iPhone"',
  ip_address VARCHAR(45) COMMENT 'IPv4 or IPv6 address',
  user_agent TEXT COMMENT 'Full user agent string for forensics',
  location_city VARCHAR(100) COMMENT 'Geolocation city (optional)',
  location_country VARCHAR(100) COMMENT 'Geolocation country (optional)',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL COMMENT 'Matches refresh token expiry',
  revoked_at DATETIME DEFAULT NULL COMMENT 'Manual revocation or security event',

  FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE,

  INDEX idx_user_sessions_user (user_id),
  INDEX idx_user_sessions_active (user_id, revoked_at, expires_at),
  INDEX idx_user_sessions_token (refresh_token_hash),
  INDEX idx_user_sessions_device (device_fingerprint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Tracks individual device sessions for multi-device management and security auditing';

-- Add org_settings for session management features
INSERT INTO org_settings (setting_key, setting_value, description, created_at, updated_at)
VALUES
  ('single_device_session_mode', '0', 'If 1, logging in from new device logs out all other sessions', NOW(), NOW()),
  ('auto_logout_minutes', '0', 'Inactivity timeout in minutes (0 = disabled)', NOW(), NOW())
ON DUPLICATE KEY UPDATE updated_at = NOW();
