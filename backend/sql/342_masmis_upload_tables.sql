-- ============================================================
-- Migration 342: db_masmis upload tables
-- REQUIRES EXPLICIT USER APPROVAL BEFORE RUNNING ON PRODUCTION
-- All CREATE TABLE IF NOT EXISTS — fully additive, safe to re-run
-- ============================================================

CREATE DATABASE IF NOT EXISTS db_masmis
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

-- ── Upload audit log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.upload_log (
  id             INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  batch_id       VARCHAR(36)    NOT NULL UNIQUE,
  upload_type    VARCHAR(50)    NOT NULL,
  month_label    VARCHAR(7)     NOT NULL,
  row_count      INT            NOT NULL DEFAULT 0,
  uploaded_by    VARCHAR(120)   NOT NULL,
  created_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_upload_log_type (upload_type),
  INDEX idx_upload_log_month (month_label)
) ENGINE=InnoDB;

-- ── Bellavita Sales ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.bb_sale (
  id               INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id  VARCHAR(36)    NOT NULL,
  order_id         VARCHAR(80)    NOT NULL DEFAULT '',
  order_date       DATE               NULL,
  campaign         VARCHAR(120)   NOT NULL DEFAULT '',
  product          VARCHAR(200)   NOT NULL DEFAULT '',
  sku              VARCHAR(80)    NOT NULL DEFAULT '',
  qty              DECIMAL(10,2)  NOT NULL DEFAULT 0,
  mrp              DECIMAL(12,2)  NOT NULL DEFAULT 0,
  selling_price    DECIMAL(12,2)  NOT NULL DEFAULT 0,
  discount         DECIMAL(12,2)  NOT NULL DEFAULT 0,
  tax_pct          DECIMAL(6,2)   NOT NULL DEFAULT 0,
  gross_revenue    DECIMAL(14,2)  NOT NULL DEFAULT 0,
  net_revenue      DECIMAL(14,2)  NOT NULL DEFAULT 0,
  gst_amount       DECIMAL(12,2)  NOT NULL DEFAULT 0,
  payment_mode     VARCHAR(30)    NOT NULL DEFAULT '',
  order_status     VARCHAR(30)    NOT NULL DEFAULT '',
  courier          VARCHAR(60)    NOT NULL DEFAULT '',
  awb_no           VARCHAR(80)    NOT NULL DEFAULT '',
  city             VARCHAR(80)    NOT NULL DEFAULT '',
  state            VARCHAR(80)    NOT NULL DEFAULT '',
  pincode          VARCHAR(10)    NOT NULL DEFAULT '',
  agent_id         VARCHAR(30)    NOT NULL DEFAULT '',
  agent_name       VARCHAR(120)   NOT NULL DEFAULT '',
  source           VARCHAR(60)    NOT NULL DEFAULT '',
  remarks          TEXT               NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bb_sale_batch   (upload_batch_id),
  INDEX idx_bb_sale_date    (order_date),
  INDEX idx_bb_sale_campaign(campaign),
  INDEX idx_bb_sale_status  (order_status)
) ENGINE=InnoDB;

-- ── GNC Sales ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.gnc_sale (
  id               INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id  VARCHAR(36)    NOT NULL,
  sale_date        DATE               NULL,
  order_id         VARCHAR(80)    NOT NULL DEFAULT '',
  product          VARCHAR(200)   NOT NULL DEFAULT '',
  sku              VARCHAR(80)    NOT NULL DEFAULT '',
  qty              DECIMAL(10,2)  NOT NULL DEFAULT 0,
  unit_price       DECIMAL(12,2)  NOT NULL DEFAULT 0,
  total_revenue    DECIMAL(14,2)  NOT NULL DEFAULT 0,
  discount         DECIMAL(12,2)  NOT NULL DEFAULT 0,
  payment_mode     VARCHAR(30)    NOT NULL DEFAULT '',
  status           VARCHAR(30)    NOT NULL DEFAULT '',
  agent_id         VARCHAR(30)    NOT NULL DEFAULT '',
  agent_name       VARCHAR(120)   NOT NULL DEFAULT '',
  campaign         VARCHAR(120)   NOT NULL DEFAULT '',
  city             VARCHAR(80)    NOT NULL DEFAULT '',
  state            VARCHAR(80)    NOT NULL DEFAULT '',
  remarks          TEXT               NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gnc_sale_batch (upload_batch_id),
  INDEX idx_gnc_sale_date  (sale_date)
) ENGINE=InnoDB;

