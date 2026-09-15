-- Registers upload_template_master entries for Birlanu (Sale, APR) and
-- Satya Retail (Allocation, CDR) -- the 4 new upload types sql/1770's
-- tables serve. Required/optional columns are the real headers confirmed
-- directly against the files the user supplied. Applied ahead of the
-- tables existing (same pattern as sql/1767/1769) -- harmless; uploads
-- will fail with a table-not-found error until sql/1770 is run.
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'BIRLANU_SALE_MASMIS', 'Birlanu — birlanu_sale (writes to db_masmis.birlanu_sale)', 'db_masmis.birlanu_sale',
   'birlanu_sale export -- writes into a new table.',
   JSON_ARRAY('Unique Id'),
   JSON_ARRAY('Week/Month','Weeks','Days','LeadRegisterMonth','Date','ID','Customer Name','Customer Type','Calling Number','Enquiry Type','Enquiry Source','Sub Enquiry Source','LeadRegisterDate','LeadOutcalledDate','Call type','Calling Status','Interested Status','Sub Calling Status','Sub Sub Calling Status','Select Business','Buyer Type','Lead Status','Construction Level','Customer Name_1','Alternative Number','Email ID','Address','Landmark','Brand','Product','Sub Product','State','District','Zone','Pincode','Agent Name','Order Qty','Order Description','Order Value','Customer Type Select','Registration Status','Remark','Secure URL','Seller Email ID','Seller Phone No','Lead Closer Status','Lead Closer Status New','merged Lead Closer Status','Lead Close Date','Final Lead Close Date','Lead Upload Type','Created By','Updated By','Created At','Updated At','Sale MT','Sale INR','Sale Team Remarks','Sale Lead Status','CC Fi-l Remarks Reformat','Sale Lead Category','Sale Product','Sale Product Value','Sale Status','Attempt','Revised Source','Lead Closer Month','Organic/Paid','Partner','Helper','Closed','First Call Date & Time','Created At (IST)','FRT','Within TAT','Bucket','For FR TAT','Created At (IST)_1'),
   JSON_OBJECT('Unique Id', 'SAMPLE'),
   1),
  (UUID(), 'BIRLANU_APR_MASMIS', 'Birlanu — birlanu_apr (writes to db_masmis.birlanu_apr)', 'db_masmis.birlanu_apr',
   'birlanu_apr export -- writes into a new table.',
   JSON_ARRAY('ID'),
   JSON_ARRAY('Date','Agent Name','Total','TIME CLOCK','LOGIN TIME','WAIT','WAIT %','TALK','TALK TIME %','DISPO','DISPOTIME %','PAUSE','PAUSETIME %','DEAD','DEAD TIME %','CUSTOMER','Login','Logout','ACHT','AOM','BIO','LAGGED','LOGIN','Lunch','Meet','TEA','Total break','Net login','Attandance'),
   JSON_OBJECT('ID', 'SAMPLE'),
   1),
  (UUID(), 'SATYA_ALLOCATION_MASMIS', 'Satya Retail — satya_allocation (writes to db_masmis.satya_allocation)', 'db_masmis.satya_allocation',
   'satya_allocation export -- writes into a new table.',
   JSON_ARRAY('UID'),
   JSON_ARRAY('Roster','Warehouse','Beatname','Shop Name','Shop Phone','MASID','Date','Number','Unique','All Date','Agent ID','Disposition','Sub-Disposition','Attempt','dd','Same Day Connected','Agent Name','Order Value','Call Type','Order Match (filtered)','Agent Name_1'),
   JSON_OBJECT('UID', 'SAMPLE'),
   1),
  (UUID(), 'SATYA_CDR_MASMIS', 'Satya Retail — satya_cdr (writes to db_masmis.satya_cdr)', 'db_masmis.satya_cdr',
   'satya_cdr export -- writes into a new table.',
   JSON_ARRAY('Call Id'),
   JSON_ARRAY('Numner','IN CALL FROM','SCENARIO','SUB SCENARIO 1','Amount','Beatname','Shop Name','Warehouse','Remarks','Roster','CallDate','Call Action','Call Sub Action','Call Action Remarks','Closer Date','Follow Up Date','Case Close By','TAT','Due Date','Call Created','Call Status','Connected','Closer Time','Date','Attempt','Agent Name','UID'),
   JSON_OBJECT('Call Id', 'SAMPLE'),
   1);
