-- Migration 303: Auth OTP password reset + is_read_only column
-- Safe stored-procedure pattern for MySQL 8.0

DROP PROCEDURE IF EXISTS mig303;
DELIMITER $$
CREATE PROCEDURE mig303()
BEGIN
  -- Add is_read_only to auth_user if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='auth_user' AND COLUMN_NAME='is_read_only'
  ) THEN
    ALTER TABLE auth_user ADD COLUMN is_read_only TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

  -- OTP password reset table
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='auth_otp_reset'
  ) THEN
    CREATE TABLE auth_otp_reset (
      id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
      user_id     CHAR(36)     NOT NULL,
      phone       VARCHAR(20),
      otp_hash    VARCHAR(255) NOT NULL,
      expires_at  DATETIME     NOT NULL,
      used        TINYINT(1)   NOT NULL DEFAULT 0,
      attempts    INT          NOT NULL DEFAULT 0,
      created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_otp_user (user_id),
      INDEX idx_otp_phone (phone),
      FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  END IF;
END$$
DELIMITER ;
CALL mig303();
DROP PROCEDURE IF EXISTS mig303;
SELECT 'Migration 303 applied: is_read_only column + auth_otp_reset table' AS status;
