-- 102_role_page_access_seed.sql
-- Comprehensive role_page_access seed data to fix 6 P0 gaps
-- This script is idempotent and can be safely run multiple times
-- Created: 2026-06-09

USE mas_hrms;

-- ============================================================================
-- STEP 1: Ensure all page codes exist in page_catalog
-- ============================================================================

INSERT INTO page_catalog (page_code, page_name, module, page_path, description) VALUES
-- ATS Pages
('ATS_CANDIDATE_POOL', 'Candidate Pool', 'ATS', '/ats/candidates', 'Manage candidate database and profiles'),
('ATS_INTERVIEW', 'Interview Management', 'ATS', '/ats/interviews', 'Schedule and track interviews'),
('ATS_OFFER', 'Offer Management', 'ATS', '/ats/offers', 'Create and manage candidate offers'),
('ATS_ONBOARDING', 'ATS Onboarding', 'ATS', '/ats/onboarding', 'Candidate to employee onboarding'),

-- Employee Management Pages
('EMPLOYEE_MANAGEMENT', 'Employee Management', 'HR', '/hr/employees', 'Full employee lifecycle management'),
('EMPLOYEE_SELF_SERVICE', 'Employee Self Service', 'Employee', '/ess/dashboard', 'Employee self-service dashboard'),
('EMPLOYEE_PROFILE', 'Employee Profile', 'Employee', '/ess/profile', 'Employee profile management'),
('EMPLOYEE_DIRECTORY', 'Employee Directory', 'Employee', '/ess/directory', 'Company-wide employee directory'),

-- Team Management Pages
('TEAM_ROSTER', 'Team Roster', 'Management', '/team/roster', 'View and manage team roster'),
('TEAM_ATTENDANCE', 'Team Attendance', 'Management', '/team/attendance', 'Monitor team attendance'),
('COACHING', 'Coaching Center', 'Management', '/team/coaching', 'Team member coaching and feedback'),
('MANAGEMENT_DASHBOARD', 'Management Dashboard', 'Management', '/management/dashboard', 'Manager dashboard with team insights'),

-- QA Pages
('QA_EVALUATION', 'QA Evaluation', 'Quality', '/qa/evaluation', 'Perform quality evaluations'),
('QA_CALIBRATION', 'QA Calibration', 'Quality', '/qa/calibration', 'Quality calibration sessions'),

-- Finance Pages
('FINANCE_DASHBOARD', 'Finance Dashboard', 'Finance', '/finance/dashboard', 'Finance team dashboard'),
('PAYROLL', 'Payroll Management', 'Payroll', '/payroll/dashboard', 'Full payroll processing'),

-- Operations Pages
('PROCESS_DASHBOARD', 'Process Dashboard', 'Operations', '/operations/process', 'Process-specific dashboard'),
('CLIENT_PORTAL_ADMIN', 'Client Portal Admin', 'Operations', '/operations/client-portal', 'Manage client portal access')
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name),
  module = VALUES(module),
  page_path = VALUES(page_path),
  description = VALUES(description);

-- ============================================================================
-- STEP 2: Seed role_page_access for HR role (Full HR Functions)
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- Core HR Operations
('hr','EMPLOYEE_MANAGEMENT',          1,1,1,0,1),
('hr','EMPLOYEE_DIRECTORY',           1,1,1,0,1),

-- Hiring & ATS
('hr','ATS_DASHBOARD',                1,1,1,0,1),
('hr','ATS_RECRUITER_QUEUE',          1,1,1,0,1),
('hr','ATS_CANDIDATE_POOL',           1,1,1,0,1),
('hr','ATS_INTERVIEW',                1,1,1,0,1),
('hr','ATS_OFFER',                    1,1,1,0,1),
('hr','ATS_ONBOARDING',               1,1,1,0,1),

-- Leave Management (Full Access)
('hr','LEAVE_MANAGEMENT',             1,1,1,0,1),

