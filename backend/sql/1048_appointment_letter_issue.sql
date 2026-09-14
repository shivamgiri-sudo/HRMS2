-- Appointment letter issuance.
--
-- Deliberately a NEW table rather than an extension of appointment_letter_request,
-- which carries two competing schemas laid down by migrations 267 and 299:
-- `status` ENUM and `current_state` VARCHAR both exist, as do
-- `company_signature_status` ENUM and `company_sign_status` VARCHAR, and its
-- createRequest inserts without the NOT NULL employee_id. Building the signed
-- flow on that would inherit the ambiguity into a legal instrument.
--
-- The old table and its routes are left untouched so nothing in flight breaks.

CREATE TABLE IF NOT EXISTS appointment_letter_issue (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,

  -- Human-readable and quotable: MCN-AL-2026-000123. Printed on the letter and
  -- shown by the public verifier.
  letter_number        VARCHAR(40)  NOT NULL,
  letter_seq           INT UNSIGNED NOT NULL,
  letter_year          SMALLINT     NOT NULL,

  employee_id          CHAR(36)     NOT NULL,
  candidate_id         CHAR(36)     NULL,

  -- Snapshot of what was printed. A letter is a point-in-time instrument: if the
  -- employee later changes branch or designation, the issued letter must not
  -- silently re-render differently.
  employee_code        VARCHAR(50)  NULL,
  employee_name        VARCHAR(255) NULL,
  designation          VARCHAR(255) NULL,
  branch_id            CHAR(36)     NULL,
  branch_name          VARCHAR(255) NULL,
  date_of_joining      DATE         NULL,
  salary_source        VARCHAR(60)  NULL,
  salary_snapshot_json JSON         NULL,

  -- Company signature
  certificate_id       CHAR(36)     NULL,
  signed_by_name       VARCHAR(160) NULL,
  signed_by_designation VARCHAR(160) NULL,
  is_ca_issued         TINYINT(1)   NOT NULL DEFAULT 0,
  company_signed_at    DATETIME     NULL,

  -- Employee acceptance (their own Aadhaar eSign)
  employee_esign_status VARCHAR(30) NOT NULL DEFAULT 'not_sent',
  employee_esign_at     DATETIME    NULL,
  esign_transaction_id  CHAR(36)    NULL,

  signed_file_path     TEXT         NULL,
  file_sha256          VARCHAR(64)  NULL,

  -- Public verification. Only the HASH is stored: a leaked table must not yield
  -- working verification links, the same rule the joining-document public tokens
  -- follow.
  verify_token_hash    CHAR(64)     NULL,

  status               VARCHAR(30)  NOT NULL DEFAULT 'issued',
  revoked_at           DATETIME     NULL,
  revoked_by           CHAR(36)     NULL,
  revoke_reason        VARCHAR(255) NULL,

  issued_by            CHAR(36)     NULL,
  issued_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_ali_letter_number (letter_number),
  UNIQUE KEY uq_ali_year_seq (letter_year, letter_seq),
  UNIQUE KEY uq_ali_verify (verify_token_hash),
  INDEX idx_ali_employee (employee_id),
  INDEX idx_ali_status (status),
  CONSTRAINT fk_ali_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointment_letter_issue_audit (
  id           CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  issue_id     CHAR(36)    NULL,
  action       VARCHAR(40) NOT NULL,
  actor_user_id CHAR(36)   NULL,
  detail_json  JSON        NULL,
  acted_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_alia_issue (issue_id),
  INDEX idx_alia_acted (acted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
