USE mas_hrms;

-- Add call_centre_code scoping to letter_template
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='letter_template' AND COLUMN_NAME='call_centre_code');
SET @sql = IF(@col = 0,
  "ALTER TABLE letter_template ADD COLUMN call_centre_code VARCHAR(30) NULL COMMENT 'NULL = applies to all CC; specific value = CC-specific override', ADD COLUMN approval_required TINYINT(1) NOT NULL DEFAULT 0, ADD INDEX idx_lt_cc_code (call_centre_code)",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Offer letter approval log
CREATE TABLE IF NOT EXISTS offer_letter_approval (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  generated_letter_id CHAR(36) NOT NULL,
  requested_by CHAR(36) NOT NULL,
  approved_by CHAR(36) NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  comments TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ola_letter (generated_letter_id),
  INDEX idx_ola_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 048 applied: offer letter CC scoping and approval log' AS status;
