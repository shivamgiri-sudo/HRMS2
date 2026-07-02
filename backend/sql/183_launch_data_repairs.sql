USE mas_hrms;

-- Upgrade salary_package_master installations that pre-date the full payroll
-- masters schema. MySQL 5.7 has no ADD COLUMN IF NOT EXISTS, so use dynamic DDL.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'salary_package_master'
      AND column_name = 'cost_centre_id') = 0,
  'ALTER TABLE salary_package_master ADD COLUMN cost_centre_id CHAR(36) NULL AFTER location_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'salary_package_master'
      AND column_name = 'conveyance_amt') = 0,
  'ALTER TABLE salary_package_master ADD COLUMN conveyance_amt DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER basic_amt, ADD COLUMN conveyance_type ENUM(''fixed'',''pct'') NOT NULL DEFAULT ''fixed'' AFTER conveyance_amt, ADD COLUMN medical_amt DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER conveyance_type, ADD COLUMN medical_type ENUM(''fixed'',''pct'') NOT NULL DEFAULT ''fixed'' AFTER medical_amt, ADD COLUMN other_allowance_amt DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER medical_type, ADD COLUMN other_allowance_type ENUM(''fixed'',''pct'') NOT NULL DEFAULT ''fixed'' AFTER other_allowance_amt, ADD COLUMN bonus_amt DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER other_allowance_type, ADD COLUMN bonus_type ENUM(''fixed'',''pct'') NOT NULL DEFAULT ''fixed'' AFTER bonus_amt, ADD COLUMN portfolio_amt DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER bonus_type, ADD COLUMN special_allowance_amt DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER portfolio_amt, ADD COLUMN pli_amt DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER special_allowance_amt',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'salary_package_master'
      AND column_name = 'created_by') = 0,
  'ALTER TABLE salary_package_master ADD COLUMN created_by CHAR(36) NULL AFTER active_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'salary_package_master'
      AND column_name = 'updated_at') = 0,
  'ALTER TABLE salary_package_master ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Normalize KPI table collations so joins to process and metric masters do not
-- fail with "Illegal mix of collations".
ALTER TABLE kpi_process_config
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE kpi_rating_config
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Keep the most-used active department for each normalized name. Employee
-- references are remapped first; duplicate rows are retained but made inactive.
DROP TEMPORARY TABLE IF EXISTS tmp_department_duplicate;
CREATE TEMPORARY TABLE tmp_department_duplicate (
  duplicate_id CHAR(36) NOT NULL PRIMARY KEY,
  canonical_id CHAR(36) NOT NULL
);

INSERT INTO tmp_department_duplicate (duplicate_id, canonical_id)
SELECT d.id,
       (
         SELECT d2.id
           FROM department_master d2
           LEFT JOIN employees e2 ON e2.department_id = d2.id
          WHERE d2.active_status = 1
            AND LOWER(TRIM(d2.dept_name)) = LOWER(TRIM(d.dept_name))
          GROUP BY d2.id, d2.created_at
          ORDER BY COUNT(e2.id) DESC, d2.created_at ASC, d2.id ASC
          LIMIT 1
       )
  FROM department_master d
 WHERE d.active_status = 1
   AND (
     SELECT COUNT(*)
       FROM department_master dx
      WHERE dx.active_status = 1
        AND LOWER(TRIM(dx.dept_name)) = LOWER(TRIM(d.dept_name))
   ) > 1;

DELETE FROM tmp_department_duplicate WHERE duplicate_id = canonical_id;

UPDATE employees e
JOIN tmp_department_duplicate d ON d.duplicate_id = e.department_id
SET e.department_id = d.canonical_id;

UPDATE department_master dm
JOIN tmp_department_duplicate d ON d.duplicate_id = dm.id
SET dm.active_status = 0,
    dm.updated_at = NOW();

DROP TEMPORARY TABLE tmp_department_duplicate;
