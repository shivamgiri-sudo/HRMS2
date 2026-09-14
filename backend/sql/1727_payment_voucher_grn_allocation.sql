-- Payment Voucher: multi-GRN allocation for a single vendor.
--
-- One voucher can now cover several outstanding GRNs of the SAME vendor in one go, instead of
-- forcing Finance Head to raise a separate voucher per GRN. `payment_voucher.linked_vendor_payment_id`
-- is kept (set to the first/primary allocation) so every existing single-GRN read path — the
-- vouchers list join, the detail Purpose line — still resolves without a rewrite; the full set of
-- GRNs a voucher pays lives in this table and is what release() actually walks.

CREATE TABLE IF NOT EXISTS payment_voucher_grn_allocation (
  id CHAR(36) NOT NULL PRIMARY KEY,
  payment_voucher_id CHAR(36) NOT NULL,
  vendor_payment_tracking_id CHAR(36) NOT NULL,
  allocated_amount DECIMAL(14,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pvga_voucher (payment_voucher_id),
  KEY idx_pvga_grn (vendor_payment_tracking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
