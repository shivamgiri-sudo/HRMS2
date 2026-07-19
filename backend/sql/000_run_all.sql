-- 000_run_all.sql
-- MAS PeopleOS HRMS — Full Schema Bootstrap Script
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- PURPOSE
--   Manual DBA bootstrap for fresh installs, DR restores, and staging resets.
--   Sources all migrations in the same order as MIGRATION_MANIFEST in
--   backend/src/db/runPendingMigrations.ts.
--
-- AUTHORITATIVE RUNNER
--   The app's startup runPendingMigrations() is the ONLY supported production
--   install method. This script is a convenience for manual environments only.
--   If this file and MIGRATION_MANIFEST diverge, MIGRATION_MANIFEST wins.
--
-- USAGE
--   mysql -u root -p mas_hrms < sql/000_run_all.sql
--   (Run from the backend/ directory so relative SOURCE paths resolve correctly)
--
-- NOTES
--   - All migrations use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS,
--     so re-running is safe on a partially-applied schema.
--   - 043_demo_data.sql is a development seed — NOT sourced here.
--   - For duplicate number prefixes (010/010b, 020/020b, 021/021b, 022/022b):
--     only the authoritative variant listed in MIGRATION_MANIFEST is sourced.
--   - 999_* migrations are utility/seed scripts; sourced last.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Base schema (001–054) ─────────────────────────────────────────────────────
SOURCE sql/001_core_org.sql;
SOURCE sql/002_employees.sql;
SOURCE sql/003_access_control.sql;
SOURCE sql/004_ats.sql;
SOURCE sql/005_attendance_wfm.sql;
SOURCE sql/006_leave.sql;
SOURCE sql/007_payroll.sql;
SOURCE sql/008_integration_hub.sql;
SOURCE sql/009_dialer_ispark.sql;
SOURCE sql/010_kpi.sql;
SOURCE sql/010_kpi_migration.sql;
SOURCE sql/011_exit_management.sql;
SOURCE sql/012_client_portal.sql;
SOURCE sql/012_roster_shift_times.sql;
SOURCE sql/015_platform_foundation.sql;
SOURCE sql/016_employee_lifecycle.sql;
SOURCE sql/017_ats_wfm_completion.sql;
SOURCE sql/018_payroll_exit_completion.sql;
SOURCE sql/019_performance_surfaces.sql;
SOURCE sql/020_lms_integration.sql;
SOURCE sql/020b_roster_governance.sql;
SOURCE sql/021_location_master.sql;
SOURCE sql/021b_attendance_leave_rta.sql;
SOURCE sql/022_benefits_claims.sql;
SOURCE sql/022b_account_control_workforce_mandate.sql;
SOURCE sql/023_career_pip.sql;
SOURCE sql/024_erp.sql;
SOURCE sql/025_goals_skills.sql;
SOURCE sql/026_notifications_transfer.sql;
SOURCE sql/027_jobs_reports.sql;
SOURCE sql/028_statutory_compliance.sql;
SOURCE sql/029_labour_law.sql;
SOURCE sql/030_dpdp_privacy.sql;
SOURCE sql/031_breach_log.sql;
SOURCE sql/032_consent_text_versions.sql;
SOURCE sql/033_kpi_process_config.sql;
SOURCE sql/034_kpi_families.sql;
SOURCE sql/035_portal_published_data.sql;
SOURCE sql/036_erp_billing.sql;
SOURCE sql/037_performance_feedback.sql;
SOURCE sql/037_performance_feedback_fix.sql;
SOURCE sql/038_engagement_gamification.sql;
SOURCE sql/039_engagement_activity_badges.sql;
SOURCE sql/040_communication.sql;
SOURCE sql/041_schema_gap_fill.sql;
SOURCE sql/042_maternity_schema_patch.sql;
-- NOTE: 043_demo_data.sql is a development seed — NOT sourced in production installs.
SOURCE sql/044_attendance_engine.sql;
SOURCE sql/045_role_compat.sql;
SOURCE sql/046_call_centre_code.sql;
SOURCE sql/047_roster_preference.sql;
SOURCE sql/048_offerletter_cc.sql;
SOURCE sql/049_report_master.sql;
SOURCE sql/050_auth_mysql.sql;
SOURCE sql/051_ats_form_config.sql;
SOURCE sql/052_legacy_migration_tables.sql;
SOURCE sql/053_password_reset.sql;
SOURCE sql/054_ats_onboarding_flow.sql;

