-- Drop exact-duplicate secondary indexes in mas_hrms.
--
-- Generated from information_schema on 2026-08-10. Each index below has a surviving twin on the
-- same table over the same ordered column list, so no access path is lost: the optimiser can use
-- the kept index anywhere it used the dropped one.
--
-- Why this is worth doing: the server runs a 128 MB InnoDB buffer pool against a 3.4 GB database
-- with 0 MB free. Index pages compete with data for that cache. `employees` alone carries
-- 180 MB of index against 39 MB of data, including FOUR separate indexes on employee_code.
--
-- Safety rules applied when generating this:
--   * PRIMARY is never touched.
--   * Where a duplicate group contains a UNIQUE index, the UNIQUE one is KEPT and only its
--     non-unique twins are dropped, so no constraint is removed.
--   * Groups with more than one unique index are omitted entirely and listed at the bottom for
--     a human to decide.
--
-- NOT EXECUTED. Dropping an index takes a metadata lock; run it in a maintenance window, and
-- take a backup first. Every statement is reversible by recreating the named index.

-- ai_provider_config
DROP INDEX `idx_provider_key` ON `ai_provider_config`;  -- duplicate of `provider_key` (provider_key)

-- ats_candidate
DROP INDEX `idx_ats_status` ON `ats_candidate`;  -- duplicate of `idx_ats_candidate_status` (status)
DROP INDEX `idx_cand_mobile` ON `ats_candidate`;  -- duplicate of `idx_ats_mobile` (mobile)

-- ats_candidate_portal_access
DROP INDEX `idx_candidate` ON `ats_candidate_portal_access`;  -- duplicate of `candidate_id` (candidate_id)

-- ats_candidate_portal_login
DROP INDEX `idx_email` ON `ats_candidate_portal_login`;  -- duplicate of `email` (email)

-- ats_recruiter_hiring_activity
DROP INDEX `idx_mobile` ON `ats_recruiter_hiring_activity`;  -- duplicate of `idx_arha_mobile` (mobile)

-- ats_recruiter_session
DROP INDEX `idx_session_token` ON `ats_recruiter_session`;  -- duplicate of `session_token` (session_token)

-- attendance_daily_record
DROP INDEX `idx_adr_emp_date` ON `attendance_daily_record`;  -- duplicate of `uq_emp_date` (employee_id,record_date)

-- auth_password_reset
DROP INDEX `idx_prt_token` ON `auth_password_reset`;  -- duplicate of `token_hash` (token_hash)

-- auth_refresh_token
DROP INDEX `idx_rt_token` ON `auth_refresh_token`;  -- duplicate of `token_hash` (token_hash)

-- auth_user
DROP INDEX `idx_auth_email` ON `auth_user`;  -- duplicate of `email` (email)

-- biometric_attendance_log
DROP INDEX `idx_bio_emp_date` ON `biometric_attendance_log`;  -- duplicate of `uq_bio_emp_date` (employee_id,punch_date)

-- biometric_device_master
DROP INDEX `idx_bio_device_uid` ON `biometric_device_master`;  -- duplicate of `device_uid` (device_uid)

-- brain_teaser
DROP INDEX `idx_teaser_date` ON `brain_teaser`;  -- duplicate of `teaser_date` (teaser_date)

-- candidate_digilocker_sessions
DROP INDEX `idx_state` ON `candidate_digilocker_sessions`;  -- duplicate of `state` (state)

-- candidate_name_match_summary
DROP INDEX `idx_candidate` ON `candidate_name_match_summary`;  -- duplicate of `uq_candidate` (candidate_id)

-- candidate_payroll_review_flags
DROP INDEX `idx_candidate` ON `candidate_payroll_review_flags`;  -- duplicate of `candidate_id` (candidate_id)

-- career_path
DROP INDEX `idx_career_emp` ON `career_path`;  -- duplicate of `uq_career_emp` (employee_id)

