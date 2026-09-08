-- Makes a period's figure for a RATE metric exact.
--
-- THE PROBLEM
-- -----------
-- process_metric_actual stores one computed value per process per day. For a rate
-- that is a completed division, and the parts are discarded. Rolling a month up
-- can then only average the daily rates, which is not the month's rate whenever
-- daily volumes differ:
--
--   Bla Bli Blu answer level, 2026-08-01..07
--     mean of the six daily rates   98.20%
--     864 answered / 882 offered    97.96%
--
-- 0.24pp apart on near-even volumes; far more when one day carries the traffic.
-- This is the same "mean of ratios is not the ratio of sums" error that process
-- grain exists to avoid at the daily level, reappearing at the monthly one.
--
-- WHAT THIS ADDS
-- --------------
-- The two numbers a ratio was built from, so SUM(numerator)/SUM(denominator)
-- can be computed later. They are stored ALREADY SCALED into the metric's own
-- unit -- PCT(a, b) writes a*100 and b, SAFE_DIV(a, b) writes a and b -- so a
-- reader divides one by the other and needs to know nothing about which function
-- produced them.
--
-- Both are nullable and stay null for anything that is not a plain ratio (a
-- banded IF, a CLAMP, a manually typed figure). Null is the signal that an exact
-- period figure is not recoverable, and the dashboard keeps saying so rather
-- than pretending. Existing rows keep their value and gain two nulls; nothing
-- that reads actual_value today changes behaviour.
--
-- SAFETY: additive, nullable, no backfill, no existing data touched. Guarded on
-- information_schema, because MariaDB's ADD COLUMN IF NOT EXISTS is a syntax
-- error on the MySQL 8.0.42 this system runs.

SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'process_metric_actual'
              AND column_name = 'rollup_numerator');
SET @ddl := IF(@c = 0,
  'ALTER TABLE process_metric_actual ADD COLUMN rollup_numerator DECIMAL(18,4) NULL COMMENT ''Numerator of the day''''s ratio, scaled into the metric unit. Null when the value is not a plain ratio.'' AFTER actual_value',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'process_metric_actual'
              AND column_name = 'rollup_denominator');
SET @ddl := IF(@c = 0,
  'ALTER TABLE process_metric_actual ADD COLUMN rollup_denominator DECIMAL(18,4) NULL COMMENT ''Denominator of the day''''s ratio. SUM(rollup_numerator)/SUM(rollup_denominator) is the exact period figure.'' AFTER rollup_numerator',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