-- ── Additive migrations (059–102) ─────────────────────────────────────────────
SOURCE sql/060_roster_master.sql;
SOURCE sql/061_roster_capacity.sql;
SOURCE sql/062_ats_candidate_created_by.sql;
SOURCE sql/064_leave_type_updated_at.sql;
SOURCE sql/065_department_description.sql;
SOURCE sql/066_company_events.sql;
SOURCE sql/067_org_settings.sql;
SOURCE sql/068_upload_batch.sql;
SOURCE sql/069_upload_batch_row_unique.sql;
SOURCE sql/070_attendance_clock_columns.sql;
SOURCE sql/071_communication_provider_config.sql;
SOURCE sql/102_biometric_tables.sql;
SOURCE sql/060_legacy_sync_schema.sql;
SOURCE sql/062_employees_legacy_fields.sql;
SOURCE sql/067_employee_task_system.sql;
SOURCE sql/099_ats_candidate_uploads.sql;
SOURCE sql/100_user_page_access.sql;

-- ── Feature migrations (125–237) ──────────────────────────────────────────────
SOURCE sql/125_kpi_process_role_engine.sql;
SOURCE sql/134_external_db_credentials.sql;
SOURCE sql/135_payroll_masters.sql;
SOURCE sql/137_schema_gaps.sql;
SOURCE sql/141_branch_head_approval.sql;
SOURCE sql/142_offer_letter_system.sql;
SOURCE sql/143_report_builder.sql;
SOURCE sql/150_leave_policy_engine.sql;
SOURCE sql/160_kpi_master_config.sql;
SOURCE sql/170_access_improvements.sql;
SOURCE sql/171_attendance_regularization_v2.sql;
SOURCE sql/172_employee_photo.sql;
SOURCE sql/173_employees_ctc_column.sql;
SOURCE sql/174_apr_attendance_rule.sql;
SOURCE sql/176_employee_work_schedule.sql;
SOURCE sql/177_employee_profile_sensitive_details.sql;
SOURCE sql/178_tax_declaration_form12bb.sql;
SOURCE sql/179_super_admin_access.sql;
SOURCE sql/180_ats_registration_onboarding_repair.sql;
SOURCE sql/181_careers_super_admin.sql;
SOURCE sql/181_integration_hub_last_run.sql;
SOURCE sql/182_user_notification_preferences.sql;
SOURCE sql/183_launch_data_repairs.sql;
SOURCE sql/184_master_data_integrity.sql;
SOURCE sql/185_integration_run_integrity.sql;
SOURCE sql/186_runtime_configuration_integrity.sql;
SOURCE sql/187_employee_official_email.sql;
SOURCE sql/188_integration_table_header_mapping.sql;
SOURCE sql/189_integration_call_daily.sql;
SOURCE sql/190_integration_biometric_daily.sql;
SOURCE sql/191_attendance_source_lineage.sql;
SOURCE sql/192_seed_current_leave_balances.sql;
SOURCE sql/193_kpi_live_data_bridge.sql;
SOURCE sql/194_kpi_process_reconciliation.sql;
SOURCE sql/195_reporting_manager_role_alignment.sql;
SOURCE sql/196_seed_call_master_header_mappings.sql;
SOURCE sql/197_salary_increment_governance.sql;
SOURCE sql/198_cosec_punch_evidence.sql;
SOURCE sql/198_it_provisioning.sql;
SOURCE sql/199_employee_directory_indexes.sql;
SOURCE sql/199_process_branch_dept_cleanup.sql;
SOURCE sql/200_employee_directory_process_index.sql;
SOURCE sql/200_onboarding_empcode_bgv_gaps.sql;
SOURCE sql/201_bgv_portal_initiation.sql;
SOURCE sql/202_onboarding_v2_court_check.sql;
SOURCE sql/203_bgv_missing_tables.sql;
SOURCE sql/204_people_experience_command_center.sql;
SOURCE sql/204_leave_type_master_fix.sql;
SOURCE sql/205_leave_policy_config_fix.sql;
SOURCE sql/206_leave_el_accrual_ledger.sql;
SOURCE sql/207_leave_2026_balance_correction.sql;
SOURCE sql/208_leave_2026_ml_el_accrual_seed.sql;
SOURCE sql/209_sync_2026_used_days_from_db_bill.sql;
SOURCE sql/210_fix_el_accrual_ledger_collation.sql;
SOURCE sql/211_employee_personal_contact_fields.sql;
SOURCE sql/212_reporting_manager_bulk_template.sql;
SOURCE sql/213_salary_prep_line_component_columns.sql;
SOURCE sql/214_performance_indexes.sql;
SOURCE sql/217_people_experience_support_hardening.sql;
SOURCE sql/218_deduplicate_badges.sql;
SOURCE sql/218_enterprise_foundation_helpers.sql;
SOURCE sql/219_agent_performance_page_access.sql;
SOURCE sql/219_peopleos_foundation_read_models.sql;
SOURCE sql/220_enterprise_foundation_helpers.sql;
SOURCE sql/221_peopleos_foundation_read_models.sql;
SOURCE sql/222_ensure_bulk_upload_templates.sql;
SOURCE sql/223_wfm_roster_decision_engine.sql;
SOURCE sql/224_wfm_notification_templates.sql;
SOURCE sql/225_employee_shift_rotation_type.sql;
SOURCE sql/226_wfm_bulk_upload_templates.sql;
SOURCE sql/227_week_off_preference_schema_fix.sql;
SOURCE sql/228_wfm_roster_assignment_lifecycle.sql;
SOURCE sql/229_roster_decision_audit_extension.sql;
SOURCE sql/230_attendance_reconciliation_rta_linkage.sql;
SOURCE sql/231_process_master_workload_type.sql;
SOURCE sql/232_wfm_process_planning_rule.sql;
SOURCE sql/233_wfm_slot_requirement.sql;
SOURCE sql/234_process_weekoff_day_rule.sql;
SOURCE sql/235_soft_delete_wfm_planning_tables.sql;
SOURCE sql/236_add_rejected_request_decision_type.sql;
-- DB-003: sensitive_action_log audit columns (old_value_json, new_value_json, actor_role, employee_id, reason)
SOURCE sql/237_attendance_dispute_schema.sql;
SOURCE sql/238_attendance_manual_override.sql;
SOURCE sql/239_conversion_funnel_schema.sql;

