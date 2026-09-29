-- Migration 1910: BLA / BLI / BLU (Bellavita Cart ABC / Inbound / Upgrade) Sales Dashboard storage.
--
-- Storage for the "Received Data" upload and the "Target Inputs" configuration of the
-- BLA_BLI_BLU_Dashboard_Calculation workbook. The "Overall Sales" sheet is NOT stored here:
-- it already lands in bla_bli_blu_overall_sales_raw (sql/1729, Bulk Upload Hub) and the
-- dashboard reads that table directly, so there is one Overall Sales uploader, not two.
-- Only the columns the dashboard formulas read are typed.
-- Additive: new tables only, CREATE TABLE IF NOT EXISTS, targets seeded idempotently.

CREATE TABLE IF NOT EXISTS bla_dash_received (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  upload_batch_id CHAR(36)     NOT NULL,
  report_date     DATE         NOT NULL,
  lob             VARCHAR(64)  NULL,
  data_type       VARCHAR(32)  NULL,
  workable        VARCHAR(32)  NULL,
  call_answer     VARCHAR(48)  NULL,
  same_day_attempt INT         NOT NULL DEFAULT 0,
  final_dispo     VARCHAR(64)  NULL,
  emp_id          VARCHAR(32)  NULL,
  emp_name        VARCHAR(128) NULL,
  phone           VARCHAR(32)  NULL,
  created_by      VARCHAR(36)  NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bla_recv_date_lob (report_date, lob),
  KEY idx_bla_recv_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bla_dash_target (
  lob                 VARCHAR(64)  NOT NULL,
  required_per_day    DECIMAL(10,2) NOT NULL,
  cap_pct             DECIMAL(6,3)  NOT NULL DEFAULT 1.1,
  conversion_target   DECIMAL(6,4)  NOT NULL,
  prepaid_target      DECIMAL(6,4)  NOT NULL DEFAULT 0.85,
  rto_target          DECIMAL(6,4)  NOT NULL DEFAULT 0.05,
  target_aov          DECIMAL(10,2) NOT NULL DEFAULT 600,
  comment             VARCHAR(255) NULL,
  updated_by          VARCHAR(36)  NULL,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (lob)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO bla_dash_target (lob, required_per_day, cap_pct, conversion_target, prepaid_target, rto_target, target_aov, comment)
VALUES
  ('Cart ABC', 833.3333, 1.1, 0.135, 0.85, 0.05, 600, 'Seeded from BLA_BLI_BLU_Dashboard_Calculation Target Inputs'),
  ('Upgrade',  137.5,    1.1, 0.12,  0.85, 0.05, 600, 'Seeded from BLA_BLI_BLU_Dashboard_Calculation Target Inputs')
ON DUPLICATE KEY UPDATE lob = lob;
