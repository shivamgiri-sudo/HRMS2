-- Migration 2190: a strict order for absconder_pay_release_event
--
-- created_at has one-second resolution and id is a random UUID, so two events written in the same second
-- (a request and its rejection, a placement and its release) had no reliable order, and the "current state" was
-- read from whichever sorted last. seq is an auto-increment sequence; the state is read by it.
-- Additive and idempotent. Existing rows are numbered in insertion order.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'absconder_pay_release_event' AND COLUMN_NAME = 'seq');
SET @s := IF(@c = 0, 'ALTER TABLE absconder_pay_release_event ADD COLUMN seq BIGINT NOT NULL AUTO_INCREMENT, ADD UNIQUE KEY uq_apre_seq (seq)', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
