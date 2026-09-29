-- No CREATE TABLE here (sql/1766 creates the 6 tables themselves, which
-- shivam_user cannot run -- see that file's own note). Registers
-- upload_template_master entries for Housing Owner/Premium's 6 new upload
-- types, per explicit user request, matching sql/1766's tables exactly.
--
-- REVISED 2026-09-15: the first version's required/optional_columns were
-- unverified guesses (Opp_ID/call_id/Emp ID+Name/Order_ID). Real files the
-- user supplied showed different real headers throughout -- see each
-- corresponding owner-*/pre-*-bulk.service.ts file's own updated comment
-- for the specific real file each column set was confirmed against.
--
-- DELETE-then-INSERT, same idempotent pattern as sql/1746/1761/1764 (no
-- assumption of a UNIQUE index on upload_type_code) -- also correctly
-- replaces the first version's rows already live from this file's earlier
-- form.
DELETE FROM upload_template_master WHERE upload_type_code IN (
  'OWNER_SALE_MASMIS', 'OWNER_CDR_MASMIS', 'OWNER_AGENT_DETAILS_MASMIS',
  'PRE_SALE_MASMIS', 'PRE_CDR_MASMIS', 'PRE_AGENT_DETAILS_MASMIS'
);

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'OWNER_SALE_MASMIS', 'Housing Owner — Sale (writes to db_masmis.owner_sale)', 'db_masmis.owner_sale',
   'Housing Owner''s Sale export -- writes into a new table, separate from the existing housing_owner_sale_raw feature.',
   JSON_ARRAY('Opp ID'),
   JSON_ARRAY('Date','Agent ID','Agent Name','Value','Count','Payment Mode','Package Name','Package Type','Discount %','TL Name','Week','Month','Day','AM'),
   JSON_OBJECT('Opp ID', '11904708', 'Date', '1-Sep-26', 'Agent Name', 'Himanshu Kumar MCN', 'Value', '3245'),
   1),
  (UUID(), 'OWNER_CDR_MASMIS', 'Housing Owner — CDR (writes to db_masmis.Owner_cdr)', 'db_masmis.Owner_cdr',
   'Housing Owner''s CDR export (an agent-level daily aggregate, not per-call) -- writes into a new table, separate from the existing CR_housing_owner.',
   JSON_ARRAY('UID'),
   JSON_ARRAY('Date','Agent','Email ID','Intercom ID','Group','Department','Login Based Calling','Average Calls/Day',
     'Average C2C Calls/Day - Outbound Answered','Average Inbound Calls/Day','Call Handling Rate','Total Calls',
     'Inbound Calls Offered','Outbound Click to Call Attempted','Calls Handled','Inbound Calls Answered',
     'Inbound Calls Missed','Outbound Click to Call Answered','Available Duration','In-Call Duration','Break Duration',
     'Inbound In-Call Duration','Outbound In-Call Duration','Average Call Handling Duration',
     'Average Inbound Call Handling Duration','Average Outbound Call Handling Duration','Not Connected','Connected',
     'TL Name','Average Talk time','Month','Day','last','AM'),
   JSON_OBJECT('UID', '46266Videsh kumar MCN', 'Agent', 'Videsh kumar MCN', 'Total Calls', '443'),
   1),
  (UUID(), 'OWNER_AGENT_DETAILS_MASMIS', 'Housing Owner — Agent Details (writes to db_masmis.owner_agent_details)', 'db_masmis.owner_agent_details',
   'Housing Owner''s agent target/incentive tracking sheet -- writes into a new table.',
   JSON_ARRAY('MAS'),
   JSON_ARRAY('SNo','CRMID','Overall','TLName','DOJ','Status','Ageing','Bucket','MonthlyTarget','Without GST Target','PerDayTarget','MTD','Name','AM'),
   JSON_OBJECT('MAS', 'MAS49862', 'Name', 'Vintage', 'TLName', 'Vintage', 'Status', 'Active'),
   1),
  (UUID(), 'PRE_SALE_MASMIS', 'Housing Premium — Sale (writes to db_masmis.pre_sale)', 'db_masmis.pre_sale',
   'Housing Premium''s Sale export -- writes into a new table, separate from the existing housing-premium-sale-raw feature.',
   JSON_ARRAY('Order ID'),
   JSON_ARRAY('Date','Created At','Agent Name','TL Name','Partner Name','Amount','Order Value','Target','Week','Month','Day','AM'),
   JSON_OBJECT('Order ID', 'ORD12345', 'Date', '2026-09-01', 'Agent Name', 'Test Agent', 'Amount', '15000'),
   1),
  (UUID(), 'PRE_CDR_MASMIS', 'Housing Premium — CDR (writes to db_masmis.Pre_cdr)', 'db_masmis.Pre_cdr',
   'Housing Premium''s CDR export (genuinely per-call) -- writes into a new table, separate from the existing CR_housing_premium.',
   JSON_ARRAY('CALLER'),
   JSON_ARRAY('MEMBER','End Time','DURATION','STATUS','Routing Numbers','Routing Status','Talk Duration','Ringing Duration',
     'Start Time','Time','Date','TL Name','Count','Unique Count','Date row Count','V+W','Talk Time','TL'),
   JSON_OBJECT('CALLER', '8967972399', 'MEMBER', 'Dhiraj Prajapati', 'STATUS', 'Answered'),
   1),
  (UUID(), 'PRE_AGENT_DETAILS_MASMIS', 'Housing Premium — Agent Details (writes to db_masmis.pre_agent_details)', 'db_masmis.pre_agent_details',
   'Housing Premium''s agent achievement tracking sheet -- writes into a new table.',
   JSON_ARRAY('Emp ID'),
   JSON_ARRAY('Agent Name(As per CRM)','TL Name','Center','DOJ','Tenure','Tenure Bucket','Target','Achievement','Ach%','Status'),
   JSON_OBJECT('Emp ID', 'MAS62015', 'Agent Name(As per CRM)', 'Abhay Jadaun', 'Status', 'Active'),
   1);