-- Payroll & Salary
('hr','SALARY_PREP',                  1,1,1,0,1),
('hr','PAYROLL',                      1,0,1,0,1),
('hr','FINANCE_DASHBOARD',            1,0,0,0,1),

-- Employee Self-Service Access (for HR to view what employees see)
('hr','EMPLOYEE_SELF_SERVICE',        1,0,0,0,0),
('hr','EMPLOYEE_PROFILE',             1,0,0,0,0),

-- Management Views (for HR oversight)
('hr','TEAM_ROSTER',                  1,0,0,0,1),
('hr','MANAGEMENT_DASHBOARD',         1,0,0,0,1),
('hr','KPI_DASHBOARD',                1,0,0,0,1),

-- LMS (Limited - HR can view learner progress)
('hr','LMS_MY_LEARNING',              1,0,0,0,1),
('hr','LMS_COORDINATOR',              1,0,0,0,1),
('hr','LMS_MANAGEMENT_DASHBOARD',     1,0,0,0,1),

-- WFM (View Only)
('hr','WFM_ROSTER',                   1,0,0,0,1),
('hr','WFM_LIVE_TRACKER',             1,0,0,0,1),
('hr','OPERATIONS_DASHBOARD',         1,0,0,0,1),

-- Quality (View Only)
('hr','QUALITY_DASHBOARD',            1,0,0,0,1),
('hr','QA_EVALUATION',                1,0,0,0,1),

-- Operations (View Only)
('hr','WORKFORCE_COMMAND_CENTER',     1,0,0,0,1),
('hr','PROCESS_DASHBOARD',            1,0,0,0,1),

-- Access Control (View Only)
('hr','ACCESS_CONTROL',               1,0,0,0,0)
ON DUPLICATE KEY UPDATE
  can_view=VALUES(can_view),
  can_create=VALUES(can_create),
  can_edit=VALUES(can_edit),
  can_delete=VALUES(can_delete),
  can_export=VALUES(can_export),
  active_status=1;

-- ============================================================================
-- STEP 3: Seed role_page_access for Recruiter role (Full ATS Access)
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- Full ATS Access
('recruiter','ATS_DASHBOARD',          1,1,1,0,1),
('recruiter','ATS_RECRUITER_QUEUE',    1,1,1,1,1),
('recruiter','ATS_CANDIDATE_POOL',     1,1,1,1,1),
('recruiter','ATS_INTERVIEW',          1,1,1,1,1),
('recruiter','ATS_OFFER',              1,1,1,0,1),
('recruiter','ATS_ONBOARDING',         1,1,1,0,1),

-- Employee Self-Service Access
('recruiter','EMPLOYEE_SELF_SERVICE',  1,0,0,0,0),
('recruiter','EMPLOYEE_PROFILE',       1,0,1,0,0),
('recruiter','LMS_MY_LEARNING',        1,0,0,0,0),
('recruiter','LEAVE_MANAGEMENT',       1,1,0,0,0)
ON DUPLICATE KEY UPDATE
  can_view=VALUES(can_view),
  can_create=VALUES(can_create),
  can_edit=VALUES(can_edit),
  can_delete=VALUES(can_delete),
  can_export=VALUES(can_export),
  active_status=1;

-- ============================================================================
-- STEP 4: Seed role_page_access for WFM role (Full WFM Access)
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- Full WFM Access
('wfm','WFM_ROSTER',                   1,1,1,0,1),
('wfm','WFM_LIVE_TRACKER',             1,1,1,0,1),
('wfm','WORKFORCE_COMMAND_CENTER',     1,1,1,0,1),
('wfm','OPERATIONS_DASHBOARD',         1,1,1,0,1),
('wfm','PROCESS_DASHBOARD',            1,1,1,0,1),

-- Team Views
('wfm','TEAM_ROSTER',                  1,1,1,0,1),
('wfm','TEAM_ATTENDANCE',              1,1,1,0,1),
('wfm','MANAGEMENT_DASHBOARD',         1,0,0,0,1),

