-- Migration 1902: Fix employee_loans rows with status literally 'yes'
--
-- 1 row (employee MAS47814, legacy Loan, amount 200000, pending_amount 180000) carries
-- status='yes' -- a data-entry typo (employee_loans.status is a plain VARCHAR with no
-- ENUM/CHECK constraint, so any string can land there). Found live 2026-09-27 while
-- browser-verifying migration 1901 on this same employee's own account: the loan is
-- genuinely still being repaid but is invisible to both the "Active" and "Completed"
-- filters on /payroll/loans because 'yes' matches neither.
--
-- Use scripts/loan-yes-status-typo-fix.ts instead of running this raw UPDATE directly --
-- it does the same UPDATE but first writes one logSensitiveAction row per affected loan
-- capturing the pre-fix value. Dry-run by default; pass --apply to actually fix + write
-- the audit rows. This .sql file is kept for the migration manifest/history, not meant
-- to be run standalone.
--
-- Idempotent: WHERE status='yes' matches nothing once applied.

UPDATE employee_loans SET status = 'active'
 WHERE status = 'yes';
