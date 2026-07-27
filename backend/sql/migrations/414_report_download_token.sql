-- Migration 414: secure single-use download tokens for restricted report files
-- Used by the worker when sensitivityLevel is 'restricted' or 'highly_restricted'.
-- Raw token is sent in email link; only SHA-256 hash is stored here (token never persists).

CREATE TABLE IF NOT EXISTS report_download_token (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash          CHAR(64) NOT NULL UNIQUE,        -- SHA-256(raw_token), hex
  file_id             VARCHAR(36) NOT NULL,             -- report_generated_file.id (UUID)
  requesting_user_id  INT UNSIGNED NOT NULL,
  report_code         VARCHAR(100) NOT NULL,
  expires_at          DATETIME NOT NULL,
  download_status     ENUM('AVAILABLE','IN_PROGRESS','USED','REVOKED','EXPIRED')
                      NOT NULL DEFAULT 'AVAILABLE',
  used_at             DATETIME NULL,
  revoked_at          DATETIME NULL,
  revoked_by_user_id  INT UNSIGNED NULL,
  created_at          DATETIME NOT NULL DEFAULT NOW(),
  INDEX idx_expires       (expires_at),
  INDEX idx_file          (file_id),
  INDEX idx_user_code     (requesting_user_id, report_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill columns on report_request for richer failure tracking (additive — no data loss).
ALTER TABLE report_request
  ADD COLUMN IF NOT EXISTS failure_code              VARCHAR(100)  NULL AFTER failure_message,
  ADD COLUMN IF NOT EXISTS failure_message_user      VARCHAR(500)  NULL AFTER failure_code,
  ADD COLUMN IF NOT EXISTS failure_message_internal  TEXT          NULL AFTER failure_message_user;

-- Delivery method and secure link support for report_email_delivery.
ALTER TABLE report_email_delivery
  ADD COLUMN IF NOT EXISTS delivery_method       ENUM('ATTACHMENT','LINK') NULL AFTER attachment_size_bytes,
  ADD COLUMN IF NOT EXISTS secure_download_url   TEXT NULL AFTER delivery_method;
