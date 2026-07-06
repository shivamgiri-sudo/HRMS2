-- Migration 342: Create db_masmis upload tables
-- Additive only. Uses explicit db_masmis qualifier so it runs on the same MySQL server
-- as mas_hrms without altering the mas_hrms schema.
-- Run ONLY after explicit user approval. DO NOT execute against production without sign-off.

CREATE DATABASE IF NOT EXISTS db_masmis CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── upload_log ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.upload_log (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  batch_id     VARCHAR(64)  NOT NULL,
  table_name   VARCHAR(64)  NOT NULL,
  file_name    VARCHAR(255) NOT NULL,
  row_count    INT          NOT NULL DEFAULT 0,
  uploaded_by  VARCHAR(64)  NOT NULL,
  uploaded_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_batch_id   (batch_id),
  INDEX idx_table_name (table_name),
  INDEX idx_uploaded_at(uploaded_at)
) ENGINE=InnoDB;

-- ── bb_sale (Bellavita sales) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.bb_sale (
  id                      INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id         VARCHAR(64)  NOT NULL,
  week                    VARCHAR(50),
  sale_date               DATETIME,
  emp_id                  VARCHAR(50),
  emp_name                VARCHAR(200),
  tl                      VARCHAR(200),
  t1                      VARCHAR(200),
  t2                      VARCHAR(200),
  fhd                     VARCHAR(200),
  days                    INT,
  phone_number            VARCHAR(30),
  email_id                VARCHAR(200),
  payment_status          VARCHAR(100),
  amount                  DECIMAL(12,2),
  order_id                VARCHAR(100),
  campaign                VARCHAR(200),
  calling_status          VARCHAR(100),
  discount_code           VARCHAR(100),
  count_val               INT,
  current_status          VARCHAR(100),
  final_status            VARCHAR(100),
  order_datetime          DATETIME,
  state                   VARCHAR(100),
  line_item_name          VARCHAR(500),
  pincode                 VARCHAR(20),
  order_date              DATETIME,
  hrs_24_48               VARCHAR(20),
  crazy_deal              VARCHAR(50),
  perfume                 VARCHAR(200),
  size                    VARCHAR(100),
  order_pickup_datetime   DATETIME,
  rto_initiated_datetime  DATETIME,
  diff_hour               DECIMAL(8,2),
  lob                     VARCHAR(100),
  pincode_relevent        VARCHAR(100),
  rto_status              VARCHAR(100),
  draft_order             VARCHAR(100),
  time_1608               VARCHAR(100),
  sale_source_name        VARCHAR(200),
  shift                   VARCHAR(50),
  uploaded_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_upload_batch_id (upload_batch_id),
  INDEX idx_emp_id          (emp_id),
  INDEX idx_order_id        (order_id),
  INDEX idx_sale_date       (sale_date),
  INDEX idx_campaign        (campaign)
) ENGINE=InnoDB;

-- ── gnc_sale (GNC sales) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.gnc_sale (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id  VARCHAR(64)  NOT NULL,
  sale_date        DATETIME,
  order_id         VARCHAR(100),
  gnc_order_id     VARCHAR(100),
  emp_id           VARCHAR(50),
  emp_name         VARCHAR(200),
  tl               VARCHAR(200),
  campaign         VARCHAR(200),
  calling_status   VARCHAR(100),
  payment_status   VARCHAR(100),
  amount           DECIMAL(12,2),
  state            VARCHAR(100),
  lob              VARCHAR(100),
  product_name     VARCHAR(500),
  discount_code    VARCHAR(100),
  order_datetime   DATETIME,
  final_status     VARCHAR(100),
  pincode          VARCHAR(20),
  shift            VARCHAR(50),
  week             VARCHAR(50),
  uploaded_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_upload_batch_id (upload_batch_id),
  INDEX idx_gnc_order_id    (gnc_order_id),
  INDEX idx_sale_date       (sale_date),
  INDEX idx_emp_id          (emp_id)
) ENGINE=InnoDB;

