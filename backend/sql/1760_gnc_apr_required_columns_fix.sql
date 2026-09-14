-- GNC_APR's catalog required_columns (["report_date", "user_name", "calls"])
-- never matched what gnc-apr-masmis-bulk.service.ts's own required-field check
-- actually enforces: userName/reportDate, checked primarily against "User Name"/
-- "Date" (the real header text its own code already anticipated as a fallback,
-- same pattern confirmed correct for every Bellavita upload type this session) --
-- not the internal "user_name"/"report_date" names, and "calls" was never
-- enforced by the code at all. Aligning the catalog to what the code actually
-- requires, same fix pattern as sql/1757 for BB_APR_MASMIS.
UPDATE upload_template_master
   SET required_columns = JSON_ARRAY('User Name', 'Date')
 WHERE upload_type_code = 'GNC_APR';
