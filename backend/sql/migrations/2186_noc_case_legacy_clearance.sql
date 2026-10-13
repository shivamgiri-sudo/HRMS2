-- Migration 2186: NOC cleared in the old system (db_bill)
--
-- db_bill recorded NOC validation (who, when, remarks) on the employee master. A leaver cleared there
-- must not show as pending in HRMS, so such a case is recorded as completed with its origin kept:
-- legacy_source ('db_bill'), legacy_validated_by, legacy_validated_at, legacy_remarks. A legacy case is
-- history, not a fresh sign-off, so it is not queued for the Payroll Head's final approval.
--
-- Additive, nullable, information_schema-guarded and idempotent. No existing row changes.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'noc_case' AND COLUMN_NAME = 'legacy_source');
SET @s := IF(@c = 0, 'ALTER TABLE noc_case ADD COLUMN legacy_source VARCHAR(40) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'noc_case' AND COLUMN_NAME = 'legacy_validated_by');
SET @s := IF(@c = 0, 'ALTER TABLE noc_case ADD COLUMN legacy_validated_by VARCHAR(120) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'noc_case' AND COLUMN_NAME = 'legacy_validated_at');
SET @s := IF(@c = 0, 'ALTER TABLE noc_case ADD COLUMN legacy_validated_at DATETIME NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'noc_case' AND COLUMN_NAME = 'legacy_remarks');
SET @s := IF(@c = 0, 'ALTER TABLE noc_case ADD COLUMN legacy_remarks VARCHAR(500) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
