-- Performance indexes: composite indexes for the most common query patterns
-- identified in the 2026-09-17 perf audit.
--
-- FIXED 2026-09-30: this file used the MariaDB-only "IF NOT EXISTS" form of CREATE INDEX,
-- which MySQL 8.0 rejects with ER_PARSE_ERROR (1064) at that token, so as written it could
-- never have run. It is rewritten with the information_schema guard + PREPARE/EXECUTE
-- pattern of 1006_payroll_process_readiness_extend.sql. Each index is created only when
-- the table and its columns exist and the index does not, so it is a no-op wherever the
-- index is already there and it no longer stops a fresh database from migrating.
--
-- PRODUCTION: schema_migrations already records this file as applied, and the runner
-- skips applied files by filename, so this rewrite does NOT run there. If any of these
-- indexes are missing in production, build them with the background lock-safe mechanism
-- (backend/src/modules/operations/ops-command.indexes.ts), never from a startup migration:
-- several of these tables are hot.

-- attendance_daily_record: queries filter by employee_id + record_date together constantly
SET @ok = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME IN ('employee_id','record_date')
) = 2 AND (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND INDEX_NAME = 'idx_adr_emp_date'
) = 0;
SET @sql = IF(@ok, 'CREATE INDEX idx_adr_emp_date ON attendance_daily_record (employee_id, record_date)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- wfm_roster_assignment: live tracker and roster queries filter employee_id + roster_date
SET @ok = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME IN ('employee_id','roster_date')
) = 2 AND (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND INDEX_NAME = 'idx_wra_emp_date'
) = 0;
SET @sql = IF(@ok, 'CREATE INDEX idx_wra_emp_date ON wfm_roster_assignment (employee_id, roster_date)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- salary_prep_line_component: payroll run queries filter run_id + employee_id together
SET @ok = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line_component' AND COLUMN_NAME IN ('run_id','employee_id')
) = 2 AND (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line_component' AND INDEX_NAME = 'idx_splc_run_emp'
) = 0;
SET @sql = IF(@ok, 'CREATE INDEX idx_splc_run_emp ON salary_prep_line_component (run_id, employee_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- payroll_employee_component_snapshot: getComponentBreakup filters employee_id + effective_from
SET @ok = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_employee_component_snapshot' AND COLUMN_NAME IN ('employee_id','effective_from')
) = 2 AND (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_employee_component_snapshot' AND INDEX_NAME = 'idx_pecs_emp_eff'
) = 0;
SET @sql = IF(@ok, 'CREATE INDEX idx_pecs_emp_eff ON payroll_employee_component_snapshot (employee_id, effective_from)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- payroll_compliance_issue: validateRun reads issues by run_id
SET @ok = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_compliance_issue' AND COLUMN_NAME IN ('run_id')
) = 1 AND (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_compliance_issue' AND INDEX_NAME = 'idx_pci_run'
) = 0;
SET @sql = IF(@ok, 'CREATE INDEX idx_pci_run ON payroll_compliance_issue (run_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ats_bgv_verification: listOnboardingBridges LEFT JOIN on candidate_id + MAX(created_at)
SET @ok = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_bgv_verification' AND COLUMN_NAME IN ('candidate_id','created_at')
) = 2 AND (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_bgv_verification' AND INDEX_NAME = 'idx_bgv_cand_date'
) = 0;
SET @sql = IF(@ok, 'CREATE INDEX idx_bgv_cand_date ON ats_bgv_verification (candidate_id, created_at)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ats_payroll_hr_validation: listOnboardingBridges LEFT JOIN on candidate_id
SET @ok = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME IN ('candidate_id')
) = 1 AND (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND INDEX_NAME = 'idx_phrv_cand'
) = 0;
SET @sql = IF(@ok, 'CREATE INDEX idx_phrv_cand ON ats_payroll_hr_validation (candidate_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- candidate_name_match_summary: listOnboardingBridges LEFT JOIN on candidate_id
SET @ok = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_name_match_summary' AND COLUMN_NAME IN ('candidate_id')
) = 1 AND (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_name_match_summary' AND INDEX_NAME = 'idx_cnms_cand'
) = 0;
SET @sql = IF(@ok, 'CREATE INDEX idx_cnms_cand ON candidate_name_match_summary (candidate_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- bank_statement_line: reconciliation queries filter by import_id
SET @ok = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_statement_line' AND COLUMN_NAME IN ('import_id')
) = 1 AND (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_statement_line' AND INDEX_NAME = 'idx_bsl_import'
) = 0;
SET @sql = IF(@ok, 'CREATE INDEX idx_bsl_import ON bank_statement_line (import_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- attendance_regularization: engine queries by employee + date
SET @ok = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME IN ('employee_id','regularization_date')
) = 2 AND (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND INDEX_NAME = 'idx_ar_emp_date'
) = 0;
SET @sql = IF(@ok, 'CREATE INDEX idx_ar_emp_date ON attendance_regularization (employee_id, regularization_date)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