-- Employee Directory (View Only)
('wfm','EMPLOYEE_DIRECTORY',           1,0,0,0,1),
('wfm','EMPLOYEE_PROFILE',             1,0,0,0,0),

-- Quality (View Only)
('wfm','QUALITY_DASHBOARD',            1,0,0,0,1),

-- KPI Dashboard (View)
('wfm','KPI_DASHBOARD',                1,0,0,0,1),

-- Leave (View for planning)
('wfm','LEAVE_MANAGEMENT',             1,0,0,0,1),

-- Self Service
('wfm','EMPLOYEE_SELF_SERVICE',        1,0,0,0,0),
('wfm','LMS_MY_LEARNING',              1,0,0,0,0)
ON DUPLICATE KEY UPDATE
  can_view=VALUES(can_view),
  can_create=VALUES(can_create),
  can_edit=VALUES(can_edit),
  can_delete=VALUES(can_delete),
  can_export=VALUES(can_export),
  active_status=1;

-- ============================================================================
-- STEP 5: Seed role_page_access for Trainer role (Full LMS Access)
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- Full LMS Access
('trainer','LMS_MY_LEARNING',          1,1,1,0,1),
('trainer','LMS_COORDINATOR',          1,1,1,0,1),
('trainer','LMS_ADMIN',                1,1,1,0,1),
('trainer','LMS_MANAGEMENT_DASHBOARD', 1,1,1,0,1),

-- Coaching & Training
('trainer','COACHING',                 1,1,1,0,1),
('trainer','TEAM_ROSTER',              1,0,0,0,1),
('trainer','TEAM_ATTENDANCE',          1,0,0,0,1),

-- Employee Views
('trainer','EMPLOYEE_PROFILE',         1,0,0,0,0),
('trainer','EMPLOYEE_DIRECTORY',       1,0,0,0,1),
('trainer','EMPLOYEE_SELF_SERVICE',    1,0,0,0,0),

-- Management Dashboard (View Only)
('trainer','MANAGEMENT_DASHBOARD',     1,0,0,0,0),

-- Quality (View Only)
('trainer','QUALITY_DASHBOARD',        1,0,0,0,1),
('trainer','QA_EVALUATION',            1,0,0,0,1),

-- Operations (View Only)
('trainer','OPERATIONS_DASHBOARD',     1,0,0,0,1),
('trainer','PROCESS_DASHBOARD',        1,0,0,0,1),

-- Leave (Own Leave)
('trainer','LEAVE_MANAGEMENT',         1,1,0,0,0)
ON DUPLICATE KEY UPDATE
  can_view=VALUES(can_view),
  can_create=VALUES(can_create),
  can_edit=VALUES(can_edit),
  can_delete=VALUES(can_delete),
  can_export=VALUES(can_export),
  active_status=1;

-- ============================================================================
-- STEP 6: Seed role_page_access for Employee role (Self-Service Access)
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- Self-Service Pages
('employee','EMPLOYEE_SELF_SERVICE',   1,0,0,0,0),
('employee','EMPLOYEE_PROFILE',        1,0,1,0,0),
('employee','EMPLOYEE_DIRECTORY',      1,0,0,0,0),

-- My Learning (LMS)
('employee','LMS_MY_LEARNING',         1,0,0,0,0),

-- Leave Management (View/Apply Only - No Edit/Delete/Approve)
('employee','LEAVE_MANAGEMENT',        1,1,0,0,0)
ON DUPLICATE KEY UPDATE
  can_view=VALUES(can_view),
  can_create=VALUES(can_create),
  can_edit=VALUES(can_edit),
  can_delete=VALUES(can_delete),
  can_export=VALUES(can_export),
  active_status=1;

