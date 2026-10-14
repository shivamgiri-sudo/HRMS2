-- Client billing: restore the legacy I-Spark invoicing sequence (2026-10-14).
--   Provision (create -> approve) -> Proforma -> Approve Proforma -> Invoice Approval (bill no) -> Download.
-- ADDITIVE ONLY. Every statement is guarded against re-run and against a missing table.
--   * client_invoice.proforma_approved_by/_at: first approval step. A proforma stays
--     invoice_status='proforma' until Invoice Approval mints the bill number, so nothing that
--     reads invoice_status changes meaning. NULL on every existing row (= not yet proforma-approved).
--   * client_invoice.invoice_type: legacy invoiceType (Revenue / Non Revenue). NULL on existing rows.
--   * client_provision: maker-checker columns. provision_status DEFAULTS to 'approved' so any row
--     that already exists stays usable for draw-down; new rows are inserted as 'pending' by the service.
--   * client_invoice_audit_log.action ENUM widened with 'proforma_approved' (existing values, same order).
--   * client_invoice_change_request / client_invoice_submission are converted to utf8mb4_unicode_ci
--     when they are not already. On prod both exist as utf8mb4_0900_ai_ci (they pre-dated 1975, whose
--     CREATE TABLE IF NOT EXISTS therefore never applied its COLLATE), so every join to client_invoice
--     (GET /change-requests, GET /change-requests/:id) fails with ER_CANT_AGGREGATE_2COLLATIONS.
--     Both tables are small (rows only from the P5 workflow); CONVERT keeps every value.
-- No existing row value is changed.
-- Rollback (manual, only if needed):
--   ALTER TABLE client_invoice DROP COLUMN proforma_approved_by, DROP COLUMN proforma_approved_at, DROP COLUMN invoice_type;
--   ALTER TABLE client_provision DROP COLUMN provision_status, DROP COLUMN remarks, DROP COLUMN created_by,
--     DROP COLUMN approved_by, DROP COLUMN approved_at, DROP COLUMN rejected_reason;
--   (audit-log ENUM widening is harmless to keep).

SET @add_client_invoice_proforma_approved_by = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice') = 1,
    "ALTER TABLE client_invoice ADD COLUMN proforma_approved_by CHAR(36) NULL",
    'SELECT 1 -- client_invoice.proforma_approved_by already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'proforma_approved_by'
);
PREPARE _stmt FROM @add_client_invoice_proforma_approved_by;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_proforma_approved_at = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice') = 1,
    "ALTER TABLE client_invoice ADD COLUMN proforma_approved_at DATETIME NULL",
    'SELECT 1 -- client_invoice.proforma_approved_at already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'proforma_approved_at'
);
PREPARE _stmt FROM @add_client_invoice_proforma_approved_at;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_invoice_type = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice') = 1,
    "ALTER TABLE client_invoice ADD COLUMN invoice_type VARCHAR(20) NULL",
    'SELECT 1 -- client_invoice.invoice_type already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'invoice_type'
);
PREPARE _stmt FROM @add_client_invoice_invoice_type;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_provision_status = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN provision_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved'",
    'SELECT 1 -- client_provision.provision_status already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'provision_status'
);
PREPARE _stmt FROM @add_client_provision_provision_status;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_remarks = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN remarks VARCHAR(500) NULL",
    'SELECT 1 -- client_provision.remarks already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'remarks'
);
PREPARE _stmt FROM @add_client_provision_remarks;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_created_by = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN created_by CHAR(36) NULL",
    'SELECT 1 -- client_provision.created_by already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'created_by'
);
PREPARE _stmt FROM @add_client_provision_created_by;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_approved_by = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN approved_by CHAR(36) NULL",
    'SELECT 1 -- client_provision.approved_by already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'approved_by'
);
PREPARE _stmt FROM @add_client_provision_approved_by;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_approved_at = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN approved_at DATETIME NULL",
    'SELECT 1 -- client_provision.approved_at already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'approved_at'
);
PREPARE _stmt FROM @add_client_provision_approved_at;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_rejected_reason = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN rejected_reason VARCHAR(500) NULL",
    'SELECT 1 -- client_provision.rejected_reason already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'rejected_reason'
);
PREPARE _stmt FROM @add_client_provision_rejected_reason;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_status_idx = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'provision_status') = 1,
    'ALTER TABLE client_provision ADD INDEX idx_cp_status (provision_status, finance_year, month_label)',
    'SELECT 1 -- idx_cp_status already exists (or column absent)'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND INDEX_NAME = 'idx_cp_status'
);
PREPARE _stmt FROM @add_client_provision_status_idx;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Widen the audit action ENUM only when 'proforma_approved' is not there yet.
SET @widen_audit_action_2196 = (
  SELECT IF(
    COUNT(*) = 1 AND MAX(COLUMN_TYPE) NOT LIKE '%proforma_approved%',
    "ALTER TABLE client_invoice_audit_log MODIFY COLUMN action ENUM('created','edited','approved','rejected','void_requested','void_approved','void_declined','status_change_requested','status_change_approved','status_change_declined','submitted_to_client','proforma_approved') NOT NULL",
    'SELECT 1 -- client_invoice_audit_log.action already widened (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice_audit_log' AND COLUMN_NAME = 'action'
);
PREPARE _stmt FROM @widen_audit_action_2196;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @fix_collation_client_invoice_change_request = (
  SELECT IF(
    COUNT(*) = 1 AND MAX(TABLE_COLLATION) <> 'utf8mb4_unicode_ci',
    'ALTER TABLE client_invoice_change_request CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    'SELECT 1 -- client_invoice_change_request already utf8mb4_unicode_ci (or table absent)'
  )
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice_change_request'
);
PREPARE _stmt FROM @fix_collation_client_invoice_change_request;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @fix_collation_client_invoice_submission = (
  SELECT IF(
    COUNT(*) = 1 AND MAX(TABLE_COLLATION) <> 'utf8mb4_unicode_ci',
    'ALTER TABLE client_invoice_submission CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    'SELECT 1 -- client_invoice_submission already utf8mb4_unicode_ci (or table absent)'
  )
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice_submission'
);
PREPARE _stmt FROM @fix_collation_client_invoice_submission;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
