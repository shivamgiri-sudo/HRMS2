-- Migration 397: Add loan_emi column to salary_prep_line for employee loan deductions
ALTER TABLE salary_prep_line
  ADD COLUMN IF NOT EXISTS loan_emi DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER advance_recovery;
