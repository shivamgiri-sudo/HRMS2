-- Migration 1797: Corrective fix — REGINALD_ABANDONED_CART_SALES optional_columns.
--
-- Migration 1796 set optional_columns to the UNION of both the old Google-Form format and
-- the new Shopify-export format. That breaks upload of EITHER format: BulkUploadHub's own
-- csvHealthHasBlockingError() treats every column in required_columns + optional_columns as
-- a header that MUST be present in the uploaded file (missingHeaders.length > 0 blocks the
-- upload outright) — "optional" here means "may be blank", not "may be absent from the
-- header row". Live-tested uploading the real "Reginald men - Live sales.xlsx": blocked with
-- "CSV structure issue found" because it naturally has none of the old format's 9 columns
-- (Timestamp, Order Date, Column 6, "Order id " x2, Column 1, EMP ID, Amount, LOB).
--
-- Fix: optional_columns now lists only the new Shopify-export format's own remaining
-- columns. The old Google-Form format is not actively produced any more (the table's last
-- row via that path is 2026-09-09) — its columns stay supported for re-import at the
-- SERVICE level (reginald-abandoned-cart-sales-bulk.service.ts tries old-format headers
-- first, new-format as fallback) but are no longer declared as template columns, so a
-- new-format upload is not blocked waiting for headers that will never be there.
--
-- Safe to re-run (value fully replaced).

UPDATE upload_template_master
   SET optional_columns = JSON_ARRAY(
         'Number', 'Agent ID', 'Agents status', 'Coupon Code',
         'Customer Name', 'Customer Phone', 'Billing State', 'Payment Type'
       ),
       updated_at = NOW()
 WHERE upload_type_code = 'REGINALD_ABANDONED_CART_SALES';

-- Verification (expect exactly the 8 new-format columns above):
-- SELECT optional_columns FROM upload_template_master
--  WHERE upload_type_code = 'REGINALD_ABANDONED_CART_SALES';
