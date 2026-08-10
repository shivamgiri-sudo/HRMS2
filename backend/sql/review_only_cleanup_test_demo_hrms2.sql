-- REVIEW ONLY
-- DO NOT RUN WITHOUT APPROVAL
--
-- Purpose:
--   Remove only HRMS2 lifecycle smoke rows created with the TEST DEMO prefix.
--   This script is intentionally written for manual review and must not be run
--   until a human validates the SELECT previews and dependency order.
--
-- Known markers:
--   full_name LIKE 'TEST DEMO%'
--   first_name = 'TEST DEMO'
--   email / official_email LIKE 'test.demo.%'
--   remarks / evidence_note / metadata contain TEST DEMO or TEST_DEMO_HRMS2_SMOKE
--   employee_code LIKE 'TDEMP%' or role-smoke employee_code REGEXP '^TD[0-9]'

START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS _td_candidates;
CREATE TEMPORARY TABLE _td_candidates (id CHAR(36) PRIMARY KEY)
SELECT id
  FROM ats_candidate
 WHERE full_name LIKE 'TEST DEMO%'
    OR email LIKE 'test.demo.%'
    OR remarks LIKE '%TEST DEMO%'
    OR candidate_code LIKE 'TDCAND%';

DROP TEMPORARY TABLE IF EXISTS _td_employees;
CREATE TEMPORARY TABLE _td_employees (id CHAR(36) PRIMARY KEY)
SELECT id
  FROM employees
 WHERE first_name = 'TEST DEMO'
    OR email LIKE 'test.demo.%'
    OR official_email LIKE 'test.demo.%'
    OR employee_code LIKE 'TDEMP%'
    OR employee_code REGEXP '^TD[0-9]';

DROP TEMPORARY TABLE IF EXISTS _td_auth_users;
CREATE TEMPORARY TABLE _td_auth_users (id CHAR(36) PRIMARY KEY)
SELECT id
  FROM auth_user
 WHERE email LIKE 'test.demo.%'
UNION
SELECT user_id
  FROM employees
 WHERE user_id IS NOT NULL
   AND id IN (SELECT id FROM _td_employees);

DROP TEMPORARY TABLE IF EXISTS _td_payroll_validations;
CREATE TEMPORARY TABLE _td_payroll_validations (id CHAR(36) PRIMARY KEY)
SELECT id
  FROM ats_payroll_hr_validation
 WHERE candidate_id IN (SELECT id FROM _td_candidates);

DROP TEMPORARY TABLE IF EXISTS _td_bgv_verifications;
CREATE TEMPORARY TABLE _td_bgv_verifications (id INT PRIMARY KEY)
SELECT id
  FROM ats_bgv_verification
 WHERE candidate_id IN (SELECT id FROM _td_candidates);

DROP TEMPORARY TABLE IF EXISTS _td_master_branch;
CREATE TEMPORARY TABLE _td_master_branch (id CHAR(36) PRIMARY KEY)
SELECT id FROM branch_master WHERE branch_name LIKE 'TEST DEMO%';

DROP TEMPORARY TABLE IF EXISTS _td_master_process;
CREATE TEMPORARY TABLE _td_master_process (id CHAR(36) PRIMARY KEY)
SELECT id FROM process_master WHERE process_name LIKE 'TEST DEMO%';

DROP TEMPORARY TABLE IF EXISTS _td_master_department;
CREATE TEMPORARY TABLE _td_master_department (id CHAR(36) PRIMARY KEY)
SELECT id FROM department_master WHERE dept_name LIKE 'TEST DEMO%';

DROP TEMPORARY TABLE IF EXISTS _td_master_designation;
CREATE TEMPORARY TABLE _td_master_designation (id CHAR(36) PRIMARY KEY)
SELECT id FROM designation_master WHERE designation_name LIKE 'TEST DEMO%';

DROP TEMPORARY TABLE IF EXISTS _td_master_cost_centre;
CREATE TEMPORARY TABLE _td_master_cost_centre (id CHAR(36) PRIMARY KEY)
SELECT id FROM cost_centre_master WHERE cost_centre_name LIKE 'TEST DEMO%';

DROP TEMPORARY TABLE IF EXISTS _td_master_salary_slab;
CREATE TEMPORARY TABLE _td_master_salary_slab (id CHAR(36) PRIMARY KEY)
SELECT id FROM salary_slab_master WHERE label LIKE 'TEST DEMO%' OR slab_code LIKE 'TD-SLAB-%';

DROP TEMPORARY TABLE IF EXISTS _td_master_salary_structure;
CREATE TEMPORARY TABLE _td_master_salary_structure (id CHAR(36) PRIMARY KEY)
SELECT id FROM salary_structure_master WHERE structure_name LIKE 'TEST DEMO%' OR structure_code LIKE 'TD-STR-%';

