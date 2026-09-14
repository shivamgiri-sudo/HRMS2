-- Migration: Add overtime fields to salary_prep_line
-- Date: 2026-06-16
-- Description: Add overtime_hours and overtime_amount columns for WFM team to update

ALTER TABLE salary_prep_line
ADD COLUMN overtime_hours DECIMAL(8,2) DEFAULT 0 COMMENT 'Overtime hours worked (editable by WFM team only)',
ADD COLUMN overtime_amount DECIMAL(10,2) DEFAULT 0 COMMENT 'Overtime payment amount (editable by WFM team only)',
ADD INDEX idx_overtime (employee_id, overtime_hours);

-- Update existing records to have 0 overtime
UPDATE salary_prep_line SET overtime_hours = 0, overtime_amount = 0 WHERE overtime_hours IS NULL;
