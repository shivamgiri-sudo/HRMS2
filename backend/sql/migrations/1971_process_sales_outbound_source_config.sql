-- Migration 1971: process_sales_source_config + process_outbound_source_config -- the order/CDR sources of a SALES or OUTBOUND process, so a NEW
-- process of those categories gets a data-driven dashboard (Sales / Outbound tabs of the Process Dashboard) without a code change.
--
-- process_sales_source_config: one row per process. orders_schema/orders_table name a table in db_masmis or mas_hrms; column_map maps canonical
-- order fields (order_id, date, agent_code, amount, status, payment_mode, product, lob, tl_name) onto its columns; status_map classifies the raw
-- status values ({delivered:[..], rto:[..], cancelled:[..], pending:[..]}); prepaid_values lists the payment_mode values that count as prepaid.
-- An optional roster table (+ roster_column_map {agent_code, tl, target}) supplies per-agent monthly targets and the TL of each agent.
-- process_outbound_source_config: one row per process. cdr_schema/cdr_table + column_map (date, agent_code, disposition, duration_sec,
-- talk_time, lead_id, campaign, tl_name, call_time); connected_dispositions lists the dispositions that count as a connect; unique_lead_flag_column
-- optionally names a 0/1 column that marks the first attempt on a lead.
--
-- Nothing stored here is trusted: the read path (process-dashboard/shared) re-validates every name against information_schema and
-- refuses personal-data columns before any SQL is built. ADDITIVE ONLY: two new tables, no seed rows. Idempotent: re-running changes nothing.

-- No foreign key to process_master, deliberately: creating one takes a metadata lock on that very busy table, and on
-- 2026-09-30 that wait timed out at startup (Lock wait timeout exceeded) for migrations 1952 and 1970 and rolled the deploy back.
-- process_id is still uniquely indexed; rows of a deleted process are simply never read.
CREATE TABLE IF NOT EXISTS process_sales_source_config (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  process_id          CHAR(36)     NOT NULL,
  orders_schema       VARCHAR(64)  NOT NULL,
  orders_table        VARCHAR(64)  NOT NULL,
  column_map          JSON         NOT NULL,
  status_map          JSON         NOT NULL,
  prepaid_values      JSON         NOT NULL,
  filter_column       VARCHAR(64)      NULL,
  filter_value        VARCHAR(191)     NULL,
  roster_schema       VARCHAR(64)      NULL,
  roster_table        VARCHAR(64)      NULL,
  roster_column_map   JSON             NULL,
  target_metric       ENUM('net_revenue','gross_revenue','orders') NOT NULL DEFAULT 'net_revenue',
  refresh_seconds     INT          NOT NULL DEFAULT 60,
  enabled             TINYINT(1)   NOT NULL DEFAULT 1,
  configured_by       CHAR(36)         NULL,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pssc_process (process_id),
  KEY idx_pssc_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_outbound_source_config (
  id                        CHAR(36)     NOT NULL DEFAULT (UUID()),
  process_id                CHAR(36)     NOT NULL,
  cdr_schema                VARCHAR(64)  NOT NULL,
  cdr_table                 VARCHAR(64)  NOT NULL,
  column_map                JSON         NOT NULL,
  connected_dispositions    JSON         NOT NULL,
  unique_lead_flag_column   VARCHAR(64)      NULL,
  filter_column             VARCHAR(64)      NULL,
  filter_value              VARCHAR(191)     NULL,
  refresh_seconds           INT          NOT NULL DEFAULT 60,
  enabled                   TINYINT(1)   NOT NULL DEFAULT 1,
  configured_by             CHAR(36)         NULL,
  created_at                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_posc_process (process_id),
  KEY idx_posc_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
