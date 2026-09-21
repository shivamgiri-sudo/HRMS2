-- Migration 1810: Add walk-in reply tracking columns to meta_lead_raw.
--
-- The Wassenger WhatsApp webhook needs somewhere to record the candidate's
-- reply to the shortlist notification (1 = confirm, 2 = reschedule, 3 = decline).
-- All columns are additive / nullable so existing rows are unaffected.

USE mas_hrms;

ALTER TABLE meta_lead_raw
  ADD COLUMN IF NOT EXISTS walkin_confirmed            TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS walkin_reschedule_requested TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS walkin_declined             TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS walkin_reply                VARCHAR(30) NULL COMMENT 'confirmed | reschedule | not_interested',
  ADD COLUMN IF NOT EXISTS walkin_reply_at             DATETIME    NULL,
  ADD INDEX IF NOT EXISTS idx_ml_walkin (walkin_confirmed);

SELECT 'Migration 1810 applied: walk-in reply columns on meta_lead_raw' AS status;
