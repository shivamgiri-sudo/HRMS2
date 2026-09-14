-- Record WHICH approved package an employee was hired on.
--
-- salary_package_master holds 295 approved packages (branch + cost centre + band)
-- carrying the full 17-line breakup: basic, hra, conveyance, portfolio, medical,
-- special, other, bonus, pli, gross, epf/esic employee + employer, professional
-- tax, admin charges, net_in_hand, ctc.
--
-- Nothing records which one was chosen. Verified against production:
--   salary_component_assignments.salary_slab = 'LEGACY' on all 3,147 rows
--   salary_register.salary_slab_id           NULL on all rows
--   employee_salary_assignment.salary_slab_id NULL on all 30,156 rows
--
-- That matters because salary_component_assignments has no bonus or
-- admin_charges column, while 223 of 295 packages carry a bonus and 224 carry
-- admin charges. So an appointment letter generated from the assignment prints
-- "Bonus 0.00" for an employee whose package actually grants 583 — silently
-- understating the package they were hired on.
--
-- Additive and nullable: existing rows keep working and fall back to the
-- assignment amounts. Only newly assigned salaries carry the link.

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'salary_component_assignments'
      AND COLUMN_NAME = 'package_id') = 0,
  'ALTER TABLE salary_component_assignments
     ADD COLUMN package_id CHAR(36) NULL AFTER salary_slab,
     ADD INDEX idx_sca_package (package_id)',
  'SELECT ''salary_component_assignments.package_id already exists'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- FK only when both sides agree on collation and the parent is present. A
-- mismatched collation raises errno 3780 and would abort the whole migration,
-- so this is guarded rather than assumed.
SET @fk = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_package_master') = 1
  AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'salary_component_assignments'
      AND CONSTRAINT_NAME = 'fk_sca_package') = 0
  AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'salary_component_assignments' AND COLUMN_NAME = 'package_id') = 1,
  'ALTER TABLE salary_component_assignments
     ADD CONSTRAINT fk_sca_package FOREIGN KEY (package_id)
     REFERENCES salary_package_master(id) ON DELETE SET NULL',
  'SELECT ''fk_sca_package skipped (parent missing, column missing, or already present)'' AS note'
);
PREPARE stmt2 FROM @fk;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
