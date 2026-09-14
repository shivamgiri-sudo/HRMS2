-- No CREATE TABLE here. Registers upload_template_master only. GNC's real
-- "Allocation" export -- the 3rd of GNC's 3 real My Dashboards upload
-- types (Sale sql/1740, APR sql/1741 both already shipped). Writes into
-- the SAME already-live db_masmis.gnc_allocation table (60,375 real rows,
-- most recent upload 2026-05-31) the separate My Dashboards tool
-- (github.com/tausifansari-mcn/Mydashboards) already writes into. Live
-- schema matches that repo's own code exactly -- no drift found.
DELETE FROM upload_template_master WHERE upload_type_code = 'GNC_ALLOCATION_MASMIS';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'GNC_ALLOCATION_MASMIS', 'GNC — Allocation (writes to db_masmis.gnc_allocation)', 'db_masmis.gnc_allocation',
   'GNC''s real Allocation export -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('uid'),
   JSON_ARRAY('alloc_date', 'helper', 'store', 'customer_name', 'total', 'shipping_phone', 'emp_id', 'calling_status'),
   JSON_OBJECT('uid', '461727439750855', 'alloc_date', '2026-05-29', 'emp_id', 'MAS62067', 'total', '999'),
   1);
