-- Follow-up to sql/1756 after the user attached real sample files for all 4
-- Bellavita upload types. Two more real problems found, both confirmed
-- against the attached samples:
--
-- 1. BB_APR_MASMIS's required_columns was ["emp_name", "report_date"] --
--    internal/DB-column-style names, not the real file's actual header text
--    ("Emp_Name", "Date"). validateRows() does an exact-string lookup, so
--    EVERY row failed with "emp_name and report_date are required" no
--    matter what sql/1756 fixed, because a column literally named
--    "emp_name" never existed in the real file to begin with.
-- 2. BB_CHAT_MASMIS's required_columns was ["ticket_id"] (lowercase) but
--    the real Chatwoot-style export's header is "Ticket ID" (Title Case) --
--    same failure mode. bb-chat-masmis-bulk.service.ts's own get() call
--    already anticipated "Ticket ID" as a fallback key; the catalog gate
--    just never allowed it through.
--
-- Also corrects optional_columns for APR (now the real Title-Case header
-- list from the attached sample, not the guessed snake_case list sql/1756
-- used) and CART (switches to BB_CART_HEADERS' own Title-Case list, which
-- is what bb-cart-masmis-bulk.service.ts's get() calls already check FIRST
-- -- sql/1756 mistakenly registered the snake_case fallback list instead).
-- SALE gets one addition: the real file's "E-Mail ID" header (capital M)
-- differs from the service's existing "E-mail ID" fallback by case alone.
--
-- CHAT's optional_columns here is a best-effort reading of a heavily
-- compressed sample image -- lower confidence than the other three. Kept
-- as an ADDITION (UNION) to what sql/1756 already registered, not a
-- replacement, so nothing already working regresses if a header was
-- misread.
UPDATE upload_template_master
   SET required_columns = JSON_ARRAY('Emp_Name', 'Date'),
       optional_columns = JSON_ARRAY(
         'Unique ID', 'Week', 'NOIID', 'No. of Calls/Chat', 'LOB', 'Login Time',
         'WAIT', 'TALK', 'DISPO', 'PAUSE', 'ACHT', 'Lunch', 'Tea', 'Tea1',
         'Washr', 'Team Briefing AUX', 'net_pause', 'Avg Dispo', 'Total Break',
         'Actual Login Hrs', 'Downtime', 'Login', 'Logout',
         'Net Login Hrs+DN+Briefing', 'Utilization', 'Attendance', 'Week 1',
         'MTD', 'Team Leader', 'FHD', 'Tenure', 'Tenurity Week', 'Sub Lob',
         'Unique Count', 'Attendence 2', 'Capping'
       )
 WHERE upload_type_code = 'BB_APR_MASMIS';

UPDATE upload_template_master
   SET required_columns = JSON_ARRAY('Ticket ID'),
       optional_columns = JSON_MERGE_PRESERVE(
         optional_columns,
         JSON_ARRAY(
           'Ticket Id#', 'Inbox Name', 'Assigned Agent', 'Contact Email',
           'Contact Phone Number', 'Conversation Created At', 'Assigned At',
           'First Response By Agent At', 'First Response Time',
           'Resolution Time At', 'Resolution Time', 'Average Response Time',
           'Is Resolved', 'Is Outside Business Hours', 'Chat Transcript Link',
           'Repeat Status', 'Repeat Status On Assign', 'Phone Number 1',
           'Current Agent', 'Chat Date', 'Emp ID', 'Week', 'Count',
           'Time Slot', 'Hour', 'TL Name', 'Disposition',
           'Day Shift/Night Shift', 'Unique ID', 'Fraud', 'User Type'
         )
       )
 WHERE upload_type_code = 'BB_CHAT_MASMIS';

UPDATE upload_template_master
   SET optional_columns = JSON_ARRAY(
     'CC', 'Source', 'SNo', 'Created At', 'Updated At', 'Customer Name',
     'Customer Address', 'Phone Number', 'Email ID', 'Line Items',
     'Variant Title', 'Abandoned Cart Link', 'Amount', 'Phone (10 Digit)',
     'Dates', 'Agent', 'Disposition', 'Sub Disposition', 'Call Date',
     'Same Day Connect', 'Status'
   )
 WHERE upload_type_code = 'BB_CART_MASMIS';

UPDATE upload_template_master
   SET optional_columns = JSON_MERGE_PRESERVE(optional_columns, JSON_ARRAY('E-Mail ID'))
 WHERE upload_type_code = 'BB_SALE_MASMIS';