-- ============================================================================
-- STEP 7: Seed role_page_access for Manager / Process Manager role
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- Management Dashboard & Team Access
('manager','MANAGEMENT_DASHBOARD',     1,0,0,0,1),
('manager','TEAM_ROSTER',              1,1,1,0,1),
('manager','TEAM_ATTENDANCE',          1,1,1,0,1),
('manager','COACHING',                 1,1,1,0,1),

-- Leave Management (Approve Only)
('manager','LEAVE_MANAGEMENT',         1,0,1,0,1),

-- WFM (View Only)
('manager','WFM_ROSTER',               1,0,0,0,1),
('manager','WFM_LIVE_TRACKER',         1,0,0,0,1),

-- KPI Dashboard (View)
('manager','KPI_DASHBOARD',            1,0,0,0,1),
('manager','OPERATIONS_DASHBOARD',     1,0,0,0,1),
('manager','PROCESS_DASHBOARD',        1,1,1,0,1),

-- ATS (View Only)
('manager','ATS_DASHBOARD',            1,0,0,0,1),
('manager','ATS_CANDIDATE_POOL',       1,0,0,0,1),
('manager','ATS_INTERVIEW',            1,0,0,0,1),

-- Employee Views
('manager','EMPLOYEE_PROFILE',         1,0,0,0,0),
('manager','EMPLOYEE_DIRECTORY',       1,0,0,0,1),
('manager','EMPLOYEE_SELF_SERVICE',    1,0,0,0,0),

-- Quality (View)
('manager','QUALITY_DASHBOARD',        1,0,0,0,1),
('manager','QA_EVALUATION',            1,0,0,0,1),
('manager','QA_CALIBRATION',           1,0,0,0,1),

-- LMS (View)
('manager','LMS_MY_LEARNING',          1,0,0,0,0),
('manager','LMS_MANAGEMENT_DASHBOARD', 1,0,0,0,1),

-- Workforce Command Center
('manager','WORKFORCE_COMMAND_CENTER', 1,0,0,0,1)
ON DUPLICATE KEY UPDATE
  can_view=VALUES(can_view),
  can_create=VALUES(can_create),
  can_edit=VALUES(can_edit),
  can_delete=VALUES(can_delete),
  can_export=VALUES(can_export),
  active_status=1;

-- ============================================================================
-- STEP 8: Seed role_page_access for Team Leader / TL role
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- Team Management (Limited vs Manager)
('tl','MANAGEMENT_DASHBOARD',          1,0,0,0,0),
('tl','TEAM_ROSTER',                   1,0,0,0,1),
('tl','TEAM_ATTENDANCE',               1,0,0,0,1),
('tl','COACHING',                      1,1,1,0,1),

-- Leave (Approve Only)
('tl','LEAVE_MANAGEMENT',              1,0,1,0,0),

-- WFM (View Only)
('tl','WFM_ROSTER',                    1,0,0,0,0),
('tl','WFM_LIVE_TRACKER',              1,0,0,0,0),

-- Operations (View Only)
('tl','OPERATIONS_DASHBOARD',          1,0,0,0,0),
('tl','PROCESS_DASHBOARD',             1,0,0,0,0),

-- KPI (View)
('tl','KPI_DASHBOARD',                 1,0,0,0,0),

-- Employee Views
('tl','EMPLOYEE_PROFILE',              1,0,0,0,0),
('tl','EMPLOYEE_DIRECTORY',            1,0,0,0,0),
('tl','EMPLOYEE_SELF_SERVICE',         1,0,0,0,0),

-- Quality (View + Evaluation)
('tl','QUALITY_DASHBOARD',             1,0,0,0,0),
('tl','QA_EVALUATION',                 1,1,1,0,0),

-- LMS (View)
('tl','LMS_MY_LEARNING',               1,0,0,0,0),
('tl','LMS_COORDINATOR',               1,0,0,0,0)
ON DUPLICATE KEY UPDATE
  can_view=VALUES(can_view),
  can_create=VALUES(can_create),
  can_edit=VALUES(can_edit),
  can_delete=VALUES(can_delete),
  can_export=VALUES(can_export),
  active_status=1;

