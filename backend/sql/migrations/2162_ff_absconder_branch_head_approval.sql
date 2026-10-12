-- Migration 2162: Branch Head approval before the Payroll Head's absconder F&F exception
--
-- An absconded employee gets no F&F. The Payroll Head may record an exception (2159), but only after
-- the employee's Branch Head has approved it first. Adds the Branch Head's step to exit_request.
-- Nullable, additive, information_schema-guarded and idempotent. No existing row changes.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'ff_exception_bh_by');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN ff_exception_bh_by CHAR(36) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'ff_exception_bh_at');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN ff_exception_bh_at DATETIME NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'ff_exception_bh_reason');
SET @s := IF(@c = 0, 'ALTER TABLE exit_request ADD COLUMN ff_exception_bh_reason VARCHAR(500) NULL', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
