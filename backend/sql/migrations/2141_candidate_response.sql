-- 2141: Candidate response ledger. One append-only row per inbound event (a tap, a message, a call result, an import row, an HR action)
-- from every channel, idempotent on (source_kind, source_ref) so provider retries and re-imports never add a second row. Context
-- (requisition, drive, slot, campaign, drive type) is resolved once at write time and stored. inbound_email_cursor holds the IMAP
-- position for the optional reply poller. Additive, re-runnable, no foreign keys.
CREATE TABLE IF NOT EXISTS candidate_response (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  occurred_at DATETIME NOT NULL,
  channel VARCHAR(10) NOT NULL,
  mode VARCHAR(8) NOT NULL,
  answer VARCHAR(14) NOT NULL,
  suggested_answer VARCHAR(14) NULL,
  confidence DECIMAL(4,3) NULL,
  status VARCHAR(12) NOT NULL,
  mobile10 CHAR(10) NOT NULL,
  lead_id CHAR(36) NULL,
  meta_lead_id CHAR(36) NULL,
  match_id CHAR(36) NULL,
  invite_id CHAR(36) NULL,
  followup_id CHAR(36) NULL,
  requisition_id CHAR(36) NULL,
  campaign_id CHAR(36) NULL,
  drive_id CHAR(36) NULL,
  drive_type VARCHAR(10) NULL,
  slot_at DATETIME NULL,
  branch_name VARCHAR(255) NULL,
  source_kind VARCHAR(16) NOT NULL,
  source_ref VARCHAR(120) NOT NULL,
  raw_text VARCHAR(1000) NULL,
  handled_by VARCHAR(60) NOT NULL DEFAULT 'system',
  handled_at DATETIME NULL,
  dedupe_of BIGINT UNSIGNED NULL,
  conflict TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cr_source (source_kind, source_ref),
  KEY idx_cr_time (occurred_at),
  KEY idx_cr_person (mobile10, occurred_at),
  KEY idx_cr_match (match_id),
  KEY idx_cr_req_time (requisition_id, occurred_at),
  KEY idx_cr_status (status, occurred_at),
  KEY idx_cr_drive (drive_id, answer)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inbound_email_cursor (
  mailbox VARCHAR(190) NOT NULL PRIMARY KEY,
  uid_validity BIGINT UNSIGNED NULL,
  last_uid BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
