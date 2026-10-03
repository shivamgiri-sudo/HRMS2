-- Migration 2075: SBI Card Collections -- account-file collections-ops columns + agent time (APR) table
-- Purpose: the account-level dialer export carries the account class / product / block flags, the do-not-call flag, the callback
-- date and up to six call attempts (time, disposition code, dialer agent id). Storing them lets the dashboard and KPI page report
-- coverage, untouched accounts, attempts per account, disposition mix, PTP / callback pipeline and hour-of-day yield.
-- Phone numbers (CALLn_PHONE, additional / employer / residence) and the customer name stay out on purpose.
-- Additive and idempotent: nullable columns only, each behind an information_schema guard; sbi_card_account_file is a small table.

-- Dialer "Agent Time Detail" (APR) export: one row per agent per day, durations in whole seconds. The export's % columns are
-- derived, not stored. Pause-code columns keep the dialer's own codes (LB, TB, WB, MB, QB, LOGIN).
CREATE TABLE IF NOT EXISTS sbi_card_agent_time (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  employee_id VARCHAR(30) NOT NULL,
  agent_name VARCHAR(150) NULL,
  calls INT NULL,
  time_clock_sec INT NULL,
  login_sec INT NULL,
  wait_sec INT NULL,
  talk_sec INT NULL,
  dispo_sec INT NULL,
  pause_sec INT NULL,
  dead_sec INT NULL,
  customer_sec INT NULL,
  first_login_time TIME NULL,
  last_logout_time TIME NULL,
  acht_sec INT NULL,
  dismx_sec INT NULL,
  lagged_sec INT NULL,
  pause_lb_sec INT NULL,
  pause_login_sec INT NULL,
  pause_mb_sec INT NULL,
  pause_qb_sec INT NULL,
  pause_tb_sec INT NULL,
  pause_wb_sec INT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(100) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sbi_card_agent_time (process_id, report_date, employee_id),
  KEY idx_sbi_card_agent_time_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

DROP PROCEDURE IF EXISTS _m2075_sbi_account_file_ops $$
CREATE PROCEDURE _m2075_sbi_account_file_ops()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'cd') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN cd TINYINT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'nrr') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN nrr VARCHAR(5) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'block_1') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN block_1 VARCHAR(10) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'block_2') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN block_2 VARCHAR(10) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'ntc_flag') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN ntc_flag VARCHAR(5) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'new_to_card_flag') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN new_to_card_flag VARCHAR(5) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'promo_code') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN promo_code VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'product_class') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN product_class VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'account_class') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN account_class VARCHAR(30) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'donotcall') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN donotcall VARCHAR(5) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'callback_dt') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN callback_dt DATETIME NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'call1_dt') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN call1_dt DATETIME NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'disp1_c') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN disp1_c VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'agent1_id') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN agent1_id VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'call2_dt') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN call2_dt DATETIME NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'disp2_c') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN disp2_c VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'agent2_id') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN agent2_id VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'call3_dt') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN call3_dt DATETIME NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'disp3_c') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN disp3_c VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'agent3_id') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN agent3_id VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'call4_dt') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN call4_dt DATETIME NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'disp4_c') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN disp4_c VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'agent4_id') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN agent4_id VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'call5_dt') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN call5_dt DATETIME NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'disp5_c') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN disp5_c VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'agent5_id') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN agent5_id VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'call6_dt') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN call6_dt DATETIME NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'disp6_c') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN disp6_c VARCHAR(20) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'agent6_id') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN agent6_id VARCHAR(20) NULL;
  END IF;
  -- Day-end exports: MAS_AHM_FLOW_NEW_<date> and MAS_AHM_FLOW_MANUAL_<date>. An account can appear in both on one day, so the flow
  -- is part of the key. One ALTER swaps the unique key (no gap without a key); the existing rows become flow = 'NEW'.
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND COLUMN_NAME = 'flow') THEN
    ALTER TABLE sbi_card_account_file ADD COLUMN flow VARCHAR(10) NOT NULL DEFAULT 'NEW' AFTER account_no;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sbi_card_account_file' AND INDEX_NAME = 'uq_sbi_card_account_file_flow') THEN
    ALTER TABLE sbi_card_account_file DROP INDEX uq_sbi_card_account_file,
      ADD UNIQUE KEY uq_sbi_card_account_file_flow (process_id, report_date, account_no, flow);
  END IF;
