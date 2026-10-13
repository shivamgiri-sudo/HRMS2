-- Migration 1976: Tally GST export tables for client billing
-- These four tables are referenced by backend/src/modules/gst/tally-voucher/ but were never
-- added via a migration. All DDL is CREATE TABLE IF NOT EXISTS — idempotent, no existing
-- tables are modified.

CREATE TABLE IF NOT EXISTS tally_export_config (
  config_scope  VARCHAR(100)  NOT NULL,
  config_key    VARCHAR(100)  NOT NULL,
  config_value  VARCHAR(255)  NOT NULL,
  updated_by    CHAR(36)      NOT NULL,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (config_scope, config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  generated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes              VARCHAR(500)   NULL,
  superseded_by_id   CHAR(36)       NULL,
  downloaded_by      CHAR(36)       NULL,
  downloaded_at      DATETIME       NULL,
  created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tvb_gstin_period (company_gstin, period_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
