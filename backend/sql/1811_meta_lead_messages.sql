-- Migration 1811: WhatsApp conversation thread storage for META campaign leads.
--
-- Every outbound (system/HR) and inbound (candidate) WhatsApp message is persisted
-- here so Branch HR can see the full conversation and reply from inside HRMS.
--
-- read_at is per-message rather than per-thread so we can count unread
-- messages accurately and mark read per-message when HR views the thread.
--
-- sender_type = 'system'    — automated shortlist notification
-- sender_type = 'hr'        — Branch HR replied from HRMS inbox
-- sender_type = 'candidate' — inbound from candidate via Wassenger webhook

USE mas_hrms;

CREATE TABLE IF NOT EXISTS meta_lead_messages (
  id                   CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  lead_id              CHAR(36)      NOT NULL,
  direction            ENUM('inbound','outbound') NOT NULL,
  message_text         TEXT          NOT NULL,
  sender_type          ENUM('system','hr','candidate') NOT NULL DEFAULT 'system',
  sender_id            CHAR(36)      NULL COMMENT 'auth_user.id when sender_type = hr',
  sender_name          VARCHAR(255)  NULL,
  wassenger_message_id VARCHAR(100)  NULL,
  read_at              DATETIME      NULL COMMENT 'When Branch HR viewed this inbound message',
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mlmsg_lead    (lead_id),
  INDEX idx_mlmsg_created (created_at),
  INDEX idx_mlmsg_unread  (lead_id, direction, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 1811 applied: meta_lead_messages table' AS status;