-- communication_preferences
DROP INDEX `idx_employee_id` ON `communication_preferences`;  -- duplicate of `employee_id` (employee_id)

-- cost_centre_master
DROP INDEX `idx_cost_centre_canonical_code` ON `cost_centre_master`;  -- duplicate of `cost_centre_code` (cost_centre_code)
DROP INDEX `idx_ccm_process_id` ON `cost_centre_master`;  -- duplicate of `idx_cc_process` (process_id)

-- customization_cache
DROP INDEX `idx_cache_key` ON `customization_cache`;  -- duplicate of `cache_key` (cache_key)

-- daily_tip
DROP INDEX `idx_tip_date` ON `daily_tip`;  -- duplicate of `tip_date` (tip_date)

-- daily_trivia_question
DROP INDEX `idx_trivia_date` ON `daily_trivia_question`;  -- duplicate of `question_date` (question_date)

-- daily_word_puzzle
DROP INDEX `idx_puzzle_date` ON `daily_word_puzzle`;  -- duplicate of `puzzle_date` (puzzle_date)

-- dashboard_metric_snapshot
DROP INDEX `idx_metric_scope` ON `dashboard_metric_snapshot`;  -- duplicate of `uq_metric_scope_date` (metric_code,scope_type,scope_id,snapshot_date)

-- email_template_master
DROP INDEX `idx_key` ON `email_template_master`;  -- duplicate of `template_key` (template_key)

-- employee_client_mapping
DROP INDEX `idx_client_map_emp` ON `employee_client_mapping`;  -- duplicate of `uq_emp_client` (employee_id)

-- employee_deductions_log
DROP INDEX `idx_legacy_deduction` ON `employee_deductions_log`;  -- duplicate of `legacy_deduction_id` (legacy_deduction_id)

-- employee_exit_record
DROP INDEX `idx_last_30d` ON `employee_exit_record`;  -- duplicate of `idx_exit_date` (exit_date)

-- employee_legacy_meta
DROP INDEX `idx_legacy_meta_emp` ON `employee_legacy_meta`;  -- duplicate of `employee_id` (employee_id)

-- employee_loans
DROP INDEX `idx_legacy_loan` ON `employee_loans`;  -- duplicate of `legacy_loan_id` (legacy_loan_id)

-- employee_probation
DROP INDEX `idx_prob_emp` ON `employee_probation`;  -- duplicate of `employee_id` (employee_id)

-- employee_salary_snapshot
DROP INDEX `idx_salary_emp` ON `employee_salary_snapshot`;  -- duplicate of `employee_id` (employee_id)

-- employee_statutory_info
DROP INDEX `idx_statutory_emp` ON `employee_statutory_info`;  -- duplicate of `employee_id` (employee_id)

-- employee_tier_status
DROP INDEX `idx_employee` ON `employee_tier_status`;  -- duplicate of `employee_id` (employee_id)

-- employee_uan
DROP INDEX `idx_uan_emp` ON `employee_uan`;  -- duplicate of `employee_id` (employee_id)

-- employees
DROP INDEX `idx_emp_code` ON `employees`;  -- duplicate of `employee_code` (employee_code)
DROP INDEX `idx_employees_directory_code` ON `employees`;  -- duplicate of `employee_code` (employee_code)
DROP INDEX `idx_employees_employee_code` ON `employees`;  -- duplicate of `employee_code` (employee_code)
DROP INDEX `idx_employees_directory_status_process` ON `employees`;  -- duplicate of `idx_emp_active_process` (active_status,process_id)
DROP INDEX `idx_employees_department_id` ON `employees`;  -- duplicate of `idx_emp_dept` (department_id)
DROP INDEX `idx_employees_designation_id` ON `employees`;  -- duplicate of `idx_emp_desig` (designation_id)
DROP INDEX `idx_employees_reporting_manager_id` ON `employees`;  -- duplicate of `idx_emp_mgr` (reporting_manager_id)
DROP INDEX `idx_employees_mobile` ON `employees`;  -- duplicate of `idx_emp_mobile` (mobile)

