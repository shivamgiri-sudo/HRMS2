-- BB_CART_MASMIS's real export format is entirely different from what sql/1746
-- and sql/1756 assumed (BB_CART_HEADERS in bb-cart-masmis-bulk.service.ts, taken
-- from the My Dashboards repo's older code). The user's actual sample file, read
-- directly from the app's own diagnostic error message (not a screenshot guess),
-- shows the cart identity column is literally named "ID", not "Cart ID" -- so
-- required_columns rejected every single row before it ever reached the importer.
--
-- Also fixes 3 near-miss real headers: "Line items"/"Variant title" (lowercase
-- second word), "Sub Dispotion" (a genuine typo in the real export, missing an
-- "s"), and "Phone Number (10 Digit)" (not "Phone (10 Digit)").
--
-- optional_columns now lists every real column from the sample file, including
-- ~17 marketing/UTM columns (Discount Total, Drop Stage, Drop Off Reasons, UTM
-- Source/Campaign/Medium, Origin Referrer, Landing Page, Store Source/Platform,
-- Automatic Discount Code, Customer Type - Gokwik/Merchant, MRP Total, Platform,
-- Risk Flag) that db_masmis.bb_cart has no column for -- these are accepted so
-- they are not flagged as unknown, but bb-cart-masmis-bulk.service.ts's get()
-- calls do not read them, so they are safely ignored rather than stored.
UPDATE upload_template_master
   SET required_columns = JSON_ARRAY('ID'),
       optional_columns = JSON_ARRAY(
         'CC.', 'Source', 'S.no', 'Created At', 'Updated At', 'Customer Name',
         'Customer Address', 'Phone Number', 'Email ID', 'Line items',
         'Variant title', 'Abandoned Cart Link', 'Amount', 'Discount Total',
         'Drop Stage', 'Drop Off Reasons', 'Comment', 'Utm Source',
         'Utm Campaign', 'Utm Medium', 'Discount Code', 'Origin Referrer',
         'Landing Page', 'Store Source', 'Store Platform',
         'Automatic Discount Code', 'Customer Type - Gokwik',
         'Customer Type - Merchant', 'MRP Total', 'Platform', 'Risk Flag',
         'Phone Number (10 Digit)', 'Dates', 'Agent', 'Disposition',
         'Sub Dispotion', 'Call Date', 'Same Day Connect', 'Status'
       )
 WHERE upload_type_code = 'BB_CART_MASMIS';
