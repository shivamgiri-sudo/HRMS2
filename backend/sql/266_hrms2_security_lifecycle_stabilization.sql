DELIMITER $$

DROP PROCEDURE IF EXISTS _m266_auth_two_factor_challenge $$
CREATE PROCEDURE _m266_auth_two_factor_challenge()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_two_factor_challenge'
  ) THEN
    CREATE TABLE auth_two_factor_challenge (
      id             CHAR(36)     NOT NULL,
      user_id        CHAR(36)     NOT NULL,
      channel        ENUM('email','sms') NOT NULL,
      recipient_hash CHAR(64)     NOT NULL,
      otp_hash       VARCHAR(255) NOT NULL,
      attempts       INT          NOT NULL DEFAULT 0,
      max_attempts   INT          NOT NULL DEFAULT 5,
      expires_at     DATETIME     NOT NULL,
      verified_at    DATETIME     NULL,
      status         ENUM('pending','verified','expired','locked') NOT NULL DEFAULT 'pending',
      created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_2fa_user_status (user_id, status, created_at),
      INDEX idx_2fa_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  END IF;
END $$
CALL _m266_auth_two_factor_challenge() $$
DROP PROCEDURE IF EXISTS _m266_auth_two_factor_challenge $$

DROP PROCEDURE IF EXISTS _m266_bgv_name_match_enum $$
CREATE PROCEDURE _m266_bgv_name_match_enum()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'ats_bgv_verification_details'
       AND COLUMN_NAME = 'verification_type'
       AND COLUMN_TYPE NOT LIKE '%name_match%'
  ) THEN
    ALTER TABLE ats_bgv_verification_details
      MODIFY verification_type ENUM('aadhaar','pan','education','employment','address','criminal','name_match') NOT NULL;
  END IF;
END $$
CALL _m266_bgv_name_match_enum() $$
DROP PROCEDURE IF EXISTS _m266_bgv_name_match_enum $$

DELIMITER ;
