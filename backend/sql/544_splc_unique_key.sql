-- Migration 544: Ensure unique key on salary_prep_line_component (line_id, component_code)
-- The table may have been created before this constraint was defined in 137_schema_gaps.sql.
-- Without it, ON DUPLICATE KEY UPDATE falls back to plain INSERT, accumulating duplicate rows
-- on every payroll recalculation, causing components to display twice in payslips.
USE mas_hrms;

-- Remove any duplicate rows first (keep the row with highest amount, break ties by id)
DELETE splc1 FROM salary_prep_line_component splc1
  INNER JOIN salary_prep_line_component splc2
    ON splc1.line_id = splc2.line_id
   AND splc1.component_code = splc2.component_code
   AND splc1.id > splc2.id;

-- Add unique key if not already present
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'salary_prep_line_component'
     AND INDEX_NAME   = 'uq_line_component'
);
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE salary_prep_line_component ADD UNIQUE KEY uq_line_component (line_id, component_code)',
  'SELECT "uq_line_component already exists"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
