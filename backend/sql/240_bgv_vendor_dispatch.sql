-- Migration 240: BGV Vendor Dispatch
-- When automated API BGV fails, HR can dispatch documents to an external vendor.
-- This table tracks the full lifecycle: dispatch → vendor acknowledgement → result → BGV check sync.

DELIMITER $$

DROP PROCEDURE IF EXISTS _create_bgv_vendor_dispatch $$
CREATE PROCEDURE _create_bgv_vendor_dispatch()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_bgv_vendor_dispatch'
  ) THEN
    CREATE TABLE candidate_bgv_vendor_dispatch (
      id                    CHAR(36)     NOT NULL,
      candidate_id          CHAR(36)     NOT NULL,
      check_id              CHAR(36)     NULL,
      check_type            VARCHAR(50)  NULL,
      vendor_name           VARCHAR(200) NOT NULL,
      vendor_contact_email  VARCHAR(255) NULL,
      vendor_contact_phone  VARCHAR(20)  NULL,
      document_ids          JSON         NULL,
      dispatch_notes        TEXT         NULL,
      status                ENUM('pending_send','sent','acknowledged','result_received','completed','failed') NOT NULL DEFAULT 'sent',
      sent_by               CHAR(36)     NOT NULL,
      sent_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      vendor_reference_no   VARCHAR(200) NULL,
      vendor_result         ENUM('verified','not_verified','inconclusive') NULL,
      vendor_remarks        TEXT         NULL,
      result_received_at    DATETIME     NULL,
      result_updated_by     CHAR(36)     NULL,
      bgv_check_updated     TINYINT(1)   NOT NULL DEFAULT 0,
      created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_bgv_vd_candidate (candidate_id),
      INDEX idx_bgv_vd_check     (check_id),
      INDEX idx_bgv_vd_status    (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  END IF;
END$$
CALL _create_bgv_vendor_dispatch() $$
DROP PROCEDURE IF EXISTS _create_bgv_vendor_dispatch $$

DELIMITER ;
