-- Migration 241: ats_bgv_verification and ats_bgv_verification_details
-- Required by bgv.enhanced.service.ts (separate from candidate_bgv_check used by bgv-verification.service.ts)

DELIMITER $$

DROP PROCEDURE IF EXISTS _create_ats_bgv_verification $$
CREATE PROCEDURE _create_ats_bgv_verification()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_bgv_verification'
  ) THEN
    CREATE TABLE ats_bgv_verification (
      id                  INT            NOT NULL AUTO_INCREMENT,
      candidate_id        CHAR(36)       NOT NULL,
      verification_status ENUM('pending','in_progress','verified','failed') NOT NULL DEFAULT 'pending',
      aadhaar_status      VARCHAR(50)    NULL,
      pan_status          VARCHAR(50)    NULL,
      education_status    VARCHAR(50)    NULL,
      employment_status   VARCHAR(50)    NULL,
      address_status      VARCHAR(50)    NULL,
      criminal_status     VARCHAR(50)    NULL,
      overall_progress    INT            NOT NULL DEFAULT 0,
      completed_at        DATETIME       NULL,
      created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_bgv_ver_candidate (candidate_id),
      INDEX idx_bgv_ver_status    (verification_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  END IF;
END$$
CALL _create_ats_bgv_verification() $$
DROP PROCEDURE IF EXISTS _create_ats_bgv_verification $$

DROP PROCEDURE IF EXISTS _create_ats_bgv_verification_details $$
CREATE PROCEDURE _create_ats_bgv_verification_details()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_bgv_verification_details'
  ) THEN
    CREATE TABLE ats_bgv_verification_details (
      id                  INT            NOT NULL AUTO_INCREMENT,
      bgv_id              INT            NOT NULL,
      candidate_id        CHAR(36)       NOT NULL,
      verification_type   ENUM('aadhaar','pan','education','employment','address','criminal') NOT NULL,
      status              ENUM('pending','in_progress','verified','failed','manual_review') NOT NULL DEFAULT 'pending',
      verification_method VARCHAR(100)   NULL,
      document_number     VARCHAR(200)   NULL,
      initiated_by        CHAR(36)       NULL,
      reviewed_by         CHAR(36)       NULL,
      remarks             TEXT           NULL,
      result_data         JSON           NULL,
      completed_at        DATETIME       NULL,
      created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_bgv_det_bgv_id    (bgv_id),
      INDEX idx_bgv_det_candidate (candidate_id),
      INDEX idx_bgv_det_type      (verification_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  END IF;
END$$
CALL _create_ats_bgv_verification_details() $$
DROP PROCEDURE IF EXISTS _create_ats_bgv_verification_details $$

DELIMITER ;
