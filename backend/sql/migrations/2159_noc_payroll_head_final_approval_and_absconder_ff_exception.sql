-- Migration 2159: Payroll Head final approval of a completed NOC + absconder F&F exception
--
-- 1. noc_case: payroll_head_approved_by / _at / _note. A NOC whose every level has cleared is
--    not yet release-ready for F&F settlement: it waits for ONE explicit Payroll Head approval,
--    recorded here, distinct from override_* (which releases WITHOUT a completed clearance).
--    Gate is date-driven by payroll_config_flags.noc_ph_final_approval_from; absent = inert.
--
-- 2. exit_request: ff_exception_by / _at / _reason. F&F is not allowed for absconded employees;
--    the only way past that is a recorded Payroll Head exception on the exit request. Everything
--    after the exception (NOC, Payroll Head NOC approval, F&F approval, payment) runs as-is.
--
-- Additive, nullable, information_schema-guarded and idempotent. No existing row changes.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'noc_case' AND COLUMN_NAME = 'payroll_head_approved_by');
SET @s := IF(@c = 0, 'ALTER TABLE noc_case ADD COLUMN payroll_head_approved_by CHAR(36) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'noc_case' AND COLUMN_NAME = 'payroll_head_approved_at');
SET @s := IF(@c = 0, 'ALTER TABLE noc_case ADD COLUMN payroll_head_approved_at DATETIME NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'noc_case' AND COLUMN_NAME = 'payroll_head_approval_note');
SET @s := IF(@c = 0, 'ALTER TABLE noc_case ADD COLUMN payroll_head_approval_note VARCHAR(500) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'ff_exception_by');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN ff_exception_by CHAR(36) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'ff_exception_at');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN ff_exception_at DATETIME NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'ff_exception_reason');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN ff_exception_reason VARCHAR(500) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
