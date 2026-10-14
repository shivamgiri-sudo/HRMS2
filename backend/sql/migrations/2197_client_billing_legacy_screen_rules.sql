-- Client billing: remaining I-Spark screen rules, confirmed against live db_bill (2026-10-14 probe).
-- ADDITIVE ONLY, guarded, idempotent. No existing row is updated.
--   * client_invoice.apply_tax_calc  = legacy tbl_invoice.app_tax_cal. 0 = no tax at all even when
--     Apply GST is ticked (49 legacy invoices this FY). DEFAULT 1 keeps every existing row as it is.
--   * client_invoice.po_approved(_by/_at) = legacy approve_po ("Approve PO" menu; 56 invoices this FY).
--   * client_provision.invoice_type = legacy provision_master.invoiceType1 (Revenue / Non Revenue).
--   * client_provision.edit_* = a pending edit of an APPROVED provision, applied only when a second
--     person approves it (legacy provision_master_edit_request, 3,878 rows).
-- Rollback (manual): ALTER TABLE client_invoice DROP COLUMN apply_tax_calc, DROP COLUMN po_approved,
--   DROP COLUMN po_approved_by, DROP COLUMN po_approved_at; ALTER TABLE client_provision DROP COLUMN
--   invoice_type, DROP COLUMN edit_amount, DROP COLUMN edit_remarks, DROP COLUMN edit_requested_by,
--   DROP COLUMN edit_requested_at.

SET @add_client_invoice_apply_tax_calc = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice') = 1,
    "ALTER TABLE client_invoice ADD COLUMN apply_tax_calc TINYINT(1) NOT NULL DEFAULT 1",
    'SELECT 1 -- client_invoice.apply_tax_calc already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'apply_tax_calc'
);
PREPARE _stmt FROM @add_client_invoice_apply_tax_calc;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_po_approved = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice') = 1,
    "ALTER TABLE client_invoice ADD COLUMN po_approved TINYINT(1) NOT NULL DEFAULT 0",
    'SELECT 1 -- client_invoice.po_approved already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'po_approved'
);
PREPARE _stmt FROM @add_client_invoice_po_approved;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_po_approved_by = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice') = 1,
    "ALTER TABLE client_invoice ADD COLUMN po_approved_by CHAR(36) NULL",
    'SELECT 1 -- client_invoice.po_approved_by already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'po_approved_by'
);
PREPARE _stmt FROM @add_client_invoice_po_approved_by;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_po_approved_at = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice') = 1,
    "ALTER TABLE client_invoice ADD COLUMN po_approved_at DATETIME NULL",
    'SELECT 1 -- client_invoice.po_approved_at already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'po_approved_at'
);
PREPARE _stmt FROM @add_client_invoice_po_approved_at;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_invoice_type = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN invoice_type VARCHAR(20) NOT NULL DEFAULT 'Revenue'",
    'SELECT 1 -- client_provision.invoice_type already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'invoice_type'
);
PREPARE _stmt FROM @add_client_provision_invoice_type;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_edit_amount = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN edit_amount DECIMAL(14,2) NULL",
    'SELECT 1 -- client_provision.edit_amount already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'edit_amount'
);
PREPARE _stmt FROM @add_client_provision_edit_amount;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_edit_remarks = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN edit_remarks VARCHAR(500) NULL",
    'SELECT 1 -- client_provision.edit_remarks already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'edit_remarks'
);
PREPARE _stmt FROM @add_client_provision_edit_remarks;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_edit_requested_by = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN edit_requested_by CHAR(36) NULL",
    'SELECT 1 -- client_provision.edit_requested_by already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'edit_requested_by'
);
PREPARE _stmt FROM @add_client_provision_edit_requested_by;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_edit_requested_at = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN edit_requested_at DATETIME NULL",
    'SELECT 1 -- client_provision.edit_requested_at already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'edit_requested_at'
);
PREPARE _stmt FROM @add_client_provision_edit_requested_at;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Widen the audit action ENUM with the PO / GRN steps.
SET @widen_audit_action_2197 = (
  SELECT IF(
    COUNT(*) = 1 AND MAX(COLUMN_TYPE) NOT LIKE '%po_approved%',
    "ALTER TABLE client_invoice_audit_log MODIFY COLUMN action ENUM('created','edited','approved','rejected','void_requested','void_approved','void_declined','status_change_requested','status_change_approved','status_change_declined','submitted_to_client','proforma_approved','po_approved','grn_added') NOT NULL",
    'SELECT 1 -- client_invoice_audit_log.action already widened (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice_audit_log' AND COLUMN_NAME = 'action'
);
PREPARE _stmt FROM @widen_audit_action_2197;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
