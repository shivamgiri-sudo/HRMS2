-- 422_vendor_payment_lob_bridge.sql
-- Provides a live, allocation-level vendor-payment view. The payment header remains
-- the cash/AP aggregate; GRN allocation lines remain the source of Process/LOB P&L attribution.

INSERT INTO vendor_payment_allocation
  (id, vendor_payment_id, grn_allocation_id, process_id, process_lob_id, cost_centre_id,
   pnl_bucket, recognition_period, pnl_cost_amount, gross_amount)
SELECT UUID(), vpt.id, a.id, a.process_id, a.process_lob_id, a.cost_centre_id,
       COALESCE(
         a.pnl_bucket,
         CASE WHEN a.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END
       ),
       COALESCE(
         a.recognition_period,
         vpt.recognition_period,
         DATE_FORMAT(COALESCE(vpt.due_date, vpt.payment_date, vpt.created_at), '%Y-%m')
       ),
       COALESCE(a.pnl_cost_amount, 0),
       COALESCE(a.amount_with_tax, 0)
  FROM vendor_payment_tracking vpt
  JOIN grn_cost_allocation a ON a.grn_request_id = vpt.grn_request_id
  LEFT JOIN vendor_payment_allocation existing
    ON existing.vendor_payment_id = vpt.id
   AND existing.grn_allocation_id = a.id
 WHERE existing.id IS NULL;

SET @cost_centre_name_expr = CASE
  WHEN (SELECT COUNT(*)
          FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'cost_centre_master'
           AND column_name = 'cost_centre_name') > 0
    THEN 'ccm.cost_centre_name'
  WHEN (SELECT COUNT(*)
          FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'cost_centre_master'
           AND column_name = 'cc_name') > 0
    THEN 'ccm.cc_name'
  ELSE 'NULL'
END;

SET @sql = CONCAT("CREATE OR REPLACE VIEW vw_vendor_payment_lob_allocation AS
SELECT
  vpt.id AS vendor_payment_id,
  vpt.grn_request_id,
  vpt.grn_number,
  vpt.vendor_id,
  vpt.vendor_name,
  vpt.branch_id,
  a.id AS grn_allocation_id,
  a.sequence_no,
  a.process_id,
  a.process_lob_id,
  a.cost_centre_id,
  pm.process_name,
  lob.lob_code,
  lob.lob_name,
  ", @cost_centre_name_expr, " AS cost_centre_name,
  COALESCE(
    a.pnl_bucket,
    CASE WHEN a.cost_class = 'direct' THEN 'dsc_non_people' ELSE 'bmc_non_people' END
  ) AS pnl_bucket,
  COALESCE(
    a.recognition_period,
    vpt.recognition_period,
    DATE_FORMAT(COALESCE(vpt.due_date, vpt.payment_date, vpt.created_at), '%Y-%m')
  ) AS recognition_period,
  COALESCE(a.pnl_cost_amount, 0) AS pnl_cost_amount,
  COALESCE(a.amount_with_tax, 0) AS gross_amount,
  vpt.due_amount AS payment_due_amount,
  vpt.paid_amount AS payment_paid_amount,
  vpt.balance_amount AS payment_balance_amount,
  vpt.payment_status,
  vpt.due_date,
  vpt.payment_date,
  GREATEST(
    COALESCE(a.updated_at, a.created_at),
    COALESCE(vpt.updated_at, vpt.created_at)
  ) AS freshness
FROM vendor_payment_tracking vpt
JOIN grn_cost_allocation a ON a.grn_request_id = vpt.grn_request_id
LEFT JOIN process_master pm ON pm.id = a.process_id
LEFT JOIN process_lob_master lob ON lob.id = a.process_lob_id
LEFT JOIN cost_centre_master ccm ON ccm.id = a.cost_centre_id");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '422_vendor_payment_lob_bridge.sql applied' AS migration_status;
