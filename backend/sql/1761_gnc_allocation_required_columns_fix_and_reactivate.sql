-- GNC_ALLOCATION_MASMIS's catalog row (sql/1747) never matched what a real
-- upload produces: required_columns/optional_columns were canonical
-- snake_case ('uid', 'alloc_date', 'helper', ...), but
-- BellavitaMasmisUploader.tsx stages normalized_data as the raw parsed row
-- verbatim -- the real file's actual headers ("UID", "Date", "Helper", ...),
-- same lesson already fixed for GNC_APR (sql/1760) and the Bellavita
-- uploaders (sql/1757-1759). gnc-allocation-masmis-bulk.service.ts's own
-- get()/n() lookups had the identical bug, fixed alongside this migration.
--
-- The row was also found with active_status = 0, which is why the frontend
-- showed "Could not load the upload template" for every viewer -- /templates
-- filters on active_status = 1. Reactivating it here; whatever concurrent
-- work left it disabled predates this fix and this migration supersedes it.
--
-- Column order matches the real export exactly (confirmed against a live
-- sample screenshot): UID, Date, Helper, Data Type, Time Slot, Store, Name,
-- Email, Total, Created at, Lineitem name, Lineitem sku, Shipping Name,
-- Shipping Street, Shipping City, Shipping Zip, ShippingPhone, Agent,
-- Disposition, SUB SCENARIOS 1, Date (again -- a callback date; SheetJS's
-- sheet_to_json dedupes repeated headers by suffixing "_1", confirmed live
-- against this project's installed xlsx@0.18.5), Same Day Connnect (the
-- real header's own typo, three n's), NC Connect.
UPDATE upload_template_master
   SET required_columns = JSON_ARRAY('UID'),
       optional_columns = JSON_ARRAY(
         'Date', 'Helper', 'Data Type', 'Time Slot', 'Store', 'Name', 'Email', 'Total',
         'Created at', 'Lineitem name', 'Lineitem sku', 'Shipping Name', 'Shipping Street',
         'Shipping City', 'Shipping Zip', 'ShippingPhone', 'Agent', 'Disposition',
         'SUB SCENARIOS 1', 'Date_1', 'Same Day Connnect', 'NC Connect'
       ),
       sample_row = JSON_OBJECT('UID', '461727439750855', 'Date', '29-May-26', 'Agent', 'MAS62067', 'Total', '999'),
       active_status = 1
 WHERE upload_type_code = 'GNC_ALLOCATION_MASMIS';
