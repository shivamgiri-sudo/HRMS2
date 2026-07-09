-- Migration 372: Add name_on_cheque to candidate_onboarding_bank_detail
-- Safe to run multiple times (IF NOT EXISTS guard)

ALTER TABLE candidate_onboarding_bank_detail
  ADD COLUMN IF NOT EXISTS name_on_cheque VARCHAR(255) NULL
    COMMENT 'Name as printed on cancelled cheque — used for payroll HR name-match review'
  AFTER cancelled_cheque_document_id;
