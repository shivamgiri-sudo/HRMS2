-- Communication provider configuration per channel.
-- Secrets stored AES-256-GCM encrypted using COMM_SECRET env key (fallback: PAYROLL_BANK_KEY).
-- Only one active config per channel (UNIQUE KEY on channel).
CREATE TABLE IF NOT EXISTS communication_provider_config (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  channel        ENUM('email','sms','whatsapp') NOT NULL,
  provider_type  VARCHAR(50)   NOT NULL,
  -- non-secret settings (plain JSON)
  config_json    JSON          NOT NULL DEFAULT ('{}'),
  -- encrypted secrets (AES-256-GCM base64 blob)
  secret_enc     TEXT          NULL,
  is_enabled     TINYINT(1)    NOT NULL DEFAULT 0,
  -- last test result
  test_ok        TINYINT(1)    NULL,
  test_error     VARCHAR(500)  NULL,
  test_at        DATETIME      NULL,
  tested_by      CHAR(36)      NULL,
  -- audit
  updated_by     CHAR(36)      NULL,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_channel (channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed disabled placeholder rows so GET always returns all 3 channels
INSERT IGNORE INTO communication_provider_config (id, channel, provider_type, is_enabled)
VALUES
  (UUID(), 'email',     'nodemailer', 0),
  (UUID(), 'sms',       'twilio',     0),
  (UUID(), 'whatsapp',  'twilio',     0);