END $$

CALL _m2075_sbi_account_file_ops() $$
DROP PROCEDURE IF EXISTS _m2075_sbi_account_file_ops $$

DELIMITER ;

UPDATE upload_template_master
   SET optional_columns = JSON_ARRAY('Report Date', 'Flow', 'BILLING_CYCLE', 'DELQ1', 'CIBIL_SCORE', 'CREDIT_LIMIT', 'CUR_BAL', 'CUR_BAL_PLUS_DPI', 'TOTAL_AMOUNT_DUE', 'TOTAL_CUR_DUE', 'DATE_LAST_PMT', 'LAST_ACTION_CODE', 'LAST_PTP_DATE', 'MOBILE_NO', 'VINTAGE', 'REGION', 'AGENCY_NAME', 'CALL_TABLE_NAME', 'DIAL_CNT', 'CD', 'NRR', 'BLOCK_1', 'BLOCK_2', 'NTC_FLAG', 'NEW_TO_CARD_FLAG', 'PROMO_CODE', 'PRODUCT_CLASS_FLAG', 'ACCOUNTS_CLASS', 'DONOTCALL', 'CALLBACK_DT', 'CALL1_DT', 'DISP1_C', 'AGENT1_ID', 'CALL2_DT', 'DISP2_C', 'AGENT2_ID', 'CALL3_DT', 'DISP3_C', 'AGENT3_ID', 'CALL4_DT', 'DISP4_C', 'AGENT4_ID', 'CALL5_DT', 'DISP5_C', 'AGENT5_ID', 'CALL6_DT', 'DISP6_C', 'AGENT6_ID'),
       description = 'SBI Card Collections account-level dialer export. Stores account, bucket, balance, class / flag and call-attempt columns (time, disposition code, dialer agent id); customer name and every phone number other than MOBILE_NO are dropped. Report Date is the file-level snapshot day (the upload screen pre-fills it from the latest call date in the file).'
 WHERE upload_type_code = 'SBI_CARD_ACCOUNT_FILE';

DELETE FROM upload_template_master WHERE upload_type_code = 'SBI_CARD_APR';
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'SBI_CARD_APR', 'SBI Card -- Agent time (APR)', 'sbi_card_agent_time',
   'SBI Card Collections dialer Agent Time Detail export (AGENT_TIME*.csv): per agent per day login, wait, talk, dispo, pause and pause-code time. The day is read from the "Time range:" line above the header; the TOTALS row is ignored. Column order and header spelling may vary: columns are matched by name, synonym, near-match and cell content, and the upload log records what was assumed. Re-uploading the same ID + day refreshes the row.',
   JSON_ARRAY(),
   JSON_ARRAY('ID', 'Report Date', 'USER', 'CALLS', 'TIME CLOCK', 'LOGIN TIME', 'WAIT', 'TALK', 'DISPO', 'PAUSE', 'DEAD', 'CUSTOMER', 'Login', 'Logout', 'ACHT', 'DISMX', 'LAGGED', 'LB', 'LOGIN', 'MB', 'QB', 'TB', 'WB'),
   JSON_OBJECT('USER', 'Vikas Kumar Ojha', 'ID', 'MAS62973', 'CALLS', '59', 'LOGIN TIME', '8:59:30', 'WAIT', '2:14:27', 'TALK', '3:07:03', 'DISPO', '0:21:21', 'PAUSE', '3:16:39', 'Login', '10:04:03', 'Logout', '19:03:41', 'ACHT', '212'),
   1);
