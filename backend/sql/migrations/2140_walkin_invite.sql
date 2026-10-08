-- 2140: Invitation tokens for people invited without an he_match (legacy Meta Notify / Notify All / sync, pipeline Meta rows, HR manual),
-- one active invite per mobile10 + requisition (token reused across re-sends), plus the cross-channel confirmation stamp on he_match
-- (first confirming response wins: confirmed_at / confirmed_via / confirmed_response_id). Additive, re-runnable, no foreign keys.
CREATE TABLE IF NOT EXISTS walkin_invite (
  id CHAR(36) NOT NULL PRIMARY KEY,
  token CHAR(32) NOT NULL,
  mobile10 CHAR(10) NOT NULL,
  requisition_id CHAR(36) NOT NULL,
  lead_id CHAR(36) NULL,
  meta_lead_id CHAR(36) NULL,
  followup_id CHAR(36) NULL,
  campaign_id CHAR(36) NULL,
  drive_type VARCHAR(10) NULL,
  branch_name VARCHAR(255) NULL,
  slot_at DATETIME NULL,
  source_path VARCHAR(20) NOT NULL,
  state ENUM('sent','answered_yes','answered_later','declined','stopped','superseded') NOT NULL DEFAULT 'sent',
  match_id CHAR(36) NULL,
  first_sent_at DATETIME NOT NULL,
  last_sent_at DATETIME NOT NULL,
  send_count SMALLINT NOT NULL DEFAULT 1,
  answered_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wi_token (token),
  UNIQUE KEY uq_wi_person_req (mobile10, requisition_id),
  KEY idx_wi_meta (meta_lead_id),
  KEY idx_wi_match (match_id),
  KEY idx_wi_req_slot (requisition_id, slot_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_match' AND COLUMN_NAME = 'confirmed_at') = 0, "ALTER TABLE he_match ADD COLUMN confirmed_at DATETIME NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_match' AND COLUMN_NAME = 'confirmed_via') = 0, "ALTER TABLE he_match ADD COLUMN confirmed_via VARCHAR(12) NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_match' AND COLUMN_NAME = 'confirmed_response_id') = 0, "ALTER TABLE he_match ADD COLUMN confirmed_response_id BIGINT UNSIGNED NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_match' AND INDEX_NAME = 'idx_he_match_confirmed') = 0, "ALTER TABLE he_match ADD INDEX idx_he_match_confirmed (drive_id, confirmed_at)", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
