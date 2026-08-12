-- 1132_salary_prep_line_reimbursement_total.sql
--
-- Adds salary_prep_line.reimbursement_total, which payrollCalculate.service.ts has written to
-- on every targeted recalculation since commit 0840dfe1 without a migration ever creating it.
--
-- CONSEQUENCE, VERIFIED LIVE 2026-08-12
--
-- Every call to the targeted-recalculation write path (triggerPostSyncPayrollRecalc ->
-- queuePayrollRecalculation -> drainPayrollRecalcQueue) fails with
-- ER_BAD_FIELD_ERROR: Unknown column 'reimbursement_total' in 'field list' the moment it
-- reaches the INSERT ... ON DUPLICATE KEY UPDATE in payrollCalculate.service.ts (~line 1371).
-- Reproduced against production by triggering a recalculation for 130 employees whose
-- attendance had just been backfilled: 130/130 failed with this exact error, and their
-- salary_prep_line rows were never written.
--
-- This is NOT limited to that cohort. Any attendance correction, dispute resolution, or
-- other event that drives a targeted recalculation while a payroll run is open hits the same
-- failure, for any employee, in any month. The original bulk run-generation path is
-- unaffected (it does not write this column), which is why the July run's original 1,464
-- lines exist and look fine — this only breaks the recalculation-after-the-fact path.
--
-- SHAPE
--
-- Matches incentive_total, the column immediately preceding it in every INSERT/UPDATE that
-- references it (see line ~1370 and ~1395 of payrollCalculate.service.ts) — same type, same
-- NOT NULL + DEFAULT 0 shape, so an employee with no approved reimbursements for the month
-- reads as 0.00, not NULL.
--
-- Nothing here changes payroll arithmetic. It closes a schema gap the code already assumed
-- existed; the value it will hold (approved_reimbursements, computed a few lines earlier in
-- the same function) is unchanged by this migration.
--
-- Idempotent and additive: guarded by information_schema so re-running is a no-op.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'salary_prep_line'
     AND column_name = 'reimbursement_total'
);

SET @ddl = IF(@col_exists = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN reimbursement_total DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER incentive_total',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