-- ── GNC APR ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.gnc_apr (
  id               INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id  VARCHAR(36)    NOT NULL,
  call_date        DATE               NULL,
  agent_id         VARCHAR(30)    NOT NULL DEFAULT '',
  agent_name       VARCHAR(120)   NOT NULL DEFAULT '',
  calls_handled    INT            NOT NULL DEFAULT 0,
  sales_attempts   INT            NOT NULL DEFAULT 0,
  sales_closed     INT            NOT NULL DEFAULT 0,
  conversion_pct   DECIMAL(6,2)   NOT NULL DEFAULT 0,
  avg_handle_time  DECIMAL(8,2)   NOT NULL DEFAULT 0,
  quality_score    DECIMAL(6,2)   NOT NULL DEFAULT 0,
  remarks          TEXT               NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gnc_apr_batch (upload_batch_id),
  INDEX idx_gnc_apr_date  (call_date)
) ENGINE=InnoDB;

-- ── GNC Allocation ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.gnc_allocation (
  id               INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id  VARCHAR(36)    NOT NULL,
  month_label      VARCHAR(7)     NOT NULL DEFAULT '',
  agent_id         VARCHAR(30)    NOT NULL DEFAULT '',
  agent_name       VARCHAR(120)   NOT NULL DEFAULT '',
  allocated_leads  INT            NOT NULL DEFAULT 0,
  contacted        INT            NOT NULL DEFAULT 0,
  not_contacted    INT            NOT NULL DEFAULT 0,
  dnd              INT            NOT NULL DEFAULT 0,
  invalid          INT            NOT NULL DEFAULT 0,
  remarks          TEXT               NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gnc_alloc_batch (upload_batch_id),
  INDEX idx_gnc_alloc_month (month_label)
) ENGINE=InnoDB;

-- ── Bellavita APR ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.bb_apr (
  id               INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id  VARCHAR(36)    NOT NULL,
  call_date        DATE               NULL,
  agent_id         VARCHAR(30)    NOT NULL DEFAULT '',
  agent_name       VARCHAR(120)   NOT NULL DEFAULT '',
  campaign         VARCHAR(120)   NOT NULL DEFAULT '',
  total_calls      INT            NOT NULL DEFAULT 0,
  sales_calls      INT            NOT NULL DEFAULT 0,
  sales_closed     INT            NOT NULL DEFAULT 0,
  conversion_pct   DECIMAL(6,2)   NOT NULL DEFAULT 0,
  cod_orders       INT            NOT NULL DEFAULT 0,
  prepaid_orders   INT            NOT NULL DEFAULT 0,
  rto_orders       INT            NOT NULL DEFAULT 0,
  avg_handle_time  DECIMAL(8,2)   NOT NULL DEFAULT 0,
  quality_score    DECIMAL(6,2)   NOT NULL DEFAULT 0,
  remarks          TEXT               NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bb_apr_batch    (upload_batch_id),
  INDEX idx_bb_apr_date     (call_date),
  INDEX idx_bb_apr_campaign (campaign)
) ENGINE=InnoDB;

-- ── Bellavita Chat ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.bb_chat (
  id                  INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id     VARCHAR(36)    NOT NULL,
  month_label         VARCHAR(7)     NOT NULL DEFAULT '',
  chat_datetime       DATETIME           NULL,
  agent_id            VARCHAR(30)    NOT NULL DEFAULT '',
  agent_name          VARCHAR(120)   NOT NULL DEFAULT '',
  customer_id         VARCHAR(80)    NOT NULL DEFAULT '',
  platform            VARCHAR(40)    NOT NULL DEFAULT '',
  issue_type          VARCHAR(100)   NOT NULL DEFAULT '',
  resolution          VARCHAR(60)    NOT NULL DEFAULT '',
  csat_score          DECIMAL(4,2)   NOT NULL DEFAULT 0,
  first_response_sec  INT            NOT NULL DEFAULT 0,
  handle_time_sec     INT            NOT NULL DEFAULT 0,
  remarks             TEXT               NULL,
  created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bb_chat_batch   (upload_batch_id),
  INDEX idx_bb_chat_month   (month_label),
  INDEX idx_bb_chat_agent   (agent_id)
) ENGINE=InnoDB;

-- ── Bellavita Cart Abandonment ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.bb_cart (
  id               INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id  VARCHAR(36)    NOT NULL,
  month_label      VARCHAR(7)     NOT NULL DEFAULT '',
  cart_date        DATE               NULL,
  order_id         VARCHAR(80)    NOT NULL DEFAULT '',
  customer_id      VARCHAR(80)    NOT NULL DEFAULT '',
  product          VARCHAR(200)   NOT NULL DEFAULT '',
  cart_value       DECIMAL(12,2)  NOT NULL DEFAULT 0,
  recovered        TINYINT(1)     NOT NULL DEFAULT 0,
  recovery_date    DATE               NULL,
  agent_id         VARCHAR(30)    NOT NULL DEFAULT '',
  remarks          TEXT               NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bb_cart_batch   (upload_batch_id),
  INDEX idx_bb_cart_month   (month_label),
  INDEX idx_bb_cart_date    (cart_date)
) ENGINE=InnoDB;