DROP TEMPORARY TABLE IF EXISTS _td_master_leave_type;
CREATE TEMPORARY TABLE _td_master_leave_type (id CHAR(36) PRIMARY KEY)
SELECT id FROM leave_type_master WHERE leave_name LIKE 'TEST DEMO%' OR leave_code LIKE 'TDL%';

-- Preview first. Abort manually if these counts include anything unexpected.
SELECT 'ats_candidate' AS table_name, COUNT(*) AS rows_to_delete FROM _td_candidates;
SELECT 'employees' AS table_name, COUNT(*) AS rows_to_delete FROM _td_employees;
SELECT 'auth_user' AS table_name, COUNT(*) AS rows_to_delete FROM _td_auth_users;
SELECT 'it_provisioning_request' AS table_name, COUNT(*) AS rows_to_delete
  FROM it_provisioning_request
 WHERE employee_id IN (SELECT id FROM _td_employees)
    OR evidence_note LIKE '%TEST_DEMO_HRMS2_SMOKE%';

-- Dependency delete order.

-- Appointment / provisioning / tasks
DELETE FROM appointment_letter_request
 WHERE candidate_id IN (SELECT id FROM _td_candidates)
    OR employee_id IN (SELECT id FROM _td_employees);

DELETE FROM it_provisioning_request
 WHERE employee_id IN (SELECT id FROM _td_employees)
    OR evidence_note LIKE '%TEST_DEMO_HRMS2_SMOKE%';

DELETE FROM employee_task_comment
 WHERE task_id IN (SELECT id FROM employee_task WHERE employee_id IN (SELECT id FROM _td_employees));
DELETE FROM employee_task_checklist
 WHERE task_id IN (SELECT id FROM employee_task WHERE employee_id IN (SELECT id FROM _td_employees));
DELETE FROM employee_task
 WHERE employee_id IN (SELECT id FROM _td_employees)
    OR title LIKE 'TEST DEMO%'
    OR description LIKE '%TEST_DEMO_HRMS2_SMOKE%';

-- Leave ledger
DELETE FROM leave_balance_ledger WHERE employee_id IN (SELECT id FROM _td_employees);
DELETE FROM leave_el_accrual_ledger WHERE employee_id IN (SELECT id FROM _td_employees);
DELETE FROM leave_el_credit_log WHERE employee_id IN (SELECT id FROM _td_employees);
DELETE FROM leave_request WHERE employee_id IN (SELECT id FROM _td_employees);

-- Salary assignment / snapshot
DELETE FROM employee_salary_assignment WHERE employee_id IN (SELECT id FROM _td_employees);
DELETE FROM employee_salary_snapshot WHERE employee_id IN (SELECT id FROM _td_employees);
DELETE FROM payroll_employee_component_snapshot WHERE employee_id IN (SELECT id FROM _td_employees);

-- Nominee and employee-adjacent child rows
DELETE FROM employee_nominee WHERE employee_id IN (SELECT id FROM _td_employees);
DELETE FROM employee_address WHERE employee_id IN (SELECT id FROM _td_employees);
DELETE FROM employee_bank_detail WHERE employee_id IN (SELECT id FROM _td_employees);
DELETE FROM employee_emergency_contact WHERE employee_id IN (SELECT id FROM _td_employees);
DELETE FROM employee_statutory_info WHERE employee_id IN (SELECT id FROM _td_employees);
DELETE FROM employee_roster_preference WHERE employee_id IN (SELECT id FROM _td_employees);

-- Journey / lifecycle logs
DELETE FROM employee_journey_log WHERE employee_id IN (SELECT id FROM _td_employees);
DELETE FROM employee_lifecycle_event WHERE employee_id IN (SELECT id FROM _td_employees);
DELETE FROM employee_exit_record WHERE employee_id IN (SELECT id FROM _td_employees);

-- BGV details and BGV verification
DELETE FROM ats_bgv_verification_details
 WHERE candidate_id IN (SELECT id FROM _td_candidates)
    OR bgv_id IN (SELECT id FROM _td_bgv_verifications)
    OR CAST(result_data AS CHAR) LIKE '%TEST_DEMO_HRMS2_SMOKE%';

DELETE FROM candidate_bgv_api_request_log WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM candidate_bgv_verification_event WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM candidate_bank_verification WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM candidate_bgv_report WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM candidate_bgv_check WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM candidate_bgv_consent WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM ats_bgv_verification WHERE id IN (SELECT id FROM _td_bgv_verifications);

