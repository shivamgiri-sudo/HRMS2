-- 2106: manual bulk voice-call uploads (phone,name,role,interview_date,interview_time,branch_address,reference_id).
-- he_call_batch = one upload; he_call_job = one row/one candidate with its own state machine, retry count and the
-- provider call id, so a batch can be paused/cancelled, retried once (BRD) and audited row by row.
CREATE TABLE IF NOT EXISTS he_call_batch (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  label            VARCHAR(150) NULL,
  created_by       CHAR(36)     NULL,
  consent_attested TINYINT(1)   NOT NULL DEFAULT 0,
  status           ENUM('queued','active','cancelled','done') NOT NULL DEFAULT 'queued',
  total_rows       INT          NOT NULL DEFAULT 0,
  rejected_rows    INT          NOT NULL DEFAULT 0,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_he_cb_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS he_call_job (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  batch_id         CHAR(36)     NOT NULL,
  row_no           INT          NOT NULL,
  mobile10         CHAR(10)     NOT NULL,
  lead_id          CHAR(36)     NULL,
  candidate_name   VARCHAR(150) NOT NULL,
  role             VARCHAR(150) NOT NULL,
  interview_at     DATETIME     NOT NULL,
  branch_address   VARCHAR(400) NOT NULL,
  reference_id     VARCHAR(40)  NOT NULL,
  status           ENUM('queued','placed','completed','skipped','failed','cancelled') NOT NULL DEFAULT 'queued',
  skip_reason      VARCHAR(80)  NULL,
  attempts         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt_at  DATETIME     NULL,
  provider_call_id VARCHAR(120) NULL,
  outcome          VARCHAR(60)  NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_he_cj_batch_mobile (batch_id, mobile10),
  KEY idx_he_cj_dispatch (status, interview_at),
  KEY idx_he_cj_batch (batch_id, status),
  KEY idx_he_cj_provider (provider_call_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
