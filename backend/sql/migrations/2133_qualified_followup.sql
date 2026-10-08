-- 2133: Qualified follow-up. One row per (mobile, requisition) person who qualified, carrying the email / WhatsApp / call
-- schedule and its outcomes; plus the call-batch table for the daily call file. Additive and re-runnable
-- (CREATE TABLE IF NOT EXISTS only, no foreign keys).
CREATE TABLE IF NOT EXISTS qualified_followup (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  source_type        ENUM('meta_live','meta_old','he') NOT NULL,
  meta_lead_id       CHAR(36)     NULL,
  he_lead_id         CHAR(36)     NULL,
  ats_candidate_id   CHAR(36)     NULL,
  requisition_id     CHAR(36)     NOT NULL,
  campaign_id        CHAR(36)     NULL,
  drive_id           CHAR(36)     NULL,
  origin_id          VARCHAR(64)  NOT NULL,
  origin_label       VARCHAR(200) NOT NULL,
  also_in_sources    JSON         NULL,
  mobile10           CHAR(10)     NOT NULL,
  email              VARCHAR(255) NULL,
  full_name          VARCHAR(200) NULL,
  branch_name        VARCHAR(150) NULL,
  role_name          VARCHAR(150) NULL,
  qualified_at       DATETIME     NOT NULL,
  email_due_at       DATETIME     NULL,
  email_sent_at      DATETIME     NULL,
  email_status       VARCHAR(30)  NULL,
  wa_due_at          DATETIME     NULL,
  wa_sent_at         DATETIME     NULL,
  wa_template_key    VARCHAR(60)  NULL,
  wa_status          VARCHAR(30)  NULL,
  wa_error           VARCHAR(255) NULL,
  call_due_at        DATETIME     NULL,
  call_state         ENUM('pending','in_file','queued','called','skipped') NOT NULL DEFAULT 'pending',
  call_file_batch_id CHAR(36)     NULL,
  called_at          DATETIME     NULL,
  stopped_reason     VARCHAR(40)  NULL,
  stopped_at         DATETIME     NULL,
  mode_at_enqueue    ENUM('dry_run','live') NOT NULL,
  created_at         DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_qfu_person_req (mobile10, requisition_id),
  KEY idx_qfu_due (stopped_reason, wa_due_at),
  KEY idx_qfu_req_source (requisition_id, source_type),
  KEY idx_qfu_meta (meta_lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qualified_followup_call_batch (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
  row_count  INT          NOT NULL DEFAULT 0,
  sent_to    VARCHAR(255) NULL,
  status     VARCHAR(20)  NOT NULL DEFAULT 'pending',
  error      VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
