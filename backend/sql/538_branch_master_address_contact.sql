-- 538_branch_master_address_contact.sql
-- Adds address and hr_contact columns to branch_master for ID card display.

USE mas_hrms;

ALTER TABLE branch_master
  ADD COLUMN IF NOT EXISTS address    VARCHAR(500) NULL AFTER state,
  ADD COLUMN IF NOT EXISTS hr_contact VARCHAR(100) NULL AFTER address;

SELECT 'Migration 538 applied: branch_master.address and hr_contact added' AS status;
