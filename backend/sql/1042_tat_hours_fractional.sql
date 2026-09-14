-- 1042_tat_hours_fractional.sql
--
-- tat_matrix_master.default_tat_hours is INT, so every sub-hour SLA is silently rounded.
--
-- HOW IT SURFACED
-- Migration 1041 seeds the ATS walk-in queue SLA at 0.5 hours — 30 minutes, per its own
-- comment "ATS Queue wait SLA (30 min = 0.5 hours default)". MySQL stored 1. The alert
-- therefore fires at 60 minutes, twice as late as designed, and nothing reports an error
-- because rounding an INT is not a failure.
--
-- WHY WIDENING IS THE RIGHT FIX, NOT RE-SEEDING
-- The consuming code already assumes fractional hours:
--     workers/sla-breach-worker.ts:33   rows?.[0]?.default_tat_hours ?? 0.5
-- That fallback is 0.5. The column contradicts the code, not the other way round. No
-- consumer coerces the value (no parseInt, no Number(), no toFixed) — it is used directly
-- in arithmetic — so DECIMAL flows through unchanged.
--
-- SAFETY
-- INT -> DECIMAL(6,2) is a widening conversion: every existing value converts exactly
-- (18 -> 18.00), the maximum in production is 72, and DECIMAL(6,2) holds 9999.99. Nothing
-- is truncated and no row is lost. NOT NULL and the DEFAULT are preserved.
--
-- The second statement restores the value 1041 intended. It is written as an idempotent
-- UPDATE guarded on the current value, so re-running neither double-applies nor overwrites
-- a figure someone has since tuned by hand.

SET NAMES utf8mb4;

ALTER TABLE tat_matrix_master
  MODIFY COLUMN default_tat_hours DECIMAL(6,2) NOT NULL DEFAULT 24.00
  COMMENT 'Hours; fractional allowed — 0.5 = 30 minutes. Was INT, which silently rounded sub-hour SLAs.';

-- Restore the 30-minute walk-in queue SLA that 1041 intended. Guarded so it only corrects
-- the rounded value and never clobbers a deliberate later change.
UPDATE tat_matrix_master
   SET default_tat_hours = 0.50
 WHERE task_type = 'ATS_QUEUE_WAIT'
   AND default_tat_hours = 1.00;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Column is fractional:
--   SELECT COLUMN_TYPE FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tat_matrix_master'
--      AND COLUMN_NAME='default_tat_hours';        -- expect decimal(6,2)
--
-- The 30-minute SLA survives a round trip:
--   SELECT default_tat_hours FROM tat_matrix_master WHERE task_type='ATS_QUEUE_WAIT';
--   -- expect 0.50, not 1
--
-- Nothing else changed:
--   SELECT COUNT(*) FROM tat_matrix_master;        -- expect 25
--
-- ---------------------------------------------------------------------------
-- ROLLBACK  (re-introduces the rounding; only useful to prove causation)
-- ---------------------------------------------------------------------------
-- ALTER TABLE tat_matrix_master
--   MODIFY COLUMN default_tat_hours INT NOT NULL DEFAULT 24;
