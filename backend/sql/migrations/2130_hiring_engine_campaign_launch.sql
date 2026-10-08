-- 2130: Hiring Engine campaign launches. (1) he_drive remembers WHO a drive is for (pool / meta / campaign / upload batch),
-- so the 5-minute tick re-lines the same audience instead of the whole pool; (2) he_lead_campaign keeps EVERY Meta form fill
-- of a person (he_lead.meta_lead_id keeps only one); (3) he_campaign_config: per Meta campaign owner (old Meta flow or the
-- Hiring Engine), channel switches and Superbot campaign id; (4) he_import_batch / he_lead_batch: one row per portal upload.
-- Additive and re-runnable.
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_drive' AND COLUMN_NAME = 'source_kind') = 0, "ALTER TABLE he_drive ADD COLUMN source_kind VARCHAR(12) NOT NULL DEFAULT 'pool', ADD COLUMN source_ids JSON NULL, ADD COLUMN max_lead_age_days INT NULL, ADD COLUMN run_label VARCHAR(120) NULL, ADD COLUMN reinvite TINYINT(1) NOT NULL DEFAULT 0", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS he_lead_campaign (
  meta_lead_id   CHAR(36)    NOT NULL PRIMARY KEY,
  lead_id        CHAR(36)    NOT NULL,
  campaign_id    CHAR(36)    NULL,
  requisition_id CHAR(36)    NULL,
  form_filled_at DATETIME    NULL,
  created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_he_lc_lead (lead_id),
  KEY idx_he_lc_campaign (campaign_id, form_filled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_campaign_config (
  campaign_id         CHAR(36)    NOT NULL PRIMARY KEY,
  owner               ENUM('meta','he') NOT NULL DEFAULT 'meta',
  email_on            TINYINT(1)  NOT NULL DEFAULT 1,
  whatsapp_on         TINYINT(1)  NOT NULL DEFAULT 1,
  voice_on            TINYINT(1)  NOT NULL DEFAULT 1,
  superbot_campaign   VARCHAR(40) NULL,
  updated_by          CHAR(36)    NULL,
  updated_at          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_import_batch (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  label          VARCHAR(160) NOT NULL,
  file_name      VARCHAR(255) NULL,
  source         VARCHAR(30)  NOT NULL,
  consent_attested TINYINT(1) NOT NULL DEFAULT 0,
  rows_total     INT          NOT NULL DEFAULT 0,
  created_count  INT          NOT NULL DEFAULT 0,
  enriched_count INT          NOT NULL DEFAULT 0,
  rejected_count INT          NOT NULL DEFAULT 0,
  blocked_json   JSON         NULL,
  uploaded_by    CHAR(36)     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_he_batch_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_lead_batch (
  lead_id  CHAR(36) NOT NULL,
  batch_id CHAR(36) NOT NULL,
  PRIMARY KEY (batch_id, lead_id),
  KEY idx_he_lb_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Re-invite template (T12) for people who never booked: drafted here, sends fall back to T8 until Meta approves it.
INSERT IGNORE INTO he_template (template_key, pinbot_name, language, approval_state) VALUES ('he_reinvite:en', NULL, 'en', 'draft'), ('he_reinvite:hi', NULL, 'hi', 'draft');