-- ── gnc_apr (GNC attendance + performance report) ─────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.gnc_apr (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id  VARCHAR(64)  NOT NULL,
  report_date      DATETIME,
  emp_id           VARCHAR(50),
  emp_name         VARCHAR(200),
  tl               VARCHAR(200),
  login_time       VARCHAR(20),
  logout_time      VARCHAR(20),
  acht             DECIMAL(8,2),
  atten            VARCHAR(50),
  break_time       VARCHAR(20),
  calls_handled    INT,
  lob              VARCHAR(100),
  campaign         VARCHAR(200),
  shift            VARCHAR(50),
  uploaded_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_upload_batch_id (upload_batch_id),
  INDEX idx_emp_id          (emp_id),
  INDEX idx_report_date     (report_date)
) ENGINE=InnoDB;

-- ── gnc_allocation ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.gnc_allocation (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id  VARCHAR(64)  NOT NULL,
  alloc_date       DATETIME,
  emp_id           VARCHAR(50),
  emp_name         VARCHAR(200),
  tl               VARCHAR(200),
  phone_number     VARCHAR(30),
  calling_status   VARCHAR(100),
  sub_scenarios1   VARCHAR(200),
  sub_scenarios2   VARCHAR(200),
  campaign         VARCHAR(200),
  lob              VARCHAR(100),
  state            VARCHAR(100),
  pincode          VARCHAR(20),
  shift            VARCHAR(50),
  uploaded_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_upload_batch_id (upload_batch_id),
  INDEX idx_alloc_date      (alloc_date)
) ENGINE=InnoDB;

-- ── bb_apr (Bellavita APR) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.bb_apr (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id  VARCHAR(64)  NOT NULL,
  report_date      DATETIME,
  emp_id           VARCHAR(50),
  emp_name         VARCHAR(200),
  tl               VARCHAR(200),
  fhd_s            VARCHAR(200),
  login_time       VARCHAR(20),
  logout_time      VARCHAR(20),
  acht             DECIMAL(8,2),
  atten            VARCHAR(50),
  break_time       VARCHAR(20),
  calls_handled    INT,
  lob              VARCHAR(100),
  campaign         VARCHAR(200),
  tenurity_week    VARCHAR(50),
  sub_lob          VARCHAR(100),
  shift            VARCHAR(50),
  uploaded_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_upload_batch_id (upload_batch_id),
  INDEX idx_emp_id          (emp_id),
  INDEX idx_report_date     (report_date)
) ENGINE=InnoDB;

-- ── bb_chat (Bellavita chat tickets) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.bb_chat (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id  VARCHAR(64)  NOT NULL,
  ticket_id        VARCHAR(100),
  created_at       DATETIME,
  emp_id           VARCHAR(50),
  emp_name         VARCHAR(200),
  tl               VARCHAR(200),
  campaign         VARCHAR(200),
  lob              VARCHAR(100),
  frt_1            DECIMAL(10,2),
  resolution_tat   DECIMAL(10,2),
  csat             DECIMAL(5,2),
  status           VARCHAR(100),
  category         VARCHAR(200),
  sub_category     VARCHAR(200),
  shift            VARCHAR(50),
  uploaded_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_upload_batch_id (upload_batch_id),
  INDEX idx_ticket_id       (ticket_id),
  INDEX idx_created_at      (created_at)
) ENGINE=InnoDB;

-- ── bb_cart (Bellavita abandoned cart) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_masmis.bb_cart (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  upload_batch_id      VARCHAR(64)  NOT NULL,
  cart_id              VARCHAR(100),
  abandoned_cart_link  TEXT,
  emp_id               VARCHAR(50),
  emp_name             VARCHAR(200),
  tl                   VARCHAR(200),
  campaign             VARCHAR(200),
  lob                  VARCHAR(100),
  same_day_connect     VARCHAR(50),
  status               VARCHAR(100),
  amount               DECIMAL(12,2),
  shift                VARCHAR(50),
  uploaded_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_upload_batch_id (upload_batch_id),
  INDEX idx_cart_id         (cart_id),
  INDEX idx_uploaded_at     (uploaded_at)
) ENGINE=InnoDB;