-- ── ATS / BGV / LMS / Communication (240–260) ─────────────────────────────────
SOURCE sql/240_bgv_vendor_dispatch.sql;
SOURCE sql/241_ats_bgv_enhanced_tables.sql;
SOURCE sql/242_ats_interview_result_columns.sql;
SOURCE sql/243_lms_integration_hub_config.sql;
SOURCE sql/245_leave_credit_redesign.sql;
SOURCE sql/246_nominee_gratuity_distribution.sql;
SOURCE sql/250_lms_integration_schema.sql;
SOURCE sql/251_lms_employee_mapping.sql;
SOURCE sql/252_lms_sync_audit_table.sql;
SOURCE sql/260_communication_preferences.sql;
SOURCE sql/261_profile_update_approval.sql;
SOURCE sql/262_reporting_manager_change_request.sql;
SOURCE sql/263_superadmin_mas47814.sql;
SOURCE sql/264_business_action_queue.sql;
SOURCE sql/265_ats_lifecycle_alignment.sql;
SOURCE sql/266_hrms2_security_lifecycle_stabilization.sql;
SOURCE sql/267_lifecycle_completion_surfaces.sql;
SOURCE sql/268_production_hardening_appointment_provisioning.sql;
SOURCE sql/269_fix_lifecycle_route_schema_access.sql;
SOURCE sql/270_fix_shivam_page_access_and_schema_mismatch.sql;
SOURCE sql/271_performance_indexes.sql;

