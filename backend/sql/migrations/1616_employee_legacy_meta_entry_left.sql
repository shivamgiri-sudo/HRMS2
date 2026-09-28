-- Migration 1616: employee_legacy_meta.entry_date + left_reason.
--
-- Two legacy fields (db_bill's EntryDate / LeftReason, matching this report's "EntryDate"/
-- "LeftRmks" columns) have no destination column anywhere in mas_hrms today — confirmed
-- 2026-09-11 while building the employee-master export's db_bill fallback: no table on the
-- mas_hrms side was ever built to hold either value. employee_legacy_meta is exactly the
-- table for this (it already holds every other db_bill-only field with no modern live
-- equivalent — father_name, passport_no, dl_no, box_file_no, document_done, etc.), so these
-- two are added here rather than starting a new table for two columns.
--
-- Purely additive (new columns, both nullable). Idempotent via information_schema guard.
-- Author: Claude Code, 2026-09-11

DELIMITER $$

DROP PROCEDURE IF EXISTS _m1616_employee_legacy_meta_entry_left $$
CREATE PROCEDURE _m1616_employee_legacy_meta_entry_left()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'employee_legacy_meta'
       AND COLUMN_NAME = 'entry_date'
  ) THEN
    ALTER TABLE employee_legacy_meta
      ADD COLUMN entry_date DATE NULL AFTER document_done,
      ADD COLUMN left_reason VARCHAR(255) NULL AFTER entry_date;
  END IF;
END $$

CALL _m1616_employee_legacy_meta_entry_left() $$
DROP PROCEDURE IF EXISTS _m1616_employee_legacy_meta_entry_left $$

DELIMITER ;