-- ============================================================================
-- STEP 9: Seed role_page_access for QA role
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- Quality (Full Access)
('qa','QUALITY_DASHBOARD',             1,1,1,0,1),
('qa','QA_EVALUATION',                 1,1,1,1,1),
('qa','QA_CALIBRATION',                1,1,1,0,1),

-- Operations (View)
('qa','OPERATIONS_DASHBOARD',          1,0,0,0,1),
('qa','PROCESS_DASHBOARD',             1,0,0,0,1),
('qa','WORKFORCE_COMMAND_CENTER',      1,0,0,0,1),

-- Team Views
('qa','TEAM_ROSTER',                   1,0,0,0,1),
('qa','TEAM_ATTENDANCE',               1,0,0,0,1),
('qa','EMPLOYEE_DIRECTORY',            1,0,0,0,1),
('qa','EMPLOYEE_PROFILE',              1,0,0,0,0),

-- KPI (View)
('qa','KPI_DASHBOARD',                 1,0,0,0,1),

-- WFM (View)
('qa','WFM_ROSTER',                    1,0,0,0,1),
('qa','WFM_LIVE_TRACKER',              1,0,0,0,1),

-- ATS (View)
('qa','ATS_DASHBOARD',                 1,0,0,0,1),

-- LMS (View)
('qa','LMS_MY_LEARNING',               1,0,0,0,0),

-- Self Service
('qa','EMPLOYEE_SELF_SERVICE',         1,0,0,0,0),
('qa','LEAVE_MANAGEMENT',              1,1,0,0,0),
('qa','MANAGEMENT_DASHBOARD',          1,0,0,0,0)
ON DUPLICATE KEY UPDATE
  can_view=VALUES(can_view),
  can_create=VALUES(can_create),
  can_edit=VALUES(can_edit),
  can_delete=VALUES(can_delete),
  can_export=VALUES(can_export),
  active_status=1;

-- ============================================================================
-- STEP 10: Seed role_page_access for Finance role
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- Finance (Full Access)
('finance','FINANCE_DASHBOARD',         1,1,1,0,1),
('finance','SALARY_PREP',               1,1,1,0,1),
('finance','PAYROLL',                   1,1,1,0,1),
('finance','KPI_DASHBOARD',             1,0,0,0,1),
('finance','OPERATIONS_DASHBOARD',      1,0,0,0,1),

-- Employee Views
('finance','EMPLOYEE_DIRECTORY',        1,0,0,0,1),
('finance','EMPLOYEE_PROFILE',          1,0,0,0,0),

-- WFM (View)
('finance','WFM_ROSTER',                1,0,0,0,1),

-- Management
('finance','MANAGEMENT_DASHBOARD',      1,0,0,0,1),

-- Self Service
('finance','EMPLOYEE_SELF_SERVICE',     1,0,0,0,0),
('finance','EMPLOYEE_PROFILE',          1,0,0,0,0),
('finance','LEAVE_MANAGEMENT',          1,1,0,0,0),
('finance','LMS_MY_LEARNING',           1,0,0,0,0)
ON DUPLICATE KEY UPDATE
  can_view=VALUES(can_view),
  can_create=VALUES(can_create),
  can_edit=VALUES(can_edit),
  can_delete=VALUES(can_delete),
  can_export=VALUES(can_export),
  active_status=1;

-- ============================================================================
-- STEP 11: Seed role_page_access for Payroll role
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- Payroll & Finance (Full Access)
('payroll','PAYROLL',                   1,1,1,0,1),
('payroll','FINANCE_DASHBOARD',         1,0,0,0,1),
('payroll','SALARY_PREP',               1,1,1,0,1),
('payroll','KPI_DASHBOARD',             1,0,0,0,1),

-- Employee Views
('payroll','EMPLOYEE_DIRECTORY',        1,0,0,0,1),
('payroll','EMPLOYEE_PROFILE',          1,0,0,0,0),