-- ── Candidate onboarding / payroll (289–320) ──────────────────────────────────
SOURCE sql/289_candidate_onboarding_full_field_parity.sql;
SOURCE sql/289_candidate_onboarding_full_field_parity_mysql8.sql;
SOURCE sql/290_dashboard_analytics_engine.sql;
SOURCE sql/291_incentive_approval_workflow.sql;
SOURCE sql/292_appointment_letter_esign.sql;
SOURCE sql/293_dpdp_withdrawal_workflow.sql;
SOURCE sql/294_tat_escalation_matrix.sql;
SOURCE sql/295_candidate_name_consistency_matrix.sql;
SOURCE sql/296_resignation_discussion_flow.sql;
SOURCE sql/297_remaining_workflow_page_access.sql;
SOURCE sql/298_candidate_onboarding_full_final_fix.sql;
SOURCE sql/299_appointment_letter_esign_final.sql;
SOURCE sql/290_pf_esic_optout.sql;
SOURCE sql/291_tds_manual_mode.sql;
SOURCE sql/292_cheque_name_validation.sql;
SOURCE sql/293_bank_change_pennyDrop.sql;
SOURCE sql/294_payroll_window_closure.sql;
SOURCE sql/300_dpdp_withdrawal_final.sql;
SOURCE sql/301_final_page_access_routing_fix.sql;
SOURCE sql/302_schema_mapping_stabilization.sql;
SOURCE sql/303_auth_password_reset_otp.sql;
SOURCE sql/304_missing_columns_fix.sql;
SOURCE sql/305_runtime_blockers_fix.sql;
SOURCE sql/306_salary_bypass_control.sql;
SOURCE sql/307_fix_blocked_migrations.sql;
SOURCE sql/308_email_templates_bulk_import.sql;
SOURCE sql/309_super_admin_full_page_access.sql;
SOURCE sql/310_vendor_payment_tracking.sql;
SOURCE sql/320_bgv_missing_tables.sql;

-- ── Recent feature additions (321–374) ────────────────────────────────────────
SOURCE sql/321_leave_request_geo.sql;
SOURCE sql/322_regularization_geo.sql;
SOURCE sql/323_onboarding_submit_geo.sql;
SOURCE sql/324_login_geo.sql;
SOURCE sql/325_fix_attendance_utc_to_ist.sql;
SOURCE sql/326_salary_package_master_sync.sql;
SOURCE sql/327_aadhaar_esign_appointment_letter.sql;
SOURCE sql/328_holiday_cost_centre_mapping.sql;
SOURCE sql/329_holiday_work_request.sql;
SOURCE sql/330_payroll_recalc_queue_and_config.sql;
SOURCE sql/331_salary_prep_line_extended_columns.sql;
SOURCE sql/332_weekoff_fairness_score.sql;
SOURCE sql/333_cost_centre_master_ensure.sql;
SOURCE sql/334_process_master_branch_mapping.sql;
SOURCE sql/335_offer_pf_esi_flags.sql;
SOURCE sql/336_dpdp_compliance_gaps.sql;
SOURCE sql/336_leave_weekoff_reconciliation.sql;
SOURCE sql/337_employee_deduction_entries.sql;
SOURCE sql/337_noc_workflow.sql;
SOURCE sql/338_leave_reversal_log.sql;
SOURCE sql/338_tax_declaration_page_access.sql;
SOURCE sql/339_payroll_validation_status.sql;
SOURCE sql/339_statutory_config_audit_log.sql;
SOURCE sql/340_branch_alias_noida_okaya.sql;
SOURCE sql/340_tds_budget2025_slabs.sql;
SOURCE sql/341_dashboard_targets.sql;
SOURCE sql/341_onboarding_profile_missing_columns.sql;
SOURCE sql/342_bgv_provider_config_labels.sql;
SOURCE sql/342_masmis_upload_tables.sql;
SOURCE sql/343_global_page_availability.sql;
SOURCE sql/344_ats_recruiter_hiring_tracker.sql;
SOURCE sql/345_ats_walkin_recruiter_calling_security.sql;
SOURCE sql/345_onboarding_status_pipeline_extended.sql;
SOURCE sql/346_employee_joining_document_pack.sql;
SOURCE sql/346_luckpay_provider_transaction_log.sql;
SOURCE sql/347_epf_digital_compliance_pack.sql;
SOURCE sql/348_universal_digital_form_fill_engine.sql;
SOURCE sql/349_joining_document_actor_alignment.sql;
SOURCE sql/350_joining_document_public_token_hash_only.sql;
SOURCE sql/351_sanitize_internal_sign_links.sql;
SOURCE sql/352_ats_email_log_extended_types.sql;
SOURCE sql/353_luckpay_production_provider_config.sql;
SOURCE sql/354_two_level_wfm_approvals.sql;
SOURCE sql/355_epf_acroform_phase1.sql;
SOURCE sql/356_joining_document_status_safety_columns.sql;
SOURCE sql/357_ats_candidate_followup_columns.sql;
SOURCE sql/358_payroll_hr_validation_service_columns.sql;
SOURCE sql/359_rm_change_requests_table.sql;
SOURCE sql/360_salary_increment_governance_routes.sql;
SOURCE sql/361_widen_working_experience_column.sql;
SOURCE sql/362_provisioning_task_fields.sql;
SOURCE sql/363_joining_document_assigned_hr.sql;
SOURCE sql/364_incentive_bulk_upload_schema.sql;
SOURCE sql/365_payroll_deduction_type.sql;
SOURCE sql/366_page_codes_incentive_deduction.sql;
SOURCE sql/367_dpdp_compliance_role_access.sql;
SOURCE sql/368_core_master_upload_templates.sql;
SOURCE sql/369_fix_core_master_upload_templates.sql;
SOURCE sql/370_pf_creation_automation.sql;
SOURCE sql/371_user_device_sessions.sql;
SOURCE sql/372_add_name_on_cheque.sql;
-- DB-001: candidate_onboarding_profile CREATE TABLE (was missing from all migrations)
SOURCE sql/373_create_candidate_onboarding_profile.sql;
-- DB-004: employees table missing indexes
SOURCE sql/374_employees_missing_indexes.sql;
-- PAY-005: attendance source column for validation UI fallback warning
SOURCE sql/375_salary_prep_line_attendance_source.sql;
SOURCE sql/376_break_management_module.sql;
SOURCE sql/393_break_kiosk_allowed_processes.sql;
SOURCE sql/394_auto_roster_synced_tables.sql;

