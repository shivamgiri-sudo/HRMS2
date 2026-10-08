-- 2138: Unified follow-up journey (one method for Live Meta, Old Meta data and Hiring Engine). qualified_followup gains the journey
-- (booked match, state, held reason, call result, re-invite number, missed-call and stage-A-end times) and a 'canary' row tag;
-- followup_person holds one owner per mobile, the re-contact hold and an opt-out flag; followup_canary lists the canary requisitions
-- per source; followup_shadow records what a dry-run step would have sent; he_message.sent_by tells the follow-up worker's sends apart.
-- The calling-file slot key is 2137's. Additive and re-runnable (information_schema-guarded, CREATE TABLE IF NOT EXISTS, no foreign keys).
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = 'match_id') = 0, "ALTER TABLE qualified_followup ADD COLUMN match_id CHAR(36) NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = 'journey_state') = 0, "ALTER TABLE qualified_followup ADD COLUMN journey_state VARCHAR(20) NOT NULL DEFAULT 'enrolled'", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = 'held_reason') = 0, "ALTER TABLE qualified_followup ADD COLUMN held_reason VARCHAR(40) NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = 'call_result') = 0, "ALTER TABLE qualified_followup ADD COLUMN call_result VARCHAR(40) NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = 'reinvite_no') = 0, "ALTER TABLE qualified_followup ADD COLUMN reinvite_no TINYINT NOT NULL DEFAULT 0", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = 'missed_call_due_at') = 0, "ALTER TABLE qualified_followup ADD COLUMN missed_call_due_at DATETIME NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = 'stage_a_ended_at') = 0, "ALTER TABLE qualified_followup ADD COLUMN stage_a_ended_at DATETIME NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = 'mode_at_enqueue' AND COLUMN_TYPE NOT LIKE '%canary%') = 1, "ALTER TABLE qualified_followup MODIFY COLUMN mode_at_enqueue ENUM('dry_run','live','test','canary') NOT NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND INDEX_NAME = 'idx_qfu_mode_journey') = 0, "ALTER TABLE qualified_followup ADD INDEX idx_qfu_mode_journey (mode_at_enqueue, journey_state)", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qualified_followup' AND INDEX_NAME = 'idx_qfu_match') = 0, "ALTER TABLE qualified_followup ADD INDEX idx_qfu_match (match_id)", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_message' AND COLUMN_NAME = 'sent_by') = 0, "ALTER TABLE he_message ADD COLUMN sent_by VARCHAR(20) NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS followup_person (
  mobile10              CHAR(10)    NOT NULL PRIMARY KEY,
  active_followup_id    CHAR(36)    NULL,
  last_first_contact_at DATETIME    NULL,
  reinvites_30d         TINYINT     NOT NULL DEFAULT 0,
  reinvite_window_start DATETIME    NULL,
  opted_out_at          DATETIME    NULL,
  opted_out_source      VARCHAR(20) NULL,
  updated_at            DATETIME    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS followup_canary (
  source_type    ENUM('meta_live','meta_old','he') NOT NULL,
  requisition_id CHAR(36) NOT NULL,
  added_by       CHAR(36) NULL,
  added_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_type, requisition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS followup_shadow (
  id             BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  followup_id    CHAR(36)    NOT NULL,
  mobile10       CHAR(10)    NOT NULL,
  requisition_id CHAR(36)    NOT NULL,
  source_type    VARCHAR(10) NOT NULL,
  step           VARCHAR(30) NOT NULL,
  template_key   VARCHAR(60) NULL,
  verdict        VARCHAR(40) NOT NULL,
  would_at       DATETIME    NOT NULL,
  created_at     DATETIME    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fs_when (would_at),
  KEY idx_fs_person (mobile10, would_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