-- WFM (View for payroll calculation)
('payroll','WFM_ROSTER',                1,0,0,0,1),
('payroll','WFM_LIVE_TRACKER',          1,0,0,0,1),

-- Leave (View for LWP calculation)
('payroll','LEAVE_MANAGEMENT',          1,0,0,0,1),

-- Self Service
('payroll','EMPLOYEE_SELF_SERVICE',     1,0,0,0,0),
('payroll','LMS_MY_LEARNING',           1,0,0,0,0)
ON DUPLICATE KEY UPDATE
  can_view=VALUES(can_view),
  can_create=VALUES(can_create),
  can_edit=VALUES(can_edit),
  can_delete=VALUES(can_delete),
  can_export=VALUES(can_export),
  active_status=1;

-- ============================================================================
-- STEP 12: Seed role_page_access for Branch Head role (Branch-Level Full Access)
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- Branch Head gets full branch-level access
('branch_head','EMPLOYEE_MANAGEMENT',           1,1,1,0,1),
('branch_head','EMPLOYEE_DIRECTORY',            1,1,1,0,1),
('branch_head','EMPLOYEE_PROFILE',              1,0,0,0,1),
('branch_head','EMPLOYEE_SELF_SERVICE',         1,0,0,0,0),

('branch_head','MANAGEMENT_DASHBOARD',          1,1,1,0,1),
('branch_head','TEAM_ROSTER',                   1,1,1,0,1),
('branch_head','TEAM_ATTENDANCE',               1,1,1,0,1),
('branch_head','COACHING',                      1,1,1,0,1),

('branch_head','ATS_DASHBOARD',                 1,1,1,0,1),
('branch_head','ATS_RECRUITER_QUEUE',           1,1,1,0,1),
('branch_head','ATS_CANDIDATE_POOL',            1,1,1,0,1),
('branch_head','ATS_INTERVIEW',                 1,1,1,0,1),
('branch_head','ATS_OFFER',                     1,1,1,0,1),
('branch_head','ATS_ONBOARDING',                1,1,1,0,1),

('branch_head','WFM_ROSTER',                    1,1,1,0,1),
('branch_head','WFM_LIVE_TRACKER',              1,1,1,0,1),
('branch_head','WORKFORCE_COMMAND_CENTER',      1,1,1,0,1),
('branch_head','OPERATIONS_DASHBOARD',          1,1,1,0,1),
('branch_head','PROCESS_DASHBOARD',             1,1,1,0,1),

('branch_head','QUALITY_DASHBOARD',             1,1,1,0,1),
('branch_head','QA_EVALUATION',                 1,1,1,0,1),
('branch_head','QA_CALIBRATION',                1,1,1,0,1),

('branch_head','LMS_MY_LEARNING',               1,1,1,0,1),
('branch_head','LMS_COORDINATOR',               1,1,1,0,1),
('branch_head','LMS_MANAGEMENT_DASHBOARD',      1,1,1,0,1),

('branch_head','LEAVE_MANAGEMENT',              1,1,1,0,1),
('branch_head','SALARY_PREP',                   1,1,1,0,1),
('branch_head','PAYROLL',                       1,0,1,0,1),
('branch_head','FINANCE_DASHBOARD',             1,0,0,0,1),

('branch_head','KPI_DASHBOARD',                 1,1,1,0,1),
('branch_head','CLIENT_PORTAL_ADMIN',           1,1,1,0,1),

('branch_head','ACCESS_CONTROL',                1,1,1,0,1)
ON DUPLICATE KEY UPDATE
  can_view=VALUES(can_view),
  can_create=VALUES(can_create),
  can_edit=VALUES(can_edit),
  can_delete=VALUES(can_delete),
  can_export=VALUES(can_export),
  active_status=1;

