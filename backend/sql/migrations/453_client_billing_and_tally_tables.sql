-- Migration 453: create missing tables for client-billing workflows and Tally GST export
-- These tables are already referenced in service code but were never migrated.
-- All DDL is additive; no existing tables are modified.

-- ── Client invoice change-request (void / status-change approval flow) ────────
CREATE TABLE IF NOT EXISTS client_invoice_change_request (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  invoice_id       CHAR(36)      NOT NULL,
  request_type     VARCHAR(50)   NOT NULL,
  current_value    VARCHAR(255)  NULL,
  requested_value  VARCHAR(255)  NULL,
  reason           TEXT          NULL,
  request_status   VARCHAR(30)   NOT NULL DEFAULT 'pending',
  requested_by     CHAR(36)      NOT NULL,
  reviewed_by      CHAR(36)      NULL,
  reviewed_at      DATETIME      NULL,
  review_note      TEXT          NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cicr_invoice (invoice_id),
  INDEX idx_cicr_status  (request_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Client invoice submission log (email send history) ───────────────────────
CREATE TABLE IF NOT EXISTS client_invoice_submission (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  invoice_id      CHAR(36)      NOT NULL,
  to_emails       TEXT          NOT NULL,
  cc_emails       TEXT          NULL,
  subject         VARCHAR(500)  NOT NULL,
  with_letterhead TINYINT(1)    NOT NULL DEFAULT 0,
  send_status     VARCHAR(20)   NOT NULL DEFAULT 'sent',
  message_id      VARCHAR(255)  NULL,
  error_message   VARCHAR(500)  NULL,
  sent_by         CHAR(36)      NOT NULL,
  sent_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cis_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Tally export configuration (per company-GSTIN ledger/head mappings) ───────
CREATE TABLE IF NOT EXISTS tally_export_config (
  config_scope  VARCHAR(100)  NOT NULL,
  config_key    VARCHAR(100)  NOT NULL,
  config_value  VARCHAR(255)  NOT NULL,
  updated_by    CHAR(36)      NOT NULL,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (config_scope, config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Tally voucher batch (one per export run / GSTIN / period) ────────────────
CREATE TABLE IF NOT EXISTS tally_voucher_batch (
  id                 CHAR(36)       NOT NULL PRIMARY KEY,
  company_gstin      VARCHAR(20)    NOT NULL,
  period_month       CHAR(7)        NOT NULL,
  voucher_kinds      VARCHAR(255)   NOT NULL,
  company_name       VARCHAR(255)   NULL,
  status             VARCHAR(30)    NOT NULL DEFAULT 'draft',
  total_vouchers     INT            NOT NULL DEFAULT 0,
  clean_vouchers     INT            NOT NULL DEFAULT 0,
  exception_vouchers INT            NOT NULL DEFAULT 0,
  total_debit        DECIMAL(18,2)  NOT NULL DEFAULT 0,
  total_credit       DECIMAL(18,2)  NOT NULL DEFAULT 0,
  generated_by       CHAR(36)       NOT NULL,
  notes              VARCHAR(500)   NULL,
  superseded_by_id   CHAR(36)       NULL,
  downloaded_by      CHAR(36)       NULL,
  downloaded_at      DATETIME       NULL,
  created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tvb_gstin_period (company_gstin, period_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Tally voucher batch line (one row per source document in the batch) ───────
CREATE TABLE IF NOT EXISTS tally_voucher_batch_line (
  id                 BIGINT         NOT NULL AUTO_INCREMENT PRIMARY KEY,
  batch_id           CHAR(36)       NOT NULL,
  source_type        VARCHAR(50)    NOT NULL,
  source_id          CHAR(36)       NOT NULL,
  sequence_no        INT            NOT NULL,
  voucher_kind       VARCHAR(50)    NOT NULL,
  voucher_number     VARCHAR(100)   NULL,
  voucher_date       DATE           NULL,
  party_ledger       VARCHAR(255)   NULL,
  amount             DECIMAL(18,2)  NULL,
  guid               VARCHAR(255)   NULL,
  content_hash       VARCHAR(64)    NULL,
  validation_status  VARCHAR(20)    NOT NULL DEFAULT 'valid',
  validation_errors  JSON           NULL,
  model_json         JSON           NULL,
  created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tvbl_batch   (batch_id),
  INDEX idx_tvbl_source  (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Tally voucher export tracking (dedup + re-export safety) ─────────────────
CREATE TABLE IF NOT EXISTS tally_voucher_export (
  source_type        VARCHAR(50)   NOT NULL,
  source_id          CHAR(36)      NOT NULL,
  guid               VARCHAR(255)  NULL,
  voucher_number     VARCHAR(100)  NULL,
  content_hash       VARCHAR(64)   NULL,
  first_exported_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_exported_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  export_count       INT           NOT NULL DEFAULT 1,
  last_batch_id      CHAR(36)      NULL,
  PRIMARY KEY (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
