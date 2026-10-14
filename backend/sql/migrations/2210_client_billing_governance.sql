-- Client billing governance (audit 2026-10-14): maker-checker, PO approval, credit-note reject,
-- provision audit, receipt / GRN audit actions, normalised bill / credit-note counters.
-- Guarded and idempotent: every ALTER runs only when its column / value is missing, tables are
-- CREATE TABLE IF NOT EXISTS, and the two data steps only touch rows that still need them.
--   * client_po_number: approval_status ('approved' for every existing PO), approved_amount (the
--     last approved PO amount, NULL on existing rows = their current amount), approval_requested_by,
--     approval_decided_by / _at, approval_note. New POs and amount increases start 'pending'.
--   * client_credit_note: credit_status gains 'rejected'; rejected_by / rejected_at / rejected_reason.
--   * client_credit_note_audit: create / approve / reject history of a credit note.
--   * client_provision: rejected_by / rejected_at (reject no longer writes approved_by). Existing
--     rejected rows are moved over: approved_by/_at -> rejected_by/_at where rejected_by is NULL.
--   * client_provision_audit: create / edit / approve / reject history of a provision.
--   * client_invoice_audit_log.action gains receipt_recorded, receipt_voided, grn_changed.
--   * client_invoice: approved_by / approved_at for step 2 (bill number minted). NULL on existing
--     rows (nothing backfilled); set by approveInvoice from now on.
--   * client_invoice_number_sequence: bill and credit_note counters keyed by a normalised company
--     name (lower case, no spaces / dots / commas). Each normalised key takes the MAX of the raw
--     keys that fold into it; raw-key rows are kept (no longer read).
-- Rollback (manual): DROP TABLE client_credit_note_audit, client_provision_audit;
--   ALTER TABLE client_po_number DROP COLUMN approval_status, DROP COLUMN approved_amount,
--     DROP COLUMN approval_requested_by, DROP COLUMN approval_decided_by, DROP COLUMN approval_decided_at,
--     DROP COLUMN approval_note;
--   ALTER TABLE client_credit_note DROP COLUMN rejected_by, DROP COLUMN rejected_at, DROP COLUMN rejected_reason;
--   ALTER TABLE client_provision DROP COLUMN rejected_by, DROP COLUMN rejected_at;
--   ALTER TABLE client_invoice DROP COLUMN approved_by, DROP COLUMN approved_at.
--   The normalised counter rows can stay (raising a counter never re-issues a number).

CREATE TABLE IF NOT EXISTS client_credit_note_audit (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  credit_note_id  CHAR(36)      NOT NULL,
  invoice_id      CHAR(36)      NULL,
  action          VARCHAR(30)   NOT NULL,
  actor_id        CHAR(36)      NULL,
  reason          VARCHAR(2000) NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ccna_note (credit_note_id, created_at),
  KEY idx_ccna_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_provision_audit (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  provision_id  CHAR(36)      NOT NULL,
  action        VARCHAR(30)   NOT NULL,
  actor_id      CHAR(36)      NULL,
  details       VARCHAR(2000) NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cpva_provision (provision_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @add_cpn_approval = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_po_number') = 1,
    "ALTER TABLE client_po_number ADD COLUMN approval_status ENUM('approved','pending','rejected') NOT NULL DEFAULT 'approved', ADD COLUMN approved_amount DECIMAL(14,2) NULL, ADD COLUMN approval_requested_by CHAR(36) NULL, ADD COLUMN approval_decided_by CHAR(36) NULL, ADD COLUMN approval_decided_at DATETIME NULL, ADD COLUMN approval_note VARCHAR(500) NULL",
    'SELECT 1 -- client_po_number approval columns already exist (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_po_number' AND COLUMN_NAME = 'approval_status'
);
PREPARE _stmt FROM @add_cpn_approval;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @widen_ccn_status = (
  SELECT IF(
    COUNT(*) = 1 AND MAX(COLUMN_TYPE) NOT LIKE '%rejected%',
    "ALTER TABLE client_credit_note MODIFY COLUMN credit_status ENUM('draft','approved','rejected') NOT NULL DEFAULT 'draft'",
    'SELECT 1 -- client_credit_note.credit_status already has rejected (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_credit_note' AND COLUMN_NAME = 'credit_status'
);
PREPARE _stmt FROM @widen_ccn_status;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_ccn_rejected = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_credit_note') = 1,
    "ALTER TABLE client_credit_note ADD COLUMN rejected_by CHAR(36) NULL, ADD COLUMN rejected_at DATETIME NULL, ADD COLUMN rejected_reason VARCHAR(500) NULL",
    'SELECT 1 -- client_credit_note reject columns already exist (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_credit_note' AND COLUMN_NAME = 'rejected_by'
);
PREPARE _stmt FROM @add_ccn_rejected;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_cp_rejected = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN rejected_by CHAR(36) NULL, ADD COLUMN rejected_at DATETIME NULL",
    'SELECT 1 -- client_provision reject columns already exist (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'rejected_by'
);
PREPARE _stmt FROM @add_cp_rejected;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_ci_approved = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice') = 1,
    "ALTER TABLE client_invoice ADD COLUMN approved_by CHAR(36) NULL, ADD COLUMN approved_at DATETIME NULL",
    'SELECT 1 -- client_invoice.approved_by already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'approved_by'
);
PREPARE _stmt FROM @add_ci_approved;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Rejected provisions used to carry the rejecter in approved_by / approved_at. Move it over once.
UPDATE client_provision
SET rejected_by = approved_by, rejected_at = approved_at, approved_by = NULL, approved_at = NULL
WHERE provision_status = 'rejected' AND rejected_by IS NULL AND approved_by IS NOT NULL;

SET @widen_audit_action_2210 = (
  SELECT IF(
    COUNT(*) = 1 AND MAX(COLUMN_TYPE) NOT LIKE '%receipt_recorded%',
    "ALTER TABLE client_invoice_audit_log MODIFY COLUMN action ENUM('created','edited','approved','rejected','void_requested','void_approved','void_declined','status_change_requested','status_change_approved','status_change_declined','submitted_to_client','proforma_approved','po_approved','grn_added','receipt_recorded','receipt_voided','grn_changed') NOT NULL",
    'SELECT 1 -- client_invoice_audit_log.action already widened (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice_audit_log' AND COLUMN_NAME = 'action'
);
PREPARE _stmt FROM @widen_audit_action_2210;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Fold raw-company counters into the normalised key (state|company|fy, company lower case with
-- spaces, dots and commas removed), keeping the highest number already issued. Re-running only
-- re-applies GREATEST, so it is a no-op the second time.
INSERT INTO client_invoice_number_sequence (kind, scope_key, `last_value`, updated_at)
SELECT agg.kind, agg.norm_key, agg.max_value, NOW()
FROM (
  SELECT s.kind,
         CONCAT(
           SUBSTRING_INDEX(s.scope_key, '|', 1), '|',
           LOWER(REPLACE(REPLACE(REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(s.scope_key, '|', 2), '|', -1), ' ', ''), '.', ''), ',', '')), '|',
           SUBSTRING_INDEX(s.scope_key, '|', -1)
         ) AS norm_key,
         MAX(s.`last_value`) AS max_value
  FROM client_invoice_number_sequence s
  WHERE s.kind IN ('bill', 'credit_note')
    AND (LENGTH(s.scope_key) - LENGTH(REPLACE(s.scope_key, '|', ''))) = 2
  GROUP BY s.kind, norm_key
) agg
ON DUPLICATE KEY UPDATE `last_value` = GREATEST(client_invoice_number_sequence.`last_value`, agg.max_value), updated_at = NOW();
