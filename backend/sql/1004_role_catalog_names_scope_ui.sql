-- Migration 1004: Fix role catalog display names + add branch scope to user_assignment_scope UI
-- Additive only — no destructive changes.
--
-- FIXED 2026-08-14: the ADD COLUMN clauses used `IF NOT EXISTS` — MariaDB syntax, rejected by
-- this production MySQL 8.0.42 build with ER_PARSE_ERROR. Not yet in MIGRATION_MANIFEST, and
-- confirmed unused by any application code (scope_label/assigned_at/category are not read or
-- written anywhere in backend/src) — syntax fixed, deliberately NOT executed. The UPDATE
-- statements setting `category` below are unchanged; they only take effect once someone
-- decides to actually run this file.

-- 1. Fix misleading role names in workforce_role_catalog
UPDATE workforce_role_catalog SET role_name = 'IT Manager / IT Head',      description = 'Manages IT provisioning, assets, domain accounts and biometric setup for the branch' WHERE role_key = 'it';
UPDATE workforce_role_catalog SET role_name = 'Branch IT',                  description = 'IT staff scoped to a specific branch' WHERE role_key = 'branch_it';
UPDATE workforce_role_catalog SET role_name = 'IT Administrator',           description = 'IT admin with full provisioning access' WHERE role_key = 'it_admin';
UPDATE workforce_role_catalog SET role_name = 'Branch Head',                description = 'Responsible for all operations at a branch' WHERE role_key = 'branch_head';
UPDATE workforce_role_catalog SET role_name = 'Branch Admin',               description = 'Administrative staff for biometric, ID card and physical admin at a branch' WHERE role_key = 'branch_admin';
UPDATE workforce_role_catalog SET role_name = 'Branch Finance',             description = 'Finance staff scoped to a specific branch' WHERE role_key = 'branch_finance' OR role_key = 'branch_it';
UPDATE workforce_role_catalog SET role_name = 'Operations Manager',         description = 'Manages floor operations, call quality and process performance' WHERE role_key = 'operations_manager';
UPDATE workforce_role_catalog SET role_name = 'Quality Analyst',            description = 'Audits calls and measures quality scores' WHERE role_key = 'qa';
UPDATE workforce_role_catalog SET role_name = 'WFM Analyst',               description = 'Workforce management — roster, scheduling and real-time adherence' WHERE role_key = 'wfm';

-- 2. Add scope_label column to user_assignment_scope for UI display (additive)
SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_assignment_scope' AND COLUMN_NAME = 'scope_label');
SET @sql = IF(@c1 = 0, 'ALTER TABLE user_assignment_scope ADD COLUMN scope_label VARCHAR(200) NULL COMMENT ''Human-readable label for this scope row, e.g. branch name''', 'SELECT "scope_label already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_assignment_scope' AND COLUMN_NAME = 'assigned_by_user_id');
SET @sql = IF(@c2 = 0, 'ALTER TABLE user_assignment_scope ADD COLUMN assigned_by_user_id CHAR(36) NULL COMMENT ''user_id of admin who created this scope row''', 'SELECT "assigned_by_user_id already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c3 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_assignment_scope' AND COLUMN_NAME = 'assigned_at');
SET @sql = IF(@c3 = 0, 'ALTER TABLE user_assignment_scope ADD COLUMN assigned_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT ''When this scope was assigned''', 'SELECT "assigned_at already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Ensure workforce_role_catalog has a category column for UI grouping (additive)
SET @c4 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workforce_role_catalog' AND COLUMN_NAME = 'category');
SET @sql = IF(@c4 = 0, 'ALTER TABLE workforce_role_catalog ADD COLUMN category VARCHAR(100) NULL COMMENT ''UI grouping category e.g. Management, HR, IT, Finance''', 'SELECT "category already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE workforce_role_catalog SET category = 'Leadership'   WHERE role_key IN ('super_admin','admin','ceo','management');
UPDATE workforce_role_catalog SET category = 'HR'           WHERE role_key IN ('hr','branch_hr','ho_hr','process_hr');
UPDATE workforce_role_catalog SET category = 'IT'           WHERE role_key IN ('it','branch_it','it_admin');
UPDATE workforce_role_catalog SET category = 'Finance'      WHERE role_key IN ('finance','payroll','payroll_head','payroll_hr','payroll_admin','payroll_branch','branch_finance');
UPDATE workforce_role_catalog SET category = 'Operations'   WHERE role_key IN ('branch_head','branch_admin','branch_manager','bm','process_manager','manager','assistant_manager','operations_manager');
UPDATE workforce_role_catalog SET category = 'Workforce'    WHERE role_key IN ('wfm','wfm_spoc','rta','team_leader','tl','trainer');
UPDATE workforce_role_catalog SET category = 'Quality'      WHERE role_key IN ('qa','quality_analyst','qa_manager');
UPDATE workforce_role_catalog SET category = 'Recruitment'  WHERE role_key IN ('recruiter','recruitment_hr');
UPDATE workforce_role_catalog SET category = 'Employee'     WHERE role_key IN ('employee','agent','trainee');
