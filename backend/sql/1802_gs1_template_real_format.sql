-- Migration 1802: Correct GS1 upload templates to the REAL export column format.
--
-- Found while fixing the GS1 upload pipeline (owner report: "HRMS Issue and observation
-- Reginald & GS1" -- GS1 dashboards show no data). Live upload_template_master rows for
-- GS1_EMAIL_DAILY/GS1_DATAKART_DAILY/GS1_APPROVAL_AUDIT hold empty required_columns/
-- optional_columns (migration 1769's INSERT ... ON DUPLICATE KEY UPDATE never actually
-- updates those two columns on a re-run, so whatever created these rows first left them
-- empty) -- meaning BulkUploadHub's own header-presence checks were a no-op for GS1 all
-- along, on top of the underlying column-mismatch and missing-column/index bugs already
-- fixed by the rewritten services and migration 1800.
--
-- Rather than restate 1769's imagined format, this fixes the template to literally what
-- "GS1.xlsx" (the file the owner actually produces) contains -- confirmed live via the
-- source file's own header row, sheet by sheet:
--   "Email " sheet: 19 columns, exactly GS1_EMAIL_DAILY_HEADERS in gs1-email-daily-bulk.service.ts.
--   "Data Kart" sheet: 20 columns, exactly GS1_DATAKART_DAILY_HEADERS in gs1-datakart-daily-bulk.service.ts.
--   "Approval" sheet: 89 columns (per-SKU QC/audit raw log) -- declared here in full, since
--     BulkUploadHub's csvHealthHasBlockingError() blocks on ANY uploaded header not declared
--     in required_columns/optional_columns ("unknown headers"), so a partial column list
--     would block the real 89-column file outright.
--
-- Same lesson as 1796->1797 (Reginald Men Live Sales): declare the CURRENT real format only,
-- not a union with the old imagined format -- a union means every column of whichever format
-- is absent from a given upload shows as a "missing header" and blocks the file. The old
-- format's field names stay supported as a service-level fallback (data["X"] ?? data["Y"]),
-- just no longer advertised/required by the template UI.
--
-- Uses direct UPDATE (not INSERT ... ON DUPLICATE KEY UPDATE) so it actually overwrites the
-- stuck-empty columns; safe to re-run.

UPDATE upload_template_master
SET required_columns = JSON_ARRAY('WORK Date','Name of executive'),
    optional_columns = JSON_ARRAY('Email Subject','Sender Name','Email Received Time','Work Start Time','Work End Time','Mail Date','Type Of Query','Status','Ticket','Type','Month','Duration','SLA','GTIN','Image','Months','Approval'),
    sample_row       = JSON_ARRAY('1-Sep-26','Rahul Raj','890616138 / product isnt approve yet / info to report issue','Sanjay Rajak','10:50','10:51','10:52','1-Sep-26','890616138 / product isnt approve yet / info to report issue','Information','#228291','Ticket','September-26','0:02','0-15 ','0','0','21','0')
WHERE upload_type_code = 'GS1_EMAIL_DAILY';

UPDATE upload_template_master
SET required_columns = JSON_ARRAY('Date','Name'),
    optional_columns = JSON_ARRAY('GCP','GTIN Count','Time','Complete time','Type','Move','Category','Sub category','Remark','Date of completion','Date of exported','Datakart type','Duration','SLA','Month''s','Month','Data Type','TAT'),
    sample_row       = JSON_ARRAY('2-Sep-26','Rahul Raj','8908029582','1988','19:28','11:06','Upload','GAP','Beverages','Beverages','Remarks is not available','31-Aug-26','2-Sep-26','2.O','','','August-26','21','Premium','')
WHERE upload_type_code = 'GS1_DATAKART_DAILY';

UPDATE upload_template_master
SET required_columns = JSON_ARRAY('Name','Auditor','Date of Completion'),
    optional_columns = JSON_ARRAY('Company Name','GCP','Exempted fields','Category Name','Subcategory Name','Created at','Product Updated date','Due Date','SLA Status','Product Name','GTIN','Product Description','Price','Target Market','Target Market','Country','Approval Status','Email','Condition','Brand Name','Gross Weight','Gross Weight Unit','Net Content','Net Content Unit','Net Weight','Net Weight Unit','packaging unit','packaging type','HS Code','Product status','Product SKU','Product Remarks','Valid From','Valid Till','product priority','product_parent_sku','sgst','igst','cgst','Primary Depth','Front Image','Back Image','Top Image','Bottom Image','Artwork Front','Artwork Back','Right Image','Left Image','Products count','AI Validated Reason','AI Validated Status','AI Product verification Reason','AI Product verification Status','Finding','QC Remarks ','Finding2','Clinkit QC Remarks','Verified/NonVerified','Remarks','Approve/Reject','Date Of Assighn','Date of export','Error Category','Quality Remarks','Errors Yes/No','Errors Yes','Errors No','Audits','Overall data','DataType','Slot','Allocation Date','Data Receive Date','Allocation Date And Time','Data Complete Date and Time','TAT','AI Data','Image Status','Back','Front','Top','Bottom','Artwork Front','Artwork Back','Right','Left'),
    sample_row       = JSON_ARRAY('Kishan Yadav','Manisha','1-Sep-26','9M INDIA LIMITED','89044483','','Health Care','Pharmaceutical Preparations/Formulations','10/4/2024 11:43:26 AM','31-Aug-26','01-Sep-26','Within SLA','Succinylcholine Chloride Injection IP','8904448302370','Succinylcholine Chloride Injection IP','','','India','pending','creative@9mindia.in','New','UNBRAND','110','g','50','each','100','g','mm','Boxed','30049099','uploaded','','','04-Oct-24','01-Jan-00','high','','6','12','6','130','https://api.gs1datakart.org/files/render?file_key=tmp/89044483/8904448302370/8904448302370_f.jpg','https://api.gs1datakart.org/files/render?file_key=tmp/89044483/8904448302370/8904448302370_b.jpg','https://api.gs1datakart.org/files/render?file_key=tmp/89044483/8904448302370/8904448302370_t.jpg','','https://api.gs1datakart.org/files/render?file_key=tmp/89044483/8904448302370/8904448302370_tl.jpg','https://api.gs1datakart.org/files/render?file_key=tmp/89044483/8904448302370/8904448302370_tr.jpg','https://api.gs1datakart.org/files/render?file_key=tmp/89044483/8904448302370/8904448302370_r.jpeg','https://api.gs1datakart.org/files/render?file_key=tmp/89044483/8904448302370/8904448302370_l.jpg','1','','AI Accepted','','','Incorrect','Barcode is  not available in product image ','','','Non-Verified','Barcode is  not available in product image ','Reject','1-Sep-26','1-Sep-26','0','Correct','No','0','1','1','1','Premium','9:30','01-09-2026- 09:27:00','01-09-2026- 11:19:00','01-09-2026- 09:27:00','01-09-2026- 11:19:00','Within TAT','Incorrect','With Image','1','1','1','0','1','1')
WHERE upload_type_code = 'GS1_APPROVAL_AUDIT';