-- ── Payroll readiness / calendar (400–401) ────────────────────────────────────
SOURCE sql/400_payroll_branch_readiness.sql;
SOURCE sql/401_payroll_calendar.sql;

-- ── Phase 3 compliance / reporting (402) ─────────────────────────────────────
SOURCE sql/402_salary_prep_line_bulk_outputs.sql;

-- ── Phase 4 sign-off / loans (403) ────────────────────────────────────────────
SOURCE sql/403_payroll_run_signoff.sql;

-- ── Bug fixes: B6 incentive tracking (404) ───────────────────────────────────
SOURCE sql/404_payroll_incentive_tracking.sql;

-- ── Finance attribution, P&L controls and budget-linked GRN (405–411) ────────
SOURCE sql/405_finance_grn_vendor_cost_attribution.sql;
SOURCE sql/406_process_pnl_financial_controls.sql;
SOURCE sql/408_ats_candidate_assessment_engine.sql;
SOURCE sql/409_visitor_management_foundation.sql;
SOURCE sql/410_visitor_configuration_branch_fk.sql;
SOURCE sql/411_branch_budget_grn_approval_flow.sql;
SOURCE sql/451_company_feed_foundation.sql;
SOURCE sql/460_ats_performance_indexes.sql;
SOURCE sql/508_ats_onboarding_bridge_code_columns.sql;
SOURCE sql/509_portal_client_master_fixes.sql;
SOURCE sql/510_portal_superadmin_user.sql;

-- ── Utility / engagement fixes (999, 1000) ────────────────────────────────────
SOURCE sql/1000_fix_engagement_schema_columns.sql;
SOURCE sql/999_create_missing_engagement_tables.sql;
SOURCE sql/999_fix_missing_ceo_metrics_tables.sql;
SOURCE sql/999_password_expiry_policy.sql;

SELECT CONCAT('mas_hrms schema bootstrap complete — ', NOW()) AS status;
SHOW TABLES;
