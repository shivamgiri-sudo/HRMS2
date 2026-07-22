-- Migration 1004: Fix role catalog display names + add branch scope to user_assignment_scope UI
-- Additive only — no destructive changes.

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
ALTER TABLE user_assignment_scope
  ADD COLUMN IF NOT EXISTS scope_label VARCHAR(200) NULL COMMENT 'Human-readable label for this scope row, e.g. branch name',
  ADD COLUMN IF NOT EXISTS assigned_by_user_id CHAR(36) NULL COMMENT 'user_id of admin who created this scope row',
  ADD COLUMN IF NOT EXISTS assigned_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When this scope was assigned';

-- 3. Ensure workforce_role_catalog has a category column for UI grouping (additive)
ALTER TABLE workforce_role_catalog
  ADD COLUMN IF NOT EXISTS category VARCHAR(100) NULL COMMENT 'UI grouping category e.g. Management, HR, IT, Finance';

UPDATE workforce_role_catalog SET category = 'Leadership'   WHERE role_key IN ('super_admin','admin','ceo','management');
UPDATE workforce_role_catalog SET category = 'HR'           WHERE role_key IN ('hr','branch_hr','ho_hr','process_hr');
UPDATE workforce_role_catalog SET category = 'IT'           WHERE role_key IN ('it','branch_it','it_admin');
UPDATE workforce_role_catalog SET category = 'Finance'      WHERE role_key IN ('finance','payroll','payroll_head','payroll_hr','payroll_admin','payroll_branch','branch_finance');
UPDATE workforce_role_catalog SET category = 'Operations'   WHERE role_key IN ('branch_head','branch_admin','branch_manager','bm','process_manager','manager','assistant_manager','operations_manager');
UPDATE workforce_role_catalog SET category = 'Workforce'    WHERE role_key IN ('wfm','wfm_spoc','rta','team_leader','tl','trainer');
UPDATE workforce_role_catalog SET category = 'Quality'      WHERE role_key IN ('qa','quality_analyst','qa_manager');
UPDATE workforce_role_catalog SET category = 'Recruitment'  WHERE role_key IN ('recruiter','recruitment_hr');
UPDATE workforce_role_catalog SET category = 'Employee'     WHERE role_key IN ('employee','agent','trainee');
