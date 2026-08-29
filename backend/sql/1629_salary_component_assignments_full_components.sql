-- 1629: Add full earning-component breakdown to salary_component_assignments.
--
-- salary_component_assignments previously stored only basic/hra/conveyance/
-- special_allowance/gross. salary_package_master already carries bonus/portfolio/
-- medical/lta/other_allowance/pli — this migration aligns the assignment
-- table so the payroll engine can read the complete breakdown and produce
-- payslips that match the legacy db_bill salary register column-for-column.
--
-- Also adds the five deduction component_codes that appear in db_bill but
-- have no entry in salary_component_master yet.
--
-- All eight column additions are guarded individually via information_schema +
-- PREPARE/EXECUTE (MySQL 8.0.42 rejects ADD COLUMN IF NOT EXISTS with
-- ER_PARSE_ERROR while still recording the migration as applied).

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_component_assignments'
  AND COLUMN_NAME = 'bonus'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE salary_component_assignments ADD COLUMN bonus DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER conveyance',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_component_assignments'
  AND COLUMN_NAME = 'portfolio'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE salary_component_assignments ADD COLUMN portfolio DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER bonus',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_component_assignments'
  AND COLUMN_NAME = 'medical_allowance'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE salary_component_assignments ADD COLUMN medical_allowance DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER portfolio',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_component_assignments'
  AND COLUMN_NAME = 'lta'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE salary_component_assignments ADD COLUMN lta DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER medical_allowance',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_component_assignments'
  AND COLUMN_NAME = 'other_allowance'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE salary_component_assignments ADD COLUMN other_allowance DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER lta',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_component_assignments'
  AND COLUMN_NAME = 'pli'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE salary_component_assignments ADD COLUMN pli DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER other_allowance',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_component_assignments'
  AND COLUMN_NAME = 'mobile_deduction'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE salary_component_assignments ADD COLUMN mobile_deduction DECIMAL(10,2) NOT NULL DEFAULT 0.00',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_component_assignments'
  AND COLUMN_NAME = 'insurance_deduction'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE salary_component_assignments ADD COLUMN insurance_deduction DECIMAL(10,2) NOT NULL DEFAULT 0.00',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Seed missing deduction component codes used in db_bill salary_data.
-- ON DUPLICATE KEY UPDATE is a no-op when component_code already exists
-- (salary_component_master has a UNIQUE key on component_code).
INSERT INTO salary_component_master (id, component_code, component_name, component_type)
VALUES
  (UUID(), 'MOBILE_DED',  'Mobile Deduction',    'deduction'),
  (UUID(), 'SHORT_COLL',  'Short Collection',     'deduction'),
  (UUID(), 'ASSET_REC',   'Asset Recovery',       'deduction'),
  (UUID(), 'INSURANCE',   'Insurance Deduction',  'deduction'),
  (UUID(), 'LEAVE_DED',   'Leave Deduction',      'deduction')
ON DUPLICATE KEY UPDATE component_name = VALUES(component_name);
