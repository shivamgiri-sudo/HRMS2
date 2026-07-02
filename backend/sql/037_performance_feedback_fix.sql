-- Fix performance_feedback_cycle table to match plan
-- Add missing fields: period, deadline

ALTER TABLE performance_feedback_cycle
ADD COLUMN period VARCHAR(9) NULL COMMENT 'Format: YYYY-MM or YYYY-Q1' AFTER cycle_name,
ADD COLUMN deadline DATE NULL COMMENT 'Manager submission deadline' AFTER end_date,
ADD INDEX idx_cycle_period (period);

-- Update existing records to have a default period based on dates
UPDATE performance_feedback_cycle
SET period = CONCAT(YEAR(start_date), '-Q', QUARTER(start_date))
WHERE period IS NULL;

-- Update existing records to have default deadline (7 days after end_date)
UPDATE performance_feedback_cycle
SET deadline = DATE_ADD(end_date, INTERVAL 7 DAY)
WHERE deadline IS NULL;
