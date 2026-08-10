-- Migration 304: Add missing columns (overtime_pay, employee_code on ats_candidate)
DROP PROCEDURE IF EXISTS mig304;
DELIMITER $$
CREATE PROCEDURE mig304()
BEGIN
  -- salary_prep_line.overtime_pay
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='salary_prep_line' AND COLUMN_NAME='overtime_pay'
  ) THEN
    ALTER TABLE salary_prep_line ADD COLUMN overtime_pay DECIMAL(10,2) NOT NULL DEFAULT 0.00;
  END IF;

  -- ats_candidate.employee_code (generated at gate)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_candidate' AND COLUMN_NAME='employee_code'
  ) THEN
    ALTER TABLE ats_candidate ADD COLUMN employee_code VARCHAR(30) DEFAULT NULL;
    ALTER TABLE ats_candidate ADD INDEX idx_ats_emp_code (employee_code);
  END IF;

  -- jclr_entries.updated_at ON UPDATE
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='jclr_entries'
  ) THEN
    -- table created by migration 302; nothing to do here
    SELECT 1;
  END IF;
END$$
DELIMITER ;
CALL mig304();
DROP PROCEDURE IF EXISTS mig304;
SELECT 'Migration 304 applied: overtime_pay + ats_candidate.employee_code' AS status;
