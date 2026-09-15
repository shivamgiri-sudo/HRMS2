-- Migration 1769: GS1 India Dashboard Tables
-- Registered 2026-09-15
-- Creates gs1_email_daily_actual, gs1_datakart_daily_actual, gs1_approval_audit_raw
-- and registers upload templates for GS1 India LOBs.

CREATE TABLE IF NOT EXISTS gs1_email_daily_actual (
  id                VARCHAR(36)      NOT NULL,
  process_id        VARCHAR(36)      DEFAULT NULL,
  upload_batch_id   VARCHAR(36)      DEFAULT NULL,
  report_date       DATE             NOT NULL,
  analyst_name      VARCHAR(200)     DEFAULT NULL,
  executive_id      VARCHAR(100)     DEFAULT NULL,
  mail_date         DATE             DEFAULT NULL,
  mail_received     INT              DEFAULT 0,
  gtin_processed    INT              DEFAULT 0,
  image_count       INT              DEFAULT 0,
  sla_within_15min  TINYINT          DEFAULT 0,
  data_type         VARCHAR(100)     DEFAULT NULL,
  tat_minutes       DECIMAL(8,2)     DEFAULT NULL,
  data_source       VARCHAR(50)      DEFAULT NULL,
  source_reference  VARCHAR(36)      DEFAULT NULL,
  created_by        VARCHAR(36)      DEFAULT NULL,
  created_at        DATETIME         DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gs1_email_daily (process_id, report_date, analyst_name, mail_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gs1_datakart_daily_actual (
  id                VARCHAR(36)      NOT NULL,
  process_id        VARCHAR(36)      DEFAULT NULL,
  upload_batch_id   VARCHAR(36)      DEFAULT NULL,
  report_date       DATE             NOT NULL,
  analyst_name      VARCHAR(200)     DEFAULT NULL,
  task_date         DATE             DEFAULT NULL,
  task_count        INT              DEFAULT 0,
  gtin_count        INT              DEFAULT 0,
  within_tat        TINYINT          DEFAULT 0,
  tat_minutes       DECIMAL(8,2)     DEFAULT NULL,
  process_type      VARCHAR(100)     DEFAULT NULL,
  data_source       VARCHAR(50)      DEFAULT NULL,
  source_reference  VARCHAR(36)      DEFAULT NULL,
  created_by        VARCHAR(36)      DEFAULT NULL,
  created_at        DATETIME         DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gs1_datakart_daily (process_id, report_date, analyst_name, task_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gs1_approval_audit_raw (
  id                VARCHAR(36)      NOT NULL,
  process_id        VARCHAR(36)      DEFAULT NULL,
  upload_batch_id   VARCHAR(36)      DEFAULT NULL,
  audit_date        DATE             NOT NULL,
  auditee_name      VARCHAR(200)     DEFAULT NULL,
  auditor_name      VARCHAR(200)     DEFAULT NULL,
  audit_result      VARCHAR(50)      DEFAULT NULL,
  error_category    VARCHAR(200)     DEFAULT NULL,
  error_flag        TINYINT          DEFAULT 0,
  gcp_code          VARCHAR(200)     DEFAULT NULL,
  company_name      VARCHAR(200)     DEFAULT NULL,
  sku_count         INT              DEFAULT 0,
  data_source       VARCHAR(50)      DEFAULT NULL,
  source_reference  VARCHAR(36)      DEFAULT NULL,
  created_by        VARCHAR(36)      DEFAULT NULL,
  created_at        DATETIME         DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO upload_template_master (template_code, template_name, is_active)
VALUES
  ('GS1_EMAIL_DAILY',    'GS1 India — Email LOB (Daily)',   1),
  ('GS1_DATAKART_DAILY', 'GS1 India — Data Kart LOB (Daily)', 1),
  ('GS1_APPROVAL_AUDIT', 'GS1 India — Approval Audit',      1)
ON DUPLICATE KEY UPDATE
  template_name = VALUES(template_name),
  is_active     = VALUES(is_active);
