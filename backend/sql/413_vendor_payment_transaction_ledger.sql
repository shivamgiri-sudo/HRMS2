-- 413_vendor_payment_transaction_ledger.sql
-- Preserves every vendor payment installment/UTR while keeping the existing
-- vendor_payment_tracking table as the aggregate read model.

CREATE TABLE IF NOT EXISTS vendor_payment_transaction (
  id CHAR(36) NOT NULL PRIMARY KEY,
  vendor_payment_id CHAR(36) NOT NULL,
  grn_request_id CHAR(36) NOT NULL,
  sequence_no INT NOT NULL,
  payment_mode ENUM('Cheque','NEFT','RTGS','IMPS','UPI','Cash','Bank Transfer','Adjustment','Other') NOT NULL,
  payment_date DATE NOT NULL,
  bank_id CHAR(36) NULL,
  bank_name VARCHAR(255) NULL,
  transaction_id VARCHAR(255) NULL,
  amount DECIMAL(12,2) NOT NULL,
  remarks TEXT NULL,
  proof_file_name VARCHAR(500) NULL,
  proof_file_path VARCHAR(1000) NULL,
  proof_file_mime VARCHAR(100) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vendor_payment_transaction_sequence (vendor_payment_id, sequence_no),
  INDEX idx_vptx_vendor_payment (vendor_payment_id, created_at),
  INDEX idx_vptx_grn (grn_request_id),
  INDEX idx_vptx_transaction_id (transaction_id),
  INDEX idx_vptx_payment_date (payment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill one historical transaction per already-paid aggregate row. This is
-- intentionally idempotent and does not alter the existing parent totals.
INSERT INTO vendor_payment_transaction (
  id,
  vendor_payment_id,
  grn_request_id,
  sequence_no,
  payment_mode,
  payment_date,
  bank_id,
  bank_name,
  transaction_id,
  amount,
  remarks,
  proof_file_name,
  proof_file_path,
  proof_file_mime,
  created_by,
  created_at
)
SELECT
  UUID(),
  v.id,
  v.grn_request_id,
  1,
  COALESCE(v.payment_mode, 'Other'),
  COALESCE(v.payment_date, DATE(v.updated_at), DATE(v.created_at)),
  v.bank_id,
  v.bank_name,
  v.transaction_id,
  v.paid_amount,
  CONCAT('Historical aggregate backfill', CASE WHEN v.remarks IS NULL OR v.remarks = '' THEN '' ELSE CONCAT(': ', v.remarks) END),
  v.payment_proof_file_name,
  v.payment_proof_file_path,
  v.payment_proof_file_mime,
  COALESCE(v.updated_by, 'system'),
  COALESCE(v.updated_at, v.created_at, NOW())
FROM vendor_payment_tracking v
WHERE v.paid_amount > 0
  AND NOT EXISTS (
    SELECT 1
      FROM vendor_payment_transaction t
     WHERE t.vendor_payment_id = v.id
  );

SELECT '413_vendor_payment_transaction_ledger.sql applied' AS migration_status;
