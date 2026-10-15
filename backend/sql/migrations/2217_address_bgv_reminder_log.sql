-- 2217_address_bgv_reminder_log.sql
-- Tracks reminder emails for unused address-verification (geo-selfie) links so each link is reminded at most
-- twice (24h and 72h after it was sent). ats_email_log cannot serve: its email_type ENUM has no
-- 'bgv_address_link' value, so those rows are stored blank and cannot be counted per type.
-- Additive: new table only, no ALTER of an existing table.
CREATE TABLE IF NOT EXISTS address_bgv_reminder_log (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  verification_id CHAR(36)     NOT NULL,
  candidate_id    CHAR(36)     NOT NULL,
  reminder_no     TINYINT      NOT NULL,
  outcome         VARCHAR(20)  NOT NULL,
  sent_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_address_bgv_reminder (verification_id, reminder_no),
  KEY idx_address_bgv_reminder_candidate (candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
