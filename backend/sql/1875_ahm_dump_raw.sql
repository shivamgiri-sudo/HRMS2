-- AHM: a brand-new Process Performance V2 process. Its own "Dump" export -- one row per
-- outlet/SKU order line, captured by a telesales agent (survey/order) and fulfilled by a
-- delivery agent -- confirmed live against two real files the user supplied:
-- "02 Oct Dump MP.xlsx" (40,003 rows) and "03 Oct Dump MM.xlsx" (140,702 rows), identical
-- 43-column shape. The two files are two branch-level exports (filenames' own "MP"/"MM"),
-- not two different formats, so one table serves both uploaders; source_region is which
-- uploader a row came through, purely for provenance -- the real geography lives in the
-- row's own Region/State/Zone/City (TOWN) columns.
--
-- Row identity: no single column is a reliable per-line id. "Sales No" is the order id
-- (repeats once per SKU line within the same order); "Product Code" is the SKU. Verified
-- live: every sampled order's (Sales No, Product Code) pair appears once. Used as the
-- UNIQUE KEY so a re-uploaded/overlapping file upserts rather than duplicates.
--
-- Survey Date / Delivery Date: the source stores an unset Delivery Date as the literal
-- "0000-00-00 00:00:00" (confirmed live) -- the import maps that to NULL, never a real date.
--
-- The table lives in db_masmis (like every other MASMIS raw store this app uploads into);
-- the upload_template_master rows are in mas_hrms. ADDITIVE ONLY: a new table, a new
-- process_master row ('AHM', guarded so a pre-existing row is never touched) and two
-- upload_template_master rows -- nothing existing is changed.
--
-- NOTE: the app db user has no CREATE on db_masmis (same as sql/1766, 1774, 1776, 1779,
-- 1781) -- this needs a higher-privileged manual run before the uploader will work; until
-- then uploads fail with a table-not-found error, same as those precedents.
CREATE TABLE IF NOT EXISTS db_masmis.ahm_dump_raw (
  id                       CHAR(36)      NOT NULL PRIMARY KEY,
  process_id               CHAR(36)      NOT NULL,
  source_region            VARCHAR(10)   NOT NULL,
  region                   VARCHAR(150)  NULL,
  state                    VARCHAR(100)  NULL,
  gpi_state                VARCHAR(100)  NULL,
  zone                     VARCHAR(100)  NULL,
  city_town                VARCHAR(150)  NULL,
  wd_code                  VARCHAR(60)   NULL,
  wd_name                  VARCHAR(150)  NULL,
  sales_no                 BIGINT        NOT NULL,
  survey_date              DATETIME      NULL,
  category                 VARCHAR(100)  NULL,
  franchise                VARCHAR(100)  NULL,
  salesman                 VARCHAR(100)  NULL,
  owner_type               VARCHAR(50)   NULL,
  outlet_id                VARCHAR(60)   NOT NULL,
  outlet_name              VARCHAR(200)  NULL,
  address                  VARCHAR(300)  NULL,
  phone_number             VARCHAR(20)   NULL,
  route_name               VARCHAR(150)  NULL,
  class_of_outlet          VARCHAR(50)   NULL,
  type_of_outlet           VARCHAR(50)   NULL,
  product_code             VARCHAR(60)   NOT NULL,
  product_sku              VARCHAR(200)  NULL,
  product_batch            VARCHAR(60)   NULL,
  sku_mrp                  DECIMAL(10,2) NULL,
  survey_qty               INT           NOT NULL DEFAULT 0,
  survey_offer_qty         INT           NOT NULL DEFAULT 0,
  sales_qty                INT           NOT NULL DEFAULT 0,
  sales_offer_qty          INT           NOT NULL DEFAULT 0,
  outlet_description       VARCHAR(300)  NULL,
  delivery_date            DATETIME      NULL,
  phone_no                 VARCHAR(20)   NULL,
  locality                 VARCHAR(150)  NULL,
  coverage_frequency       VARCHAR(60)   NULL,
  delivered_by             VARCHAR(60)   NULL,
  last_status              VARCHAR(60)   NULL,
  telesales_id             VARCHAR(60)   NULL,
  telesales_type           VARCHAR(60)   NULL,
  suggested_quantity       INT           NULL,
  last_disposition_status  VARCHAR(80)   NULL,
  product_shortname        VARCHAR(200)  NULL,
  scheme_description       VARCHAR(200)  NULL,
  free_sku_name            VARCHAR(200)  NULL,
  ts_interface             VARCHAR(60)   NULL,
  user_identity            VARCHAR(60)   NULL,
  data_source              VARCHAR(100)  NOT NULL DEFAULT 'bulk_upload',
  source_reference         VARCHAR(100)  NULL,
  upload_batch_id          CHAR(36)      NULL,
  created_by               CHAR(36)      NULL,
  created_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ahm_dump_order_line (sales_no, product_code),
  KEY idx_ahm_dump_survey_date (survey_date),
  KEY idx_ahm_dump_outlet (outlet_id),
  KEY idx_ahm_dump_telesales (telesales_id, survey_date),
  KEY idx_ahm_dump_delivered_by (delivered_by, survey_date),
  KEY idx_ahm_dump_disposition (last_disposition_status),
  KEY idx_ahm_dump_hierarchy (zone, city_town)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO process_master (id, process_code, process_name, active_status)
VALUES (UUID(), 'AHM', 'AHM', 1);

DELETE FROM upload_template_master WHERE upload_type_code IN ('AHM_DUMP_MP', 'AHM_DUMP_MM');

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'AHM_DUMP_MP', 'AHM — Dump (MP)', 'ahm_dump_raw',
   'AHM''s own order/survey-to-delivery export, MP branch. One row per outlet/SKU order line.',
   JSON_ARRAY('Sales No', 'Survey Date', 'Outlet ID', 'Product Code'),
   JSON_ARRAY('Region', 'State', 'GPI State', 'Zone', 'City (TOWN)', 'WD Code', 'WD Name', 'Category', 'Franchise',
     'Salesman', 'Owner Type', 'Outlet Name', 'Address', 'Phone Number', 'Route Name', 'Class of Outlet',
     'Type of Outlet', 'Product SKU', 'Product Batch', 'SKU MRP', 'Survey Qty', 'Survey Offer Qty', 'Sales Qty',
     'Sales Offer Qty', 'Outlet Description', 'Delivery Date', 'Phone No', 'Locality', 'Coverage Frequency',
     'Delivered By', 'Last Status', 'Telesales ID', 'Telesales Type', 'Suggested Quantity',
     'Last disposition Status', 'Product ShortName', 'Scheme Description', 'Free SKU name', 'TS Interface',
     'User Identity'),
   JSON_OBJECT('Region', 'JAIPUR BRANCH', 'State', 'RAJASTHAN-0332', 'City (TOWN)', 'UDAIPUR RK-0336200',
     'Sales No', '99000273267185', 'Survey Date', '2026-10-02 00:00:38', 'Outlet ID', 'B01812162045',
     'Outlet Name', 'ARORA PAN MAHESH JI', 'Product Code', 'CIG0002625', 'Product SKU', 'FSP', 'SKU MRP', '98',
     'Survey Qty', '1', 'Sales Qty', '0', 'Last Status', 'Delivered', 'Telesales ID', 'rajuditc01',
     'Last disposition Status', 'Survey Taken'),
   1),
  (UUID(), 'AHM_DUMP_MM', 'AHM — Dump (MM)', 'ahm_dump_raw',
   'AHM''s own order/survey-to-delivery export, MM branch. Same shape as the MP uploader.',
   JSON_ARRAY('Sales No', 'Survey Date', 'Outlet ID', 'Product Code'),
   JSON_ARRAY('Region', 'State', 'GPI State', 'Zone', 'City (TOWN)', 'WD Code', 'WD Name', 'Category', 'Franchise',
     'Salesman', 'Owner Type', 'Outlet Name', 'Address', 'Phone Number', 'Route Name', 'Class of Outlet',
     'Type of Outlet', 'Product SKU', 'Product Batch', 'SKU MRP', 'Survey Qty', 'Survey Offer Qty', 'Sales Qty',
     'Sales Offer Qty', 'Outlet Description', 'Delivery Date', 'Phone No', 'Locality', 'Coverage Frequency',
     'Delivered By', 'Last Status', 'Telesales ID', 'Telesales Type', 'Suggested Quantity',
     'Last disposition Status', 'Product ShortName', 'Scheme Description', 'Free SKU name', 'TS Interface',
     'User Identity'),
   JSON_OBJECT('Region', 'MUMBAI BRANCH', 'State', 'MAHARASHTRA-0212', 'City (TOWN)', 'PUNE CAMP-0210700',
     'Sales No', '99000273452227', 'Survey Date', '2026-10-03 00:00:28', 'Outlet ID', 'B02403180245',
     'Outlet Name', 'BEO TAG VANDANA', 'Product Code', 'CIG0002010', 'Product SKU', 'MLB CLOVE MIX 10S',
     'SKU MRP', '240', 'Survey Qty', '1', 'Sales Qty', '1', 'Last Status', 'Delivered', 'Telesales ID', 'nasikts01',
     'Last disposition Status', 'Survey Taken'),
   1);
