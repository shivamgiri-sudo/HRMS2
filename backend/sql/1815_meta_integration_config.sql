-- Migration 1815: DB-backed META integration credentials, editable by super_admin in the UI.
--
-- Why this exists: the META credentials were env-only (META_APP_SECRET, META_MARKETING_ACCESS_TOKEN,
-- META_LEAD_VERIFY_TOKEN, app id). That forces a file edit plus a server restart for a value that
-- legitimately changes on a schedule — the Graph API long-lived token expires every ~60 days, so an
-- env-only design guarantees a recurring outage that only a deploy can fix. Moving it to the
-- database lets a super_admin rotate the token in the UI, and the resolver treats DB as an override
-- of env so existing environments keep working untouched.
--
-- Shape follows 071_communication_provider_config.sql deliberately, so there is one convention for
-- integration credentials rather than two:
--   * non-secret values in a JSON column, readable by the settings screen
--   * every secret in ONE AES-256-GCM blob (secret_enc), never a column per secret, so adding a
--     credential later needs no migration
--   * last_test_* columns, because "saved" and "actually works" are different facts and an operator
--     needs to see the second one
--
-- Single row by construction: config_key is UNIQUE with a fixed value. A UNIQUE on a constant is
-- how 071 keeps one active config per channel; the same trick here means the service can UPSERT
-- without first SELECTing, and a race cannot produce two rival credential sets.
--
-- Secrets are NOT readable back through the API. The service returns presence and a last-4 hint
-- only — see meta-config.service.ts. The encryption key is COMM_SECRET (falling back to
-- PAYROLL_BANK_KEY), the same key 071 uses, so an environment that can already decrypt SMTP
-- credentials needs no new key material.

USE mas_hrms;

CREATE TABLE IF NOT EXISTS meta_integration_config (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  config_key     VARCHAR(50)  NOT NULL DEFAULT 'meta_campaign'
                 COMMENT 'Fixed value; UNIQUE below enforces a single credential set',
  config_json    JSON         NULL
                 COMMENT 'Non-secret values: app_id, graph_version, callback_base_url, page_id',
  secret_enc     TEXT         NULL
                 COMMENT 'AES-256-GCM blob (iv|tag|ciphertext, base64) of a JSON object holding app_secret, access_token, verify_token',
  is_enabled     TINYINT(1)   NOT NULL DEFAULT 0
                 COMMENT 'Master switch. 0 makes the resolver ignore this row entirely and fall back to env',
  last_test_ok   TINYINT(1)   NULL,
  last_test_error TEXT        NULL,
  last_test_at   DATETIME     NULL,
  token_expires_at DATETIME   NULL
                 COMMENT 'From Graph debug_token, so the UI can warn before a 60-day token dies',
  updated_by     CHAR(36)     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_meta_config_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settings page. super_admin ONLY, per owner instruction, and narrower than every other page this
-- feature added: this screen holds the App Secret and the ads access token, which together can read
-- lead PII and ad spend for the whole business account. Note role_page_access is a coarse filter and
-- not the security boundary — the routes themselves also require super_admin.
INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
VALUES (UUID(), 'META_INTEGRATION_SETTINGS', 'META Integration Settings', '/admin/meta-integration', 'Administration',
        'Configure META app credentials, webhook secrets and the Graph API access token for Lead Gen automation', 1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = 1;

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin', 'META_INTEGRATION_SETTINGS', 1, 1, 1, 1, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = 1;

SELECT 'Migration 1815 applied: meta_integration_config + META_INTEGRATION_SETTINGS (super_admin only)' AS status;
