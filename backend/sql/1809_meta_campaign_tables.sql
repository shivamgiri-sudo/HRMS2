-- Migration 1809: META Campaign Automation — data foundation.
--
-- Three new tables, all purely additive; no existing table is touched.
--
--   meta_campaign    One row per requisition's Lead Gen campaign. Holds meta_form_id, which is
--                    the join key the webhook uses to route an incoming form fill back to a
--                    requisition (META's webhook payload carries form_id, never our IDs), plus
--                    the daily-synced insight counters (impressions/reach/clicks/spend).
--
--   meta_lead_raw    One row per form fill. raw_payload is kept verbatim so a lead can be
--                    re-parsed after a mapping fix without re-querying the Graph API (lead data
--                    is only retrievable for 90 days). meta_lead_id is UNIQUE because META's
--                    webhook delivery is at-least-once — the same leadgen_id is redelivered on
--                    any non-2xx response, and re-processing must not mint duplicate candidates.
--
--   meta_webhook_log Raw receipt log written BEFORE parsing, so a payload whose shape we don't
--                    yet handle is recoverable instead of lost. Deliberately MEDIUMTEXT rather
--                    than JSON: a malformed body must still be storable for diagnosis, and a
--                    JSON column would reject it.
--
-- Numbering note: the plan for this feature said "current max migration is 528" and proposed
-- 529/530. Both are long since taken (529_reports_center_page_access.sql,
-- 530_auth_session_security_hardening.sql). Actual max at time of writing was 1808.
--
-- No FOREIGN KEYs, deliberately, on two counts. (1) The plan specified
-- fk_mc_requisition ... ON DELETE CASCADE, which would silently destroy spend and lead history
-- the moment a requisition row is removed — campaign cost is financial data and must outlive
-- the requisition. (2) job_requisition.id and these CHAR(36) columns must match on charset AND
-- collation for a FK to be creatable at all; 1500_wfm_roster_import_engine.sql and
-- 1536_wfm_roster_import_branch_scope.sql both document hitting exactly that trap on
-- utf8mb4_unicode_ci. Referential integrity is enforced in the service layer instead, and
-- requisition_id/campaign_id are indexed so the joins stay cheap.
--
-- meta_form_id is UNIQUE on meta_campaign (the plan had a plain index). One Lead Gen form maps
-- to exactly one requisition; without the constraint an operator who pastes the same form ID
-- onto two requisitions makes webhook routing non-deterministic, and the failure would show up
-- as candidates silently attached to the wrong requisition. MySQL allows unlimited NULLs in a
-- UNIQUE index, so campaigns not yet linked to a form are unaffected.

USE mas_hrms;

CREATE TABLE IF NOT EXISTS meta_campaign (
  id               CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  requisition_id   CHAR(36)       NOT NULL,
  meta_campaign_id VARCHAR(100)   NULL COMMENT 'Facebook campaign ID',
  meta_adset_id    VARCHAR(100)   NULL,
  meta_ad_id       VARCHAR(100)   NULL,
  meta_form_id     VARCHAR(100)   NULL COMMENT 'Lead Gen Form ID - webhook routing key',
  campaign_name    VARCHAR(255)   NOT NULL,
  campaign_status  ENUM('draft','active','paused','completed','archived') NOT NULL DEFAULT 'draft',
  impressions      INT UNSIGNED   NOT NULL DEFAULT 0,
  reach            INT UNSIGNED   NOT NULL DEFAULT 0,
  clicks           INT UNSIGNED   NOT NULL DEFAULT 0,
  leads_count      INT UNSIGNED   NOT NULL DEFAULT 0,
  spend_inr        DECIMAL(12,2)  NOT NULL DEFAULT 0,
  last_synced_at   DATETIME       NULL,
  last_sync_error  TEXT           NULL COMMENT 'Populated when the nightly insights sync fails, cleared on success',
  notes            TEXT           NULL,
  created_by       CHAR(36)       NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mc_requisition (requisition_id),
  UNIQUE KEY uk_mc_form (meta_form_id),
  INDEX idx_mc_status (campaign_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta_lead_raw (
  id                      CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  meta_form_id            VARCHAR(100) NOT NULL,
  meta_lead_id            VARCHAR(100) NOT NULL COMMENT 'Facebook leadgen_id - dedup key against at-least-once webhook delivery',
  campaign_id             CHAR(36)     NULL,
  requisition_id          CHAR(36)     NULL,
  raw_payload             JSON         NOT NULL,
  parsed_name             VARCHAR(255) NULL,
  parsed_phone            VARCHAR(30)  NULL,
  parsed_email            VARCHAR(255) NULL,
  parsed_age              TINYINT      NULL,
  parsed_location         VARCHAR(255) NULL,
  parsed_education        VARCHAR(255) NULL,
  parsed_experience_yr    DECIMAL(4,1) NULL,
  screening_result        ENUM('pending','qualified','disqualified') NOT NULL DEFAULT 'pending',
  disqualification_reason TEXT         NULL,
  ats_candidate_id        CHAR(36)     NULL COMMENT 'Set once an ATS candidate row has been created',
  notification_sent_at    DATETIME     NULL,
  notification_channels   JSON         NULL COMMENT 'e.g. ["email","whatsapp","voice"]',
  voice_call_status       VARCHAR(50)  NULL,
  voice_call_outcome      TEXT         NULL,
  voice_called_at         DATETIME     NULL,
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ml_lead (meta_lead_id),
  INDEX idx_ml_form (meta_form_id),
  INDEX idx_ml_campaign (campaign_id),
  INDEX idx_ml_requisition (requisition_id),
  INDEX idx_ml_phone (parsed_phone),
  INDEX idx_ml_screening (screening_result),
  INDEX idx_ml_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta_webhook_log (
  id          CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  event_type  VARCHAR(50) NOT NULL,
  payload     MEDIUMTEXT  NOT NULL COMMENT 'Raw body as received from META, stored before parsing',
  processed   TINYINT(1)  NOT NULL DEFAULT 0,
  error_msg   TEXT        NULL,
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mwl_processed (processed),
  INDEX idx_mwl_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 1809 applied: meta_campaign, meta_lead_raw, meta_webhook_log' AS status;
