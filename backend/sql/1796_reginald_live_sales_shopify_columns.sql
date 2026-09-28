-- Migration 1796: Reginald Men Live Sales uploader — accept the real Shopify export format.
--
-- Owner report, 2026-09-17: "this uploader is missing for reginald men dashboard in process
-- operation" — the file the owner actually has ("Reginald men - Live sales.xlsx", a direct
-- Shopify order export) uses different column headers than the REGINALD_ABANDONED_CART_SALES
-- template's required_columns (Order id / Amount / LOB, from the original Google Form export).
-- Uploading the real file failed frontend validation entirely: every column showed "Unknown
-- column" and all three required columns showed "required" (missing), because none of the
-- new file's headers matched.
--
-- Matching code change (reginald-abandoned-cart-sales-bulk.service.ts) already accepts either
-- header set with the old one tried first, so re-uploading a historical Google-Form-format
-- file still works exactly as before. This migration only widens what the FRONTEND accepts as
-- valid columns and what it demands as required, to actually let the new format through:
--   required_columns:  Order id/Amount/LOB (old) -> Shopify Order Name/Grand Total/Date (new,
--                       the format the owner will actually upload going forward). LOB dropped
--                       from required since the new format has no such column at all — the
--                       backend now infers it from Coupon Code's presence when absent.
--   optional_columns:  union of both formats' remaining columns, so neither an old-format
--                       re-upload nor a new-format upload gets "Unknown column" errors.
--   sample_row:         updated to the new format (a real anonymised-shape example).
--
-- Purely additive to role/page access; this only edits one upload_template_master row's
-- column lists and sample. Safe to re-run (values are fully replaced, not appended).

UPDATE upload_template_master
   SET required_columns = JSON_ARRAY('Shopify Order Name', 'Grand Total', 'Date'),
       optional_columns = JSON_ARRAY(
         'Timestamp', 'Order Date', 'Payment Type', 'Column 6', 'Order id ', 'Column 1', 'EMP ID',
         'Order id', 'Amount', 'LOB',
         'Number', 'Agent ID', 'Agents status', 'Coupon Code', 'Customer Name', 'Customer Phone', 'Billing State'
       ),
       sample_row = JSON_OBJECT(
         'Number', '8970481310',
         'Date', '1-Sep-26',
         'Agent ID', 'MAS61500',
         'Agents status', 'S ABHINAV',
         'Shopify Order Name', '#RM1152445',
         'Grand Total', '1169.1',
         'Coupon Code', 'MAS10',
         'Customer Name', 'Raksha .',
         'Customer Phone', '8970481310',
         'Billing State', 'KARNATAKA',
         'Payment Type', 'COD'
       ),
       updated_at = NOW()
 WHERE upload_type_code = 'REGINALD_ABANDONED_CART_SALES';

-- Verification (expect the new required/optional lists and sample above):
-- SELECT required_columns, optional_columns, sample_row FROM upload_template_master
--  WHERE upload_type_code = 'REGINALD_ABANDONED_CART_SALES';
