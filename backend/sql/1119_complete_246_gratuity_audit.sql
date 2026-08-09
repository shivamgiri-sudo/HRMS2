-- 1119_complete_246_gratuity_audit.sql
--
-- Applies the part of 246_nominee_gratuity_distribution.sql that never took effect. 246 is
-- recorded in schema_migrations as applied, and its first table did land - gratuity_distribution
-- exists - but three later objects do not.
--
-- Found by auditing every manifest file recorded as applied against the tables it declares, after
-- 509 turned out to have lost its tail the same way. 246 is the only other genuine instance across
-- 475 manifest files and 260 that declare tables.
--
-- Two distinct causes, both known traps in this repository:
--
--   gratuity_calculation_audit declares foreign keys to employees(id) and exit_request(id) but no
--   COLLATE. The server default is utf8mb4_0900_ai_ci while those tables are utf8mb4_unicode_ci,
--   and MySQL rejects a foreign key whose collation differs from the referenced key with errno
--   3780. This is what half-applied 099 as well.
--
--   The two full_final_calculation columns were written as ADD COLUMN IF NOT EXISTS, which is
--   MariaDB syntax that MySQL 8.0.42 rejects with ER_PARSE_ERROR. The same mistake got 1064
--   dropped and left 1110 unlisted.
--
-- Nothing reads gratuity_calculation_audit today, so this restores intended schema rather than
-- repairing live behaviour. It matters anyway: the table is the audit trail for how a gratuity
-- figure was arrived at - years of service, basic, the formula applied, tax deducted - and a
-- payroll platform that computes gratuity without recording that has nothing to show later.
--
-- Every statement is individually guarded, so re-running is a no-op.

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'CREATE TABLE gratuity_calculation_audit (
     id                CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
     exit_request_id   CHAR(36)      NOT NULL UNIQUE,
     employee_id       CHAR(36)      NOT NULL,
     years_of_service  DECIMAL(5,2)  NOT NULL,
     basic_monthly     DECIMAL(12,2) NOT NULL,
     gratuity_formula  VARCHAR(100)  NOT NULL COMMENT ''e.g., (basic/26)*15*years'',
     gross_gratuity    DECIMAL(12,2) NOT NULL,
     tax_deducted      DECIMAL(12,2) NOT NULL DEFAULT 0,
     net_gratuity      DECIMAL(12,2) NOT NULL,
     calculation_date  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_emp_audit (employee_id),
     CONSTRAINT fk_gca_exit FOREIGN KEY (exit_request_id) REFERENCES exit_request(id) ON DELETE CASCADE,
     CONSTRAINT fk_gca_emp  FOREIGN KEY (employee_id)     REFERENCES employees(id)    ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci', 'SELECT 1')
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gratuity_calculation_audit');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE full_final_calculation
     ADD COLUMN nominee_distribution_status
       ENUM(''not_applicable'',''pending'',''completed'',''rejected'')
       NOT NULL DEFAULT ''not_applicable''', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'full_final_calculation'
    AND COLUMN_NAME = 'nominee_distribution_status');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE full_final_calculation ADD COLUMN gratuity_distribution_id CHAR(36) NULL', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'full_final_calculation'
    AND COLUMN_NAME = 'gratuity_distribution_id');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

-- 246 follows its ALTER with an UPDATE that back-fills nominee_distribution_status to 'pending'
-- wherever gratuity_amount > 0. That is deliberately NOT repeated here. The column has just been
-- created with its declared default, and re-running a back-fill months later would overwrite any
-- status a user has since set - this migration adds schema, it does not decide anyone's F&F state.
