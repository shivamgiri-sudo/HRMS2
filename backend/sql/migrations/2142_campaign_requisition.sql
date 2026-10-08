-- 2142: Campaign x requisition (WS3 A1, plan 2026-10-08-campaign-requisition-drive-plan).
-- meta_campaign_requisition: a Meta campaign holds many requisitions; exactly one is primary and stays mirrored into
--   meta_campaign.requisition_id (kept NOT NULL; '' stays the "JR pending" marker), so every existing reader keeps working.
--   Removing a link is soft (removed_at/removed_by). Backfill: the current link of every campaign becomes its primary.
-- meta_lead_raw.routed_by / routed_at: how a Live Meta lead got its requisition ('form' | 'routing_code' | 'best_fit' | 'hold' | 'hr').
-- meta_campaign_relink: audit of an HR "relink to an open requisition" (who, why, the preview it confirmed, how many leads moved).
-- Additive and re-runnable: CREATE TABLE IF NOT EXISTS, INSERT IGNORE, ALTERs guarded through information_schema + PREPARE. No FKs.
CREATE TABLE IF NOT EXISTS meta_campaign_requisition (
  campaign_id CHAR(36) NOT NULL,
  requisition_id CHAR(36) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  added_by CHAR(36) NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at DATETIME NULL,
  removed_by CHAR(36) NULL,
  PRIMARY KEY (campaign_id, requisition_id),
  KEY idx_mcr_req (requisition_id, removed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO meta_campaign_requisition (campaign_id, requisition_id, is_primary)
SELECT id, requisition_id, 1 FROM meta_campaign WHERE requisition_id IS NOT NULL AND requisition_id <> '';

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meta_lead_raw') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meta_lead_raw' AND COLUMN_NAME = 'routed_by') = 0, "ALTER TABLE meta_lead_raw ADD COLUMN routed_by VARCHAR(12) COLLATE utf8mb4_unicode_ci NULL COMMENT 'form | routing_code | best_fit | hold | hr'", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meta_lead_raw') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meta_lead_raw' AND COLUMN_NAME = 'routed_at') = 0, "ALTER TABLE meta_lead_raw ADD COLUMN routed_at DATETIME NULL", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS meta_campaign_relink (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  from_requisition_id CHAR(36) NULL,
  to_requisition_id CHAR(36) NOT NULL,
  leads_moved INT NOT NULL,
  leads_kept INT NOT NULL COMMENT 'already contacted: never moved',
  preview_hash CHAR(64) NOT NULL,
  actor_id CHAR(36) NOT NULL,
  actor_role VARCHAR(40) NULL,
  reason VARCHAR(300) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mcrl_campaign (campaign_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
