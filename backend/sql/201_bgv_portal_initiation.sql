-- Migration 201: BGV portal initiation fields
-- Adds InfinitiAI candidate portal tracking columns to candidate_bgv_report

DELIMITER $$

DROP PROCEDURE IF EXISTS _add_bgv_portal_cols $$
CREATE PROCEDURE _add_bgv_portal_cols()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_bgv_report' AND COLUMN_NAME = 'infinity_ai_case_id'
  ) THEN
    ALTER TABLE candidate_bgv_report
      ADD COLUMN infinity_ai_case_id  VARCHAR(120) NULL AFTER locked,
      ADD COLUMN portal_initiated_at  DATETIME     NULL AFTER infinity_ai_case_id,
      ADD COLUMN portal_candidate_email VARCHAR(255) NULL AFTER portal_initiated_at,
      ADD COLUMN portal_login_url     VARCHAR(500) NULL AFTER portal_candidate_email,
      ADD COLUMN portal_initiated_by  CHAR(36)     NULL AFTER portal_login_url,
      ADD COLUMN portal_status        ENUM('not_initiated','initiated','candidate_submitted','completed','expired') NOT NULL DEFAULT 'not_initiated' AFTER portal_initiated_by;
  END IF;
END$$
CALL _add_bgv_portal_cols() $$
DROP PROCEDURE IF EXISTS _add_bgv_portal_cols $$

DELIMITER ;
