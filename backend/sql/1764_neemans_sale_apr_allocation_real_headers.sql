-- NEEMANS_SALE_RAW_MASMIS/NEEMANS_ALLOCATION_MASMIS/NEEMANS_APR_MASMIS (sql/1746)
-- were registered with canonical camelCase guesses ("orderId", "phone",
-- "empName") that never matched any real file, same failure mode already
-- fixed for GNC_APR/GNC_ALLOCATION (sql/1760/1761): the frontend's own
-- required-column check in BellavitaMasmisUploader.tsx runs BEFORE
-- staging, against upload_template_master.required_columns directly, so
-- every real upload was rejected client-side with "No row had all
-- required columns (...) filled in" regardless of any backend fix.
--
-- Unlike GNC's screenshot-derived guesses, these three are read directly
-- off the app's own "Columns actually found in this file" error message
-- for each of the user's 3 real uploads -- not a guess. All three files'
-- headers line up 1:1 positionally with their target table's own column
-- order; see each service file's own updated header comment for the full
-- reasoning (neemans-sale-raw-masmis-bulk.service.ts,
-- neemans-allocation-masmis-bulk.service.ts, neemans-apr-masmis-bulk.service.ts).
UPDATE upload_template_master
   SET required_columns = JSON_ARRAY('OrderID'),
       optional_columns = JSON_ARRAY(
         'Week', 'Date', 'EMP ID', 'Name', 'TL', 'LOB', 'Tenure', 'CustomerNumber',
         'E-mail ID', 'Payment Status', 'Amount', 'Discount Code', 'Line_Item_Name',
         'LOB_1', 'Calling Status', 'Status', 'Count', 'Order ID',
         'Current Status ( Shiprocket Status)', 'Final Status', 'Line_Item_Qty',
         'Target', 'Call Date& Time', 'Duration ', 'Created at'
       )
 WHERE upload_type_code = 'NEEMANS_SALE_RAW_MASMIS';

UPDATE upload_template_master
   SET required_columns = JSON_ARRAY('Phone'),
       optional_columns = JSON_ARRAY(
         'Email', 'CustomerName', 'Producttitle', 'Amount', 'Type', 'Date', 'Agent',
         'Status', 'SUBSCENARIOS1', 'SUBSCENARIOS2', 'CallDate'
       )
 WHERE upload_type_code = 'NEEMANS_ALLOCATION_MASMIS';

UPDATE upload_template_master
   SET required_columns = JSON_ARRAY('Emp_Name'),
       optional_columns = JSON_ARRAY(
         'Unique ID', 'Week', 'Date', 'EMP ID', 'No. of Calls/Chat', 'UCA OB', 'LOB',
         'LOGIN TIME', 'PARKS', 'PARK TIME', 'AVG PARK', 'PARKS/CALL', 'WAIT', 'TALK',
         'DISPO', 'PAUSE', 'Login', 'Logout', 'ACHT', 'Team Briefing AUX', 'Lunch',
         'Tea', 'Tea1', 'Washr', 'Total Break', 'Net Login Hrs+DN+Briefing', 'Occu%',
         'Week_1', 'MTD', 'Attendance', 'Capping'
       )
 WHERE upload_type_code = 'NEEMANS_APR_MASMIS';
