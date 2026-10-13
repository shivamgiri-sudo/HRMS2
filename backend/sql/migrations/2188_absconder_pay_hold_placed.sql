-- Migration 2188: an absconder's pay is held only when someone decides to hold it
--
-- An absconded employee is paid by the system as normal. If a branch wants the salary days of one made 0,
-- that call belongs to the employee's reporting manager, the branch Payroll HR or the Branch Head. This records
-- who placed the hold, when and why on the exit request; the hold lasts until the Branch Head and then the
-- Payroll Head release it (ff_exception_bh_* / ff_exception_*, migrations 2159/2162) or it is withdrawn.
-- The event trail (2187) gains the two actions for placing and withdrawing a hold.
--
-- Additive and idempotent. No existing row changes.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_hold_at');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN pay_hold_at DATETIME NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_hold_by');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN pay_hold_by CHAR(36) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_hold_role');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN pay_hold_role VARCHAR(40) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_hold_reason');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN pay_hold_reason VARCHAR(500) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'absconder_pay_release_event' AND COLUMN_NAME = 'action' AND COLUMN_TYPE LIKE '%hold_placed%');
SET @s := IF(@c = 0,
  'ALTER TABLE absconder_pay_release_event MODIFY COLUMN action ENUM(''requested'',''bh_approved'',''bh_rejected'',''ph_approved'',''ph_rejected'',''re_requested'',''hold_placed'',''hold_withdrawn'') NOT NULL',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