-- ============================================================================
-- STEP 13: Seed role_page_access for CEO role (Full Access to All)
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- CEO gets full access to everything
('ceo','EMPLOYEE_MANAGEMENT',           1,1,1,1,1),
('ceo','EMPLOYEE_DIRECTORY',            1,1,1,1,1),
('ceo','EMPLOYEE_PROFILE',              1,1,1,0,1),
('ceo','EMPLOYEE_SELF_SERVICE',         1,0,0,0,0),

('ceo','MANAGEMENT_DASHBOARD',          1,1,1,0,1),
('ceo','TEAM_ROSTER',                   1,1,1,0,1),
('ceo','TEAM_ATTENDANCE',               1,1,1,0,1),
('ceo','COACHING',                      1,1,1,0,1),

('ceo','ATS_DASHBOARD',                 1,1,1,1,1),
('ceo','ATS_RECRUITER_QUEUE',           1,1,1,1,1),
('ceo','ATS_CANDIDATE_POOL',            1,1,1,1,1),
('ceo','ATS_INTERVIEW',                 1,1,1,1,1),
('ceo','ATS_OFFER',                     1,1,1,1,1),
('ceo','ATS_ONBOARDING',                1,1,1,1,1),

('ceo','WFM_ROSTER',                    1,1,1,1,1),
('ceo','WFM_LIVE_TRACKER',              1,1,1,1,1),
('ceo','WORKFORCE_COMMAND_CENTER',      1,1,1,1,1),
('ceo','OPERATIONS_DASHBOARD',          1,1,1,1,1),
('ceo','PROCESS_DASHBOARD',             1,1,1,1,1),

('ceo','QUALITY_DASHBOARD',             1,1,1,1,1),
('ceo','QA_EVALUATION',                 1,1,1,1,1),
('ceo','QA_CALIBRATION',                1,1,1,1,1),

('ceo','LMS_MY_LEARNING',               1,1,1,1,1),
('ceo','LMS_COORDINATOR',               1,1,1,1,1),
('ceo','LMS_ADMIN',                     1,1,1,1,1),
('ceo','LMS_MANAGEMENT_DASHBOARD',      1,1,1,1,1),

('ceo','LEAVE_MANAGEMENT',              1,1,1,1,1),
('ceo','SALARY_PREP',                   1,1,1,1,1),
('ceo','PAYROLL',                       1,1,1,0,1),
('ceo','FINANCE_DASHBOARD',             1,1,1,0,1),

('ceo','KPI_DASHBOARD',                 1,1,1,0,1),
('ceo','CLIENT_PORTAL_ADMIN',           1,1,1,0,1),

('ceo','ACCESS_CONTROL',                1,1,1,1,1),
('ceo','DIALER_INTEGRATION',            1,1,1,1,1),
('ceo','ISPARK_MIGRATION',              1,1,1,1,1),
('ceo','INTEGRATION_HUB',               1,1,1,1,1),
('ceo','MIGRATION_CONSOLE',             1,1,1,1,1)
ON DUPLICATE KEY UPDATE
  can_view=VALUES(can_view),
  can_create=VALUES(can_create),
  can_edit=VALUES(can_edit),
  can_delete=VALUES(can_delete),
  can_export=VALUES(can_export),
  active_status=1;

-- ============================================================================
-- STEP 14: Remove any stale/inactive entries that may conflict
-- ============================================================================

-- Ensure all newly added entries are active
UPDATE role_page_access SET active_status = 1 WHERE role_key IN (
  'hr', 'recruiter', 'wfm', 'trainer', 'employee', 'manager', 
  'tl', 'qa', 'finance', 'payroll', 'branch_head', 'ceo'
);

-- ============================================================================
-- Summary Statistics (for verification)
-- ============================================================================

SELECT 
  role_key,
  COUNT(*) as page_count,
  SUM(can_view) as can_view_pages,
  SUM(can_create) as can_create_pages,
  SUM(can_edit) as can_edit_pages
FROM role_page_access 
WHERE active_status = 1
GROUP BY role_key
ORDER BY page_count DESC;
