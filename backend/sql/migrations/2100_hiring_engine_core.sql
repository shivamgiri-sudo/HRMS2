-- Migration 2100: Walk-in Hiring Engine core (phase 1).
-- Unified lead pool (one row per mobile10), append-only timeline, consent, walk-in drives, matches,
-- message log (provider message_id + delivery status + inbound replies), consented live-location pings
-- and the approved-template registry. All CREATE TABLE IF NOT EXISTS, utf8mb4_unicode_ci, no FKs to
-- keep it additive and safe to run against live data.

CREATE TABLE IF NOT EXISTS he_lead (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  mobile10        CHAR(10)     NOT NULL,
  full_name       VARCHAR(150) NULL,
  email           VARCHAR(190) NULL,
  age             TINYINT UNSIGNED NULL,
  education_rank  TINYINT UNSIGNED NULL,
  experience_years DECIMAL(4,1) NULL,
  night_shift_ok  TINYINT(1)   NULL,
  pincode         VARCHAR(10)  NULL,
  locality        VARCHAR(150) NULL,
  lat             DECIMAL(10,7) NULL,
  lng             DECIMAL(10,7) NULL,
  primary_source  VARCHAR(30)  NOT NULL DEFAULT 'unknown',
  sources_json    JSON         NULL,
  ats_candidate_id CHAR(36)    NULL,
  meta_lead_id    CHAR(36)     NULL,
  status          ENUM('new','contacted','interested','invited','confirmed','rescheduled','arrived','no_show','declined','opted_out','joined','dead') NOT NULL DEFAULT 'new',
  status_at       DATETIME     NULL,
  last_contact_at DATETIME     NULL,
  next_action_at  DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_he_lead_mobile (mobile10),
  KEY idx_he_lead_status (status, next_action_at),
  KEY idx_he_lead_ats (ats_candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_lead_event (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lead_id    CHAR(36)     NOT NULL,
  drive_id   CHAR(36)     NULL,
  event_type VARCHAR(40)  NOT NULL,
  channel    VARCHAR(20)  NULL,
  detail     VARCHAR(500) NULL,
  meta_json  JSON         NULL,
  actor      VARCHAR(60)  NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_he_event_lead (lead_id, created_at),
  KEY idx_he_event_drive (drive_id, event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_consent (
  id           CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  lead_id      CHAR(36)    NOT NULL,
  consent_type ENUM('whatsapp_contact','location') NOT NULL,
  text_version VARCHAR(40) NOT NULL,
  source       VARCHAR(40) NOT NULL,
  granted_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at   DATETIME    NULL,
  KEY idx_he_consent_lead (lead_id, consent_type, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_drive (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  requisition_id CHAR(36)     NOT NULL,
  branch_name    VARCHAR(150) NOT NULL,
  drive_date     DATE         NOT NULL,
  slot_start     TIME         NOT NULL DEFAULT '10:00:00',
  slot_end       TIME         NOT NULL DEFAULT '17:30:00',
  slot_minutes   SMALLINT     NOT NULL DEFAULT 30,
  slot_capacity  SMALLINT     NOT NULL DEFAULT 6,
  target_shows   INT          NOT NULL DEFAULT 0,
  show_rate_pct  TINYINT UNSIGNED NOT NULL DEFAULT 40,
  status         ENUM('draft','active','paused','closed') NOT NULL DEFAULT 'draft',
  auto_send      TINYINT(1)   NOT NULL DEFAULT 0,
  created_by     CHAR(36)     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_he_drive (requisition_id, branch_name, drive_date),
  KEY idx_he_drive_date (drive_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_match (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  lead_id        CHAR(36)     NOT NULL,
  requisition_id CHAR(36)     NOT NULL,
  drive_id       CHAR(36)     NULL,
  score          TINYINT UNSIGNED NOT NULL,
  reasons_json   JSON         NULL,
  distance_km    DECIMAL(6,1) NULL,
  state          ENUM('suggested','invited','confirmed','slot_released','arrived','no_show','declined','selected') NOT NULL DEFAULT 'suggested',
  slot_at        DATETIME     NULL,
  token          CHAR(32)     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_he_match (lead_id, requisition_id),
  UNIQUE KEY uq_he_match_token (token),
  KEY idx_he_match_drive (drive_id, state, slot_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_message (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  lead_id          CHAR(36)     NULL,
  mobile10         CHAR(10)     NOT NULL,
  direction        ENUM('out','in') NOT NULL,
  channel          VARCHAR(20)  NOT NULL DEFAULT 'whatsapp',
  template_key     VARCHAR(60)  NULL,
  body             VARCHAR(2000) NULL,
  provider_message_id VARCHAR(120) NULL,
  delivery_status  ENUM('queued','sent','delivered','read','failed') NULL,
  intent           VARCHAR(20)  NULL,
  error_message    VARCHAR(500) NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_he_msg_mobile (mobile10, created_at),
  KEY idx_he_msg_provider (provider_message_id),
  KEY idx_he_msg_lead (lead_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_location_ping (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_id    CHAR(36)     NOT NULL,
  lat         DECIMAL(10,7) NOT NULL,
  lng         DECIMAL(10,7) NOT NULL,
  accuracy_m  INT          NULL,
  distance_km DECIMAL(6,2) NULL,
  eta_min     INT          NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_he_ping_match (match_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_template (
  template_key   VARCHAR(60)  NOT NULL PRIMARY KEY,
  pinbot_name    VARCHAR(120) NULL,
  language       VARCHAR(10)  NOT NULL DEFAULT 'en',
  param_names    JSON         NULL,
  sample_body    VARCHAR(1500) NULL,
  approval_state ENUM('draft','submitted','approved','rejected') NOT NULL DEFAULT 'draft',
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
