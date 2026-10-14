-- Client billing: unique document numbers where the existing data allows it (audit 2026-10-14).
-- Index-only, so a metadata-lock timeout defers it to the next boot instead of failing startup.
--   * client_credit_note.credit_no: UNIQUE (NULL allowed: drafts carry no number until approval).
--   * client_invoice.proforma_no: UNIQUE.
-- Each index is added only when it is missing AND the column has no duplicate non-NULL value
-- today (I-Spark history carries date-stamp credit numbers that repeat). When duplicates exist the
-- index is skipped and the numbering counters + the approval-time duplicate check stay the guard.
-- client_invoice.bill_no is deliberately NOT made unique: I-Spark history has known duplicates.
-- Rollback (manual): ALTER TABLE client_credit_note DROP INDEX uq_ccn_credit_no;
--   ALTER TABLE client_invoice DROP INDEX uq_ci_proforma_no.

SET @add_uq_ccn_credit_no = (
  SELECT IF(
    COUNT(*) = 0
      AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_credit_note') = 1
      AND (SELECT COUNT(*) FROM (SELECT credit_no FROM client_credit_note WHERE credit_no IS NOT NULL GROUP BY credit_no HAVING COUNT(*) > 1) d) = 0,
    'ALTER TABLE client_credit_note ADD UNIQUE INDEX uq_ccn_credit_no (credit_no)',
    'SELECT 1 -- uq_ccn_credit_no exists, table absent, or duplicate credit numbers present'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_credit_note' AND INDEX_NAME = 'uq_ccn_credit_no'
);
PREPARE _stmt FROM @add_uq_ccn_credit_no;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_uq_ci_proforma_no = (
  SELECT IF(
    COUNT(*) = 0
      AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice') = 1
      AND (SELECT COUNT(*) FROM (SELECT proforma_no FROM client_invoice WHERE proforma_no IS NOT NULL GROUP BY proforma_no HAVING COUNT(*) > 1) d) = 0,
    'ALTER TABLE client_invoice ADD UNIQUE INDEX uq_ci_proforma_no (proforma_no)',
    'SELECT 1 -- uq_ci_proforma_no exists, table absent, or duplicate proforma numbers present'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND INDEX_NAME = 'uq_ci_proforma_no'
);
PREPARE _stmt FROM @add_uq_ci_proforma_no;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
