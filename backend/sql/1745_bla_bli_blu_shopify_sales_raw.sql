-- Bla Bli Blu's real "Sales Raw Received From Client ABC_Cart Sales.xlsb"
-- -- a genuine, direct Shopify order export (Financial Status/Fulfillment
-- Status/GoKwik payment info/discount codes), one row per line item, NOT
-- agent-call-attributed. Confirmed genuinely different from the
-- already-built bla_bli_blu_overall_sales_raw (sql/1729, the workbook's
-- own curated "Overall Sales Raw" sheet with agent/call attribution
-- columns) -- this file has zero agent/call columns at all and covers a
-- different date range (2026-09-08/09 orders vs sql/1729's 2026-08
-- range), so it is not a duplicate batch of the same sheet either. 173
-- real line-item rows.
--
-- Source is significantly corrupted by broken cross-sheet VLOOKUP
-- formulas, same Excel error-byte-code pattern as sql/1737's Housing
-- Owner Incentive sheet ("0x2a"=#N/A etc): "IB RAW" (164/173 corrupted),
-- "Upgrade Email Channel" (169/173 corrupted) -- both DROPPED as carrying
-- no real signal, same discipline as sql/1738's dropped "ringTime".
-- "GoKwik"/"Order id"/"Order id-Mobile" are also affected (40-65%
-- corrupted) but kept, with corrupted cells stored as NULL per the user's
-- established decision -- never the literal error text, never guessed.
-- "Device ID" and "Location" are 100% blank across all 173 rows --
-- dropped. "Notes" and "Employee" are almost entirely blank (4/173,
-- 5/173) but kept since the few real values are genuine, not fabricated.
--
-- Row identity: (Name, Lineitem sku) is unique across all 173 real rows,
-- zero collisions -- "Name" is the Shopify order number (e.g.
-- "BBB2559261"), repeated once per line item in a multi-item order.
CREATE TABLE IF NOT EXISTS bla_bli_blu_shopify_sales_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  order_name VARCHAR(50) NOT NULL,
  lineitem_sku VARCHAR(100) NOT NULL,
  shopify_order_id VARCHAR(50) NULL,
  financial_status VARCHAR(50) NULL,
  paid_at DATETIME NULL,
  fulfillment_status VARCHAR(50) NULL,
  total_amount DECIMAL(12,2) NULL,
  discount_code VARCHAR(255) NULL,
  discount_amount DECIMAL(12,2) NULL,
  shipping_method VARCHAR(100) NULL,
  order_created_at DATETIME NULL,
  lineitem_quantity INT NULL,
  lineitem_name VARCHAR(255) NULL,
  lineitem_price DECIMAL(12,2) NULL,
  lineitem_compare_at_price DECIMAL(12,2) NULL,
  shipping_phone VARCHAR(30) NULL,
  notes TEXT NULL,
  employee VARCHAR(255) NULL,
  tags TEXT NULL,
  risk_level VARCHAR(20) NULL,
  source VARCHAR(50) NULL,
  ob_sale_raw VARCHAR(50) NULL,
  gokwik VARCHAR(100) NULL,
  order_id_lookup VARCHAR(100) NULL,
  order_id_mobile VARCHAR(100) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bla_bli_blu_shopify_sales (process_id, order_name, lineitem_sku),
  KEY idx_bla_bli_blu_shopify_sales_date (process_id, order_created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'BLA_BLI_BLU_SHOPIFY_SALES';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'BLA_BLI_BLU_SHOPIFY_SALES', 'Bla Bli Blu — Shopify Sales Raw (ABC_Cart)', 'bla_bli_blu_shopify_sales_raw',
   'Bla Bli Blu''s real direct Shopify order export (no DB backing exists) -- corrupted VLOOKUP cells stored as NULL, never guessed.',
   JSON_ARRAY('Name', 'Lineitem sku'),
   JSON_ARRAY('Financial Status', 'Paid at', 'Fulfillment Status', 'Total', 'Discount Code',
     'Discount Amount', 'Shipping Method', 'Created at', 'Lineitem quantity', 'Lineitem name',
     'Lineitem price', 'Lineitem compare at price', 'ShippingPhone', 'Notes', 'Employee', 'Id',
     'Tags', 'Risk Level', 'Source', 'OB Sale RAW', 'GoKwik', 'Order id', 'Order id-Mobile'),
   JSON_OBJECT('Name', 'BBB2559261', 'Lineitem sku', '8908027132044', 'Financial Status', 'paid',
     'Total', '1041', 'Lineitem name', 'Love Drunk - 100ml'),
   1);