-- escalation_matrix_master
DROP INDEX `idx_task_level` ON `escalation_matrix_master`;  -- duplicate of `uq_escalation_task_level` (task_type,escalation_level)

-- finance_budget_header
DROP INDEX `idx_budget_branch_period` ON `finance_budget_header`;  -- duplicate of `uq_budget_branch_period` (branch_id,period_code)

-- gamification_tier_master
DROP INDEX `idx_level` ON `gamification_tier_master`;  -- duplicate of `tier_level` (tier_level)

-- grn_request
DROP INDEX `idx_grn_number` ON `grn_request`;  -- duplicate of `uq_grn_number` (grn_number)

-- integration_biometric_daily
DROP INDEX `idx_ibd_activity_date` ON `integration_biometric_daily`;  -- duplicate of `idx_biometric_daily_date` (activity_date)

-- integration_config
DROP INDEX `idx_integration_key` ON `integration_config`;  -- duplicate of `integration_key` (integration_key)

-- jclr_entries
DROP INDEX `idx_jclr_cand` ON `jclr_entries`;  -- duplicate of `candidate_id` (candidate_id)

-- job_requisition
DROP INDEX `idx_jr_code` ON `job_requisition`;  -- duplicate of `requisition_code` (requisition_code)

-- leave_request
DROP INDEX `idx_lr_status` ON `leave_request`;  -- duplicate of `idx_leave_status` (status)

-- legacy_salary_snapshot
DROP INDEX `idx_emp_code` ON `legacy_salary_snapshot`;  -- duplicate of `uk_emp_code` (employee_code)

-- notification_template
DROP INDEX `idx_template_code` ON `notification_template`;  -- duplicate of `template_code` (template_code)

-- onboarding_penny_drop_requests
DROP INDEX `idx_request_id` ON `onboarding_penny_drop_requests`;  -- duplicate of `request_id` (request_id)

-- org_settings
DROP INDEX `idx_setting_key` ON `org_settings`;  -- duplicate of `setting_key` (setting_key)

-- password_reset_tokens
DROP INDEX `idx_reset_token` ON `password_reset_tokens`;  -- duplicate of `reset_token` (reset_token)

-- performance_feedback_report
DROP INDEX `idx_cycle_employee` ON `performance_feedback_report`;  -- duplicate of `unique_report` (cycle_id,employee_id)

-- portal_user_sessions
DROP INDEX `idx_pus_jti` ON `portal_user_sessions`;  -- duplicate of `jti` (jti)

-- process_weekoff_capacity
DROP INDEX `idx_process_day` ON `process_weekoff_capacity`;  -- duplicate of `uk_process_day` (process_id,day_of_week)

-- salary_prep_line
DROP INDEX `idx_spl_run_emp` ON `salary_prep_line`;  -- duplicate of `uq_run_emp` (run_id,employee_id)

-- salary_prep_line_archive_20260731
DROP INDEX `idx_spl_run_emp` ON `salary_prep_line_archive_20260731`;  -- duplicate of `uq_run_emp` (run_id,employee_id)

-- statutory_config_version
DROP INDEX `idx_scv_key_from` ON `statutory_config_version`;  -- duplicate of `uq_scv_key_effective` (config_key,effective_from)

-- tax_declaration
DROP INDEX `idx_td_emp_fy` ON `tax_declaration`;  -- duplicate of `uq_taxdecl_emp_year` (employee_id,financial_year)

-- upload_batch
DROP INDEX `idx_batch_no` ON `upload_batch`;  -- duplicate of `upload_batch_no` (upload_batch_no)

-- upload_batch_row
DROP INDEX `idx_batch_row` ON `upload_batch_row`;  -- duplicate of `uq_batch_row` (upload_batch_id,row_no)

-- wfm_attendance_session
DROP INDEX `idx_was_emp_date` ON `wfm_attendance_session`;  -- duplicate of `uq_emp_session_date` (employee_id,session_date)

