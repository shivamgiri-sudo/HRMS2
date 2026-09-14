-- Reginald Men Abandoned Cart Dashboard's real "Live Sales" source -- a
-- Google Form ("Abandan Cart REPORT" spreadsheet, Form Responses 1 tab,
-- https://docs.google.com/spreadsheets/d/1BMgtMOSws5w4Im1QPUllpMA6tTkRx9QwOvplFb5N22A)
-- confirmed live and current through today (2026-09-10 18:39, the exact
-- moment this was checked) via the real "Reginald_Men_Abandoned_Cart_
-- Dashboard_SOP_WITH_PATH.xlsx" SOP's own Data Source Mapping / Direct
-- Paths tabs. 10,740 real rows, agents submit each abandoned-cart/repeat
-- sale via this form as it happens.
--
-- Confirmed zero DB backing: reginald_abandoned_cart_daily_actual (the
-- already-live dialer_db.cdr_ob_25/vicidial_agent_log_10_25 sync, see
-- reginald-abandoned-cart-sync.service.ts) carries only call/login metrics
-- (total_cdr, unique_dialed, talk/wrapup/wait/dead seconds) -- no sales
-- columns at all. The SOP's sibling "Monthly Sales Source" spreadsheet
-- (153pYQNXr5PbBSV1o2j_AxEKdKDVf4mExJi7I__smiqA) was checked too but this
-- Google account has no access to it (confirmed: both /edit and /export
-- return "Access Denied") -- only this Live Sales form is buildable
-- without guessing at a schema we cannot see.
--
-- Real column shape (header row verbatim, two mislabeled generic headers
-- from the form's own export -- "Column 6" is actually Agent Name, "Column 1"
-- is actually Time Slot, kept as agent_name/time_slot here rather than the
-- source's own confusing labels): Timestamp, Order id (#RM123456 style),
-- Amount, LOB (ABCD=Abandoned Cart / REPT=Repeat, the only 2 real values),
-- Order Date, Payment Type (COD/Prepaid/blank), Column 6 (agent name),
-- Order id (bare numeric, e.g. 123456 -- the same order without the #RM
-- prefix), Column 1 (time slot, e.g. "2 PM-3 PM" -- source text uses a
-- mangled en-dash character, kept verbatim not corrected), EMP ID (real
-- MAS employee codes, sampled and confirmed real).
--
-- Row identity: the sheet's own "Order id" (#RM... form) is unique for
-- 10,738 of 10,740 real rows (2 exact duplicate submissions -- form
-- double-submits, not corruption; ON DUPLICATE KEY UPDATE handles them as
-- an upsert rather than erroring).
CREATE TABLE IF NOT EXISTS reginald_abandoned_cart_sales_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  order_id VARCHAR(50) NOT NULL,
  order_id_numeric VARCHAR(50) NULL,
  submitted_at DATETIME NULL,
  amount DECIMAL(12,2) NULL,
  lob VARCHAR(20) NULL,
  order_date DATE NULL,
  payment_type VARCHAR(30) NULL,
  agent_name VARCHAR(255) NULL,
  agent_name_norm VARCHAR(255) NULL,
  time_slot VARCHAR(50) NULL,
  emp_id VARCHAR(50) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reginald_abandoned_cart_sales_order (process_id, order_id),
  KEY idx_reginald_abandoned_cart_sales_date (process_id, order_date),
  KEY idx_reginald_abandoned_cart_sales_emp (emp_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'REGINALD_ABANDONED_CART_SALES';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'REGINALD_ABANDONED_CART_SALES', 'Reginald Men — Abandoned Cart Live Sales', 'reginald_abandoned_cart_sales_raw',
   'Reginald Men Abandoned Cart Dashboard''s real Live Sales Google Form export (no DB backing existed). LOB=ABCD is Abandoned Cart, REPT is Repeat.',
   JSON_ARRAY('Order id', 'Amount', 'LOB'),
   JSON_ARRAY('Timestamp', 'Order Date', 'Payment Type', 'Column 6', 'Order id ', 'Column 1', 'EMP ID'),
   JSON_OBJECT('Timestamp', '9/10/2026 18:39:29', 'Order id', '#RM1168439', 'Amount', '1530', 'LOB', 'ABCD',
     'Order Date', '9/10/2026', 'Payment Type', 'Prepaid', 'Column 6', 'SHAIK SHAROOQUE',
     'Order id ', '1168439', 'Column 1', '6 PM-7 PM', 'EMP ID', 'MAS62854'),
   1);
