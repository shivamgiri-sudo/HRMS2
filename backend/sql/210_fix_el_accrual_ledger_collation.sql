-- 210_fix_el_accrual_ledger_collation.sql
-- Fix collation mismatch between leave_el_accrual_ledger.employee_id (utf8mb4_0900_ai_ci)
-- and employees.id (utf8mb4_unicode_ci). This allows JOIN on these columns without error.
ALTER TABLE leave_el_accrual_ledger
  MODIFY employee_id CHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci
    COMMENT 'FK to employees.id — collation matches employees table';
