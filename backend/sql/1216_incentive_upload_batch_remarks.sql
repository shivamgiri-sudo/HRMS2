-- Migration 1216: add incentive_upload_batch.remarks, which createBatch has always tried to write.
--
-- WHY THIS IS NEEDED
--   incentives.service.ts createBatch() issues
--     INSERT INTO incentive_upload_batch (id, incentive_id, pay_month, uploaded_by, remarks)
--   and `remarks` does not exist on the table. Verified live 2026-08-14 against mas_hrms: the
--   columns are id, incentive_id, batch_ref, salary_month, uploaded_by, branch_id, process_id,
--   total_employees, total_amount, status, approval_chain, current_approval_step,
--   payroll_register_id, created_at, updated_at, pay_month, cost_centre_id. No remarks.
--
--   The INSERT is not wrapped in a catch, so it raises ER_BAD_FIELD_ERROR and POST
--   /api/incentives/batches fails outright. **No incentive batch can be created by any caller.**
--
-- WHY IT MATTERS BEYOND ONE ENDPOINT
--   This is very likely the reason the whole incentive pipeline reads as "built but never used".
--   incentive_upload_batch, incentive_upload_line, incentive_approval_step and
--   incentive_payroll_register all hold 0 rows, and salary_prep_line.incentive_total is 0.00
--   across all 80,469 payroll lines ever written — while db_bill paid Rs 12,91,754 of incentive
--   in June 2026 alone. The pipeline was not bypassed by preference; its front door throws.
--
--   Found by a PREPARE-based sweep of every SQL literal in backend/src against the live schema,
--   the same technique that surfaced employee_reimbursement_claim.claim_amount and
--   salary_prep_run.incentives_applied_at.
--
-- WHY ADD THE COLUMN RATHER THAN DROP IT FROM THE INSERT
--   Dropping it would silently discard a value the API accepts, the service signature declares
--   (remarks?: string | null) and getBatchById returns via SELECT iub.* — so a caller would see
--   their note vanish with no error. The column is the honest repair; nothing else on the table
--   carries the same meaning (batch_ref is a human-readable reference, not a note).
--
-- ADDITIVE AND IDEMPOTENT
--   TEXT NULL with no default, guarded on information_schema. Existing rows are unaffected — and
--   there are none. No payroll figure is read or written.
--
-- ROLLBACK:
--   ALTER TABLE incentive_upload_batch DROP COLUMN remarks;

SET @c_remarks = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'incentive_upload_batch'
     AND COLUMN_NAME = 'remarks'
);
SET @sql = IF(@c_remarks = 0,
  'ALTER TABLE incentive_upload_batch ADD COLUMN remarks TEXT NULL COMMENT ''Free-text note supplied when the batch was created''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
