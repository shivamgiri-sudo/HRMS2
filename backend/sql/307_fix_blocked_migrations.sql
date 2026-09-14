-- 307_fix_blocked_migrations.sql
-- Applies schema effects from 5 migrations blocked by syntax/collation errors.
-- All additive, uses stored procedures for idempotency.
-- Registers all 5 originals in schema_migrations so runner skips them.

USE mas_hrms;

-- ============================================================
-- Helper: safe ADD COLUMN (skips if already exists)
-- ============================================================

DROP PROCEDURE IF EXISTS _m307_add_col;
DELIMITER //
CREATE PROCEDURE _m307_add_col(
  IN p_table VARCHAR(64),
  IN p_col   VARCHAR(64),
  IN p_defn  TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_col
  ) THEN
    SET @_sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_col, '` ', p_defn);
    PREPARE _stmt FROM @_sql;
    EXECUTE _stmt;
    DEALLOCATE PREPARE _stmt;
  END IF;
END //
DELIMITER ;

-- ============================================================
-- Section 1: funnel_employee_performance (from 239)
-- FK collation must match employees.id = utf8mb4_unicode_ci
-- ============================================================

CREATE TABLE IF NOT EXISTS funnel_employee_performance (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  performance_date      DATE         NOT NULL,
  employee_id           CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  process_type          VARCHAR(50)  NOT NULL,
  total_entries         INT          DEFAULT 0,
  completed_entries     INT          DEFAULT 0,
  conversions           INT          DEFAULT 0,
  conversion_rate_pct   DECIMAL(5,2),
  performance_tier      VARCHAR(20),
  dept_avg_conv_pct     DECIMAL(5,2),
  dept_rank             INT,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_perf (performance_date, employee_id, process_type),
  INDEX idx_emp_perf_date (performance_date),
  INDEX idx_emp_perf_employee (employee_id),
  INDEX idx_emp_perf_process (process_type),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Section 2: Permanent address columns on employees (from 246)
-- address1/address2 rename already applied
-- ============================================================

CALL _m307_add_col('employees', 'permanent_address1', "VARCHAR(255) NULL COMMENT 'Permanent address line 1'");
CALL _m307_add_col('employees', 'permanent_address2', "VARCHAR(255) NULL COMMENT 'Permanent address line 2'");
CALL _m307_add_col('employees', 'permanent_city',     "VARCHAR(100) NULL COMMENT 'Permanent city'");
CALL _m307_add_col('employees', 'permanent_state',    "VARCHAR(100) NULL COMMENT 'Permanent state'");
CALL _m307_add_col('employees', 'permanent_country',  "VARCHAR(100) NULL DEFAULT 'India'");
CALL _m307_add_col('employees', 'permanent_pincode',  "VARCHAR(10) NULL COMMENT 'Permanent pincode'");

-- ============================================================
-- Section 3: branch_id and pending_manager_id on profile_update_approval (from 262)
-- ============================================================

CALL _m307_add_col('profile_update_approval', 'branch_id', "VARCHAR(36) NULL COMMENT 'Branch of employee'");
CALL _m307_add_col('profile_update_approval', 'pending_manager_id', "VARCHAR(36) NULL COMMENT 'Proposed reporting_manager_id'");

-- Add index if not exists
DROP PROCEDURE IF EXISTS _m307_add_idx;
DELIMITER //
CREATE PROCEDURE _m307_add_idx()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profile_update_approval'
      AND INDEX_NAME = 'idx_pua_branch_status'
  ) THEN
    ALTER TABLE profile_update_approval ADD INDEX idx_pua_branch_status (branch_id, status);
  END IF;
END //
DELIMITER ;
CALL _m307_add_idx();

-- ============================================================
-- Section 4: 289 effects already applied via 289_mysql8 variant.
-- Section 5: 1000 effects: survey_question.question_order already exists.
-- ============================================================

-- ============================================================
-- Register all 5 blocked originals in schema_migrations
-- ============================================================

INSERT IGNORE INTO schema_migrations (filename) VALUES
  ('239_conversion_funnel_schema.sql'),
  ('246_nominee_gratuity_distribution.sql'),
  ('262_reporting_manager_change_request.sql'),
  ('289_candidate_onboarding_full_field_parity.sql'),
  ('1000_fix_engagement_schema_columns.sql');

-- Cleanup helper procedures
DROP PROCEDURE IF EXISTS _m307_add_col;
DROP PROCEDURE IF EXISTS _m307_add_idx;
