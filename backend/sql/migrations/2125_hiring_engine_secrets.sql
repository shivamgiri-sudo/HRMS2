-- 2125: encrypted settings for the Hiring Engine integrations (webhook token, Superbot voice-bot credentials). One row per key; the value is
-- encrypted by the application (utils/encryption.ts) before it is written, so nothing sensitive sits in code, git or plain text. Additive, re-runnable.
CREATE TABLE IF NOT EXISTS he_secret (
  secret_key VARCHAR(60)  NOT NULL PRIMARY KEY,
  value_enc  TEXT         NOT NULL,
  updated_by CHAR(36)     NULL,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
