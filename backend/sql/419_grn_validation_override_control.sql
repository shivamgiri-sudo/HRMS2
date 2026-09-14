-- 419_grn_validation_override_control.sql
-- Persistent Finance-approved exceptions for smart-GRN blocking validations.

CREATE TABLE IF NOT EXISTS grn_validation_override (
  id CHAR(36) PRIMARY KEY,
  grn_request_id CHAR(36) NOT NULL,
  validation_code VARCHAR(100) NOT NULL,
  override_reason TEXT NOT NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  approved_by CHAR(36) NOT NULL,
  approved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_by CHAR(36) NULL,
  revoked_at DATETIME NULL,
  revoke_reason TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_grn_validation_override (grn_request_id, validation_code),
  INDEX idx_grn_validation_override_active (grn_request_id, active_status),
  CONSTRAINT fk_grn_validation_override_grn
    FOREIGN KEY (grn_request_id) REFERENCES grn_request(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
