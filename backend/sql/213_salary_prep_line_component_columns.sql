-- Migration 213: Add missing component columns to salary_prep_line
-- basic, hra, special_allowance were calculated but never persisted.
-- tds_amount, lwp_deduction, advance_recovery were also missing.

ALTER TABLE salary_prep_line
  ADD COLUMN IF NOT EXISTS basic             DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER dialer_hours,
  ADD COLUMN IF NOT EXISTS hra               DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER basic,
  ADD COLUMN IF NOT EXISTS special_allowance DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER hra,
  ADD COLUMN IF NOT EXISTS tds_amount        DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER tds,
  ADD COLUMN IF NOT EXISTS lwp_deduction     DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER tds_amount,
  ADD COLUMN IF NOT EXISTS advance_recovery  DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER lwp_deduction;
