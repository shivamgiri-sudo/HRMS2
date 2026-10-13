-- Migration 2189: absconder pay hold is requested by the reporting manager, approved and released by the
-- branch Payroll HR only
--
-- Replaces the Branch Head / Payroll Head release for SALARY (the F&F exception for absconders keeps its own
-- Branch Head -> Payroll Head chain, ff_exception_bh_* / ff_exception_*, untouched).
--   pay_hold_requested_*  the reporting manager's request and reason (pay_hold_at, from 2188, is now the
--                          moment the branch Payroll HR approved it, i.e. when the days became 0)
--   pay_hold_released_*   the branch Payroll HR lifting the hold; days return
-- Events gain hold_requested, hold_request_rejected and hold_released.
--
-- Additive and idempotent. No existing row changes.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_hold_requested_at');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN pay_hold_requested_at DATETIME NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_hold_requested_by');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN pay_hold_requested_by CHAR(36) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_hold_requested_reason');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN pay_hold_requested_reason VARCHAR(500) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_hold_released_at');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN pay_hold_released_at DATETIME NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_hold_released_by');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN pay_hold_released_by CHAR(36) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_hold_released_reason');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN pay_hold_released_reason VARCHAR(500) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'absconder_pay_release_event' AND COLUMN_NAME = 'action' AND COLUMN_TYPE LIKE '%hold_released%');
SET @s := IF(@c = 0,
  'ALTER TABLE absconder_pay_release_event MODIFY COLUMN action ENUM(''requested'',''bh_approved'',''bh_rejected'',''ph_approved'',''ph_rejected'',''re_requested'',''hold_placed'',''hold_withdrawn'',''hold_requested'',''hold_request_rejected'',''hold_released'') NOT NULL',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
