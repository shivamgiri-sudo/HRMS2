-- 1016_bgv_report_digilocker_esign.sql
--
-- Surface DigiLocker and eSign in the BGV report.
--
-- candidate_bgv_report already carries pan/aadhaar/bank/education/employment/
-- address/criminal, but has no DigiLocker column at all — so the 'digilocker'
-- check type was silently dropped by syncBgvChecksToReport's column map and
-- never reached the report. esignature_status exists but was likewise never
-- populated.
--
-- Additive and idempotent: adds the DigiLocker columns only when absent.

DROP PROCEDURE IF EXISTS _1016_add_col;
DELIMITER //
CREATE PROCEDURE _1016_add_col(IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl VARCHAR(255))
BEGIN
  IF (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col) = 0 THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', ddl);
    PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- Same enum vocabulary as the sibling status columns so the report renderer and
-- syncBgvChecksToReport's status map need no special-casing.
CALL _1016_add_col('candidate_bgv_report', 'digilocker_status',
  "ENUM('not_run','passed','failed','partial') NOT NULL DEFAULT 'not_run'");
CALL _1016_add_col('candidate_bgv_report', 'digilocker_remarks', 'TEXT NULL');
CALL _1016_add_col('candidate_bgv_report', 'digilocker_documents_json', 'JSON NULL');
CALL _1016_add_col('candidate_bgv_report', 'digilocker_completed_at', 'DATETIME NULL');

DROP PROCEDURE IF EXISTS _1016_add_col;