-- Payroll validation / proposal
DELETE FROM ats_branch_head_approval WHERE payroll_validation_id IN (SELECT id FROM _td_payroll_validations);
DELETE FROM salary_exception_proposal WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM ats_payroll_hr_validation WHERE id IN (SELECT id FROM _td_payroll_validations);

-- Branch approvals / offers
DELETE FROM ats_employment_offer WHERE candidate_id IN (SELECT id FROM _td_candidates);

-- Onboarding bridge / request
DELETE FROM ats_onboarding_bridge WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM ats_onboarding_request WHERE candidate_id IN (SELECT id FROM _td_candidates);

-- Candidate stage logs, queue, interview, email
DELETE FROM ats_email_log WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM ats_interview_result WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM ats_interview_assignment WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM ats_queue_token WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM ats_candidate_stage_log WHERE candidate_id IN (SELECT id FROM _td_candidates);

-- Candidate documents / onboarding profile / bank / family / qualification / experience
DELETE FROM candidate_onboarding_submission_log WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM candidate_onboarding_document WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM candidate_onboarding_bank_detail WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM candidate_onboarding_family WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM candidate_onboarding_qualification WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM candidate_onboarding_experience WHERE candidate_id IN (SELECT id FROM _td_candidates);
DELETE FROM candidate_onboarding_profile WHERE candidate_id IN (SELECT id FROM _td_candidates);

-- Auth children for test.demo only
DELETE FROM auth_refresh_token WHERE user_id IN (SELECT id FROM _td_auth_users);
DELETE FROM auth_two_factor_challenge WHERE user_id IN (SELECT id FROM _td_auth_users);
DELETE FROM auth_password_history WHERE user_id IN (SELECT id FROM _td_auth_users);
DELETE FROM user_page_access WHERE user_id IN (SELECT id FROM _td_auth_users);
DELETE FROM user_roles WHERE user_id IN (SELECT id FROM _td_auth_users);

-- Employees
DELETE FROM employees WHERE id IN (SELECT id FROM _td_employees);

-- Auth users
DELETE FROM auth_user
 WHERE id IN (SELECT id FROM _td_auth_users)
   AND email LIKE 'test.demo.%';

-- ATS candidate roots
DELETE FROM ats_candidate WHERE id IN (SELECT id FROM _td_candidates);

-- Smoke-only recruiter/master data. Review counts before running.
DELETE FROM ats_recruiter_roster
 WHERE name LIKE 'TEST DEMO%'
    OR email LIKE 'test.demo.recruiter.%'
    OR notes LIKE '%TEST DEMO%';

DELETE FROM salary_structure_master WHERE id IN (SELECT id FROM _td_master_salary_structure);
DELETE FROM salary_slab_master WHERE id IN (SELECT id FROM _td_master_salary_slab);
DELETE FROM leave_type_master WHERE id IN (SELECT id FROM _td_master_leave_type);
DELETE FROM cost_centre_master WHERE id IN (SELECT id FROM _td_master_cost_centre);
DELETE FROM designation_master WHERE id IN (SELECT id FROM _td_master_designation);
DELETE FROM department_master WHERE id IN (SELECT id FROM _td_master_department);
DELETE FROM process_master WHERE id IN (SELECT id FROM _td_master_process);
DELETE FROM branch_master WHERE id IN (SELECT id FROM _td_master_branch);

-- Role catalog rows are normal role keys created by smoke only if absent.
-- This guarded delete skips any role with remaining non-test assignments.
DELETE wrc
  FROM workforce_role_catalog wrc
 WHERE (wrc.role_name LIKE 'TEST DEMO%' OR wrc.description LIKE '%TEST_DEMO_HRMS2_SMOKE%')
   AND NOT EXISTS (
     SELECT 1
       FROM user_roles ur
       JOIN auth_user au ON au.id = ur.user_id
      WHERE ur.role_key = wrc.role_key
        AND au.email NOT LIKE 'test.demo.%'
   );

-- Final preview after deletes, before manual COMMIT.
SELECT 'remaining ats_candidate TEST DEMO' AS check_name, COUNT(*) AS remaining
  FROM ats_candidate
 WHERE full_name LIKE 'TEST DEMO%' OR email LIKE 'test.demo.%';
SELECT 'remaining employees TEST DEMO' AS check_name, COUNT(*) AS remaining
  FROM employees
 WHERE first_name = 'TEST DEMO' OR email LIKE 'test.demo.%' OR official_email LIKE 'test.demo.%';
SELECT 'remaining auth_user TEST DEMO' AS check_name, COUNT(*) AS remaining
  FROM auth_user
 WHERE email LIKE 'test.demo.%';

-- Keep rollback as the default review posture.
-- Change ROLLBACK to COMMIT only after review and explicit approval.
ROLLBACK;
