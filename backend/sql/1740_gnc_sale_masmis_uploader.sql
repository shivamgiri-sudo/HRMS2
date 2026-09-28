-- No CREATE TABLE here. GNC's real "Date & Camp wise Overall Sale" sheet
-- writes into the ALREADY-LIVE db_masmis.gnc_sale table (1399 real rows,
-- most recent upload 2026-07-02) -- the same table the separate "My
-- Dashboards" tool (github.com/tausifansari-mcn/Mydashboards) already
-- writes into and its own GNC dashboard reads from. Per explicit user
-- instruction ("we will use the same database table just build the
-- uploader in HRMS"), this only registers the upload type here; see
-- gnc-sale-masmis-bulk.service.ts for the actual cross-schema INSERT.
DELETE FROM upload_template_master WHERE upload_type_code = 'GNC_SALE_MASMIS';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'GNC_SALE_MASMIS', 'GNC — Sale (writes to db_masmis.gnc_sale)', 'db_masmis.gnc_sale',
   'GNC''s real Date & Camp wise Overall Sale sheet -- writes into the same live table the My Dashboards tool already uses (no new table, per explicit user instruction).',
   JSON_ARRAY('OrderID', 'Date'),
   JSON_ARRAY('Week', 'EMP ID', 'Emp_Name', 'TL', 'T1', 'T3', 'CustomerNumber', 'E-mail ID',
     'Payment Status', 'Gross Amount', 'Sum Before GST', 'Campaign', 'Discount Code', 'Count',
     'Status', 'Lineitem name', 'Sale Lob', 'Target', 'Sale Source'),
   JSON_OBJECT('OrderID', 'GNCE1852047', 'Date', '29-May-26', 'EMP ID', 'MAS62067',
     'Emp_Name', 'SHALU ARYA', 'Payment Status', 'Prepaid', 'Gross Amount', '2373'),
   1);
