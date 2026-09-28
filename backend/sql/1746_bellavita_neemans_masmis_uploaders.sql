-- No CREATE TABLE here. Registers upload_template_master entries only for
-- 9 Bellavita/Neemans upload types built per explicit user instruction
-- ("we will use the same database table just build the uploader in
-- HRMS"), continuing sql/1740's GNC Sale pattern. All 9 target tables
-- confirmed ALREADY LIVE on db_masmis (the separate My Dashboards tool's
-- own real database, github.com/tausifansari-mcn/Mydashboards) with real
-- schemas verified via SHOW COLUMNS before building each service --
-- unlike gnc_sale/gnc_apr, none of these 9 showed drift from that repo's
-- own code.
--
-- bb_sale (23,391 rows), bb_apr (4,961 rows), bvo_Repeat_cdr (153,679
-- rows), bb_cart (48,000 rows), bb_chat (154,399 rows), bvo_order_export
-- (3,050,861 rows) and neemans_sale_raw (3,800 rows)/neemans_allocation
-- (56,377 rows)/neemans_apr (132 rows) all carry real data, stale since
-- 2026-07/08 (My Dashboards' uploads stopped). bvo_repeat_allocation and
-- neemans_cart are confirmed genuinely never-used upload types (0 rows,
-- schema matches the doc exactly) -- registered anyway since the doc
-- describes them as real upload types, just ones nobody has used yet.
DELETE FROM upload_template_master WHERE upload_type_code IN (
  'BB_SALE_MASMIS', 'BB_APR_MASMIS', 'BVO_REPEAT_CDR_MASMIS', 'BVO_REPEAT_ALLOCATION_MASMIS',
  'BB_CART_MASMIS', 'BB_CHAT_MASMIS', 'BVO_ORDER_EXPORT_MASMIS',
  'NEEMANS_SALE_RAW_MASMIS', 'NEEMANS_ALLOCATION_MASMIS', 'NEEMANS_CART_MASMIS', 'NEEMANS_APR_MASMIS'
);

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'BB_SALE_MASMIS', 'Bellavita — Sale (writes to db_masmis.bb_sale)', 'db_masmis.bb_sale',
   'Bellavita''s real Sale sheet -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('Bella Vita Order ID', 'Date'),
   JSON_ARRAY('Week', 'EMP ID', 'Emp_Name', 'TL', 'Phone Number', 'Payment Status', 'Amount', 'Campaign', 'Calling Status'),
   JSON_OBJECT('Bella Vita Order ID', 'BVO379248102994', 'Date', '29-Jun-26', 'EMP ID', 'MAS57208', 'Amount', '1519.05'),
   1),
  (UUID(), 'BB_APR_MASMIS', 'Bellavita — APR (writes to db_masmis.bb_apr)', 'db_masmis.bb_apr',
   'Bellavita''s real Agent Productivity Report -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('emp_name', 'report_date'),
   JSON_ARRAY('unique_id', 'week', 'noiid', 'num_calls_chat', 'lob', 'login_time', 'talk_time', 'team_leader'),
   JSON_OBJECT('emp_name', 'Sagar', 'report_date', '2026-06-29', 'noiid', 'mas57208', 'num_calls_chat', '16'),
   1),
  (UUID(), 'BVO_REPEAT_CDR_MASMIS', 'Bellavita — Repeat CDR (writes to db_masmis.bvo_Repeat_cdr)', 'db_masmis.bvo_Repeat_cdr',
   'Bellavita''s real Repeat CDR export -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('PhoneNumber'),
   JSON_ARRAY('CallStatus', 'Agent'),
   JSON_OBJECT('PhoneNumber', '9876543210', 'CallStatus', 'Connected', 'Agent', 'MAS12345'),
   1),
  (UUID(), 'BVO_REPEAT_ALLOCATION_MASMIS', 'Bellavita — Repeat Allocation (writes to db_masmis.bvo_repeat_allocation)', 'db_masmis.bvo_repeat_allocation',
   'Bellavita''s real Repeat Allocation export -- writes into the same live table My Dashboards already uses (currently unused, 0 rows).',
   JSON_ARRAY('mobile_no'),
   JSON_ARRAY('unique_id', 'payment_mode', 'email', 'order_invoice_amount', 'order_id', 'product_name'),
   JSON_OBJECT('mobile_no', '9876543210', 'order_id', 'BVO123456'),
   1),
  (UUID(), 'BB_CART_MASMIS', 'Bellavita — Cart (writes to db_masmis.bb_cart)', 'db_masmis.bb_cart',
   'Bellavita''s real abandoned-cart follow-up export -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('Cart ID'),
   JSON_ARRAY('CC', 'Source', 'Customer Name', 'Phone Number', 'Amount', 'Agent', 'Disposition', 'Status'),
   JSON_OBJECT('Cart ID', 'CART123456', 'Customer Name', 'Test Customer', 'Amount', '999'),
   1),
  (UUID(), 'BB_CHAT_MASMIS', 'Bellavita — Chat (writes to db_masmis.bb_chat)', 'db_masmis.bb_chat',
   'Bellavita''s real Chatwoot ticket export -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('ticket_id'),
   JSON_ARRAY('inbox_name', 'ticket_status', 'agent_name', 'phone_number', 'created_at', 'disposition'),
   JSON_OBJECT('ticket_id', '12345', 'agent_name', 'Test Agent', 'ticket_status', 'Resolved'),
   1),
  (UUID(), 'BVO_ORDER_EXPORT_MASMIS', 'Bellavita — Shopify Order Export (writes to db_masmis.bvo_order_export)', 'db_masmis.bvo_order_export',
   'Bellavita''s real Shopify order export -- writes into the same live table My Dashboards already uses (3M+ rows, the largest table in this batch).',
   JSON_ARRAY('shipping_phone'),
   JSON_ARRAY('name', 'email', 'financial_status', 'total', 'discount_code', 'lineitem_name'),
   JSON_OBJECT('shipping_phone', '9876543210', 'name', 'BVO123456', 'total', '999'),
   1),
  (UUID(), 'NEEMANS_SALE_RAW_MASMIS', 'Neemans — Sale Raw (writes to db_masmis.neemans_sale_raw)', 'db_masmis.neemans_sale_raw',
   'Neemans'' real Sale Raw sheet -- writes into the same live table My Dashboards already uses. Note: "date" is stored as a raw, unconverted Excel serial (matches existing real data).',
   JSON_ARRAY('orderId'),
   JSON_ARRAY('week', 'date', 'empId', 'name', 'tl', 'lob', 'amount', 'paymentStatus', 'callingStatus'),
   JSON_OBJECT('orderId', 'NM22300357348', 'date', '46215', 'empId', 'MAS62502', 'amount', '1799.10'),
   1),
  (UUID(), 'NEEMANS_ALLOCATION_MASMIS', 'Neemans — Allocation (writes to db_masmis.neemans_allocation)', 'db_masmis.neemans_allocation',
   'Neemans'' real Allocation export -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('phone'),
   JSON_ARRAY('email', 'customerName', 'productTitle', 'amount', 'agent', 'callingStatus'),
   JSON_OBJECT('phone', '9876543210', 'customerName', 'Test Customer', 'amount', '999'),
   1),
  (UUID(), 'NEEMANS_CART_MASMIS', 'Neemans — Cart (writes to db_masmis.neemans_cart)', 'db_masmis.neemans_cart',
   'Neemans'' real Cart export -- writes into the same live table My Dashboards already uses (currently unused, 0 rows).',
   JSON_ARRAY('cartId'),
   JSON_ARRAY('customerName', 'phoneNumber', 'amount', 'agent', 'disposition', 'status'),
   JSON_OBJECT('cartId', 'CART123456', 'customerName', 'Test Customer'),
   1),
  (UUID(), 'NEEMANS_APR_MASMIS', 'Neemans — APR (writes to db_masmis.neemans_apr)', 'db_masmis.neemans_apr',
   'Neemans'' real Agent Productivity Report -- writes into the same live table My Dashboards already uses.',
   JSON_ARRAY('empName'),
   JSON_ARRAY('uniqueId', 'week', 'date', 'empId', 'calls', 'lob', 'loginTime', 'teamLeader'),
   JSON_OBJECT('empName', 'Test Agent', 'date', '46215', 'calls', '10'),
   1);
