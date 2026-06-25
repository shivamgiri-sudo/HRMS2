-- 000_run_all.sql
-- Run this to execute all schema files in order.
-- Usage: mysql -u root -p < sql/000_run_all.sql
--
-- NOTE: 043_demo_data.sql is a development/demo seed — do NOT include in production runs.
-- NOTE: For duplicate variants (020/020b, 021/021b, 022/022b), only the 'b' variants
--       are sourced here as they contain the governance/extended schemas.

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
SOURCE sql/044_attendance_engine.sql;
SOURCE sql/045_role_compat.sql;
SOURCE sql/046_call_centre_code.sql;
SOURCE sql/047_roster_preference.sql;
SOURCE sql/048_offerletter_cc.sql;
SOURCE sql/049_report_master.sql;
SOURCE sql/050_auth_mysql.sql;
SOURCE sql/051_ats_form_config.sql;
-- NOTE: SOURCE sql/043_demo_data.sql; -- development seed only, do not run in production
-- Additive migrations (applied automatically by runPendingMigrations on startup)
SOURCE sql/052_legacy_migration_tables.sql;
SOURCE sql/053_password_reset.sql;
SOURCE sql/054_ats_onboarding_flow.sql;
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
SOURCE sql/183_launch_data_repairs.sql;
SOURCE sql/211_employee_personal_contact_fields.sql;
SOURCE sql/240_bgv_vendor_dispatch.sql;
SOURCE sql/241_ats_bgv_enhanced_tables.sql;
SOURCE sql/242_ats_interview_result_columns.sql;
SOURCE sql/243_lms_integration_hub_config.sql;
SOURCE sql/245_leave_credit_redesign.sql;
SOURCE sql/246_nominee_gratuity_distribution.sql;
SOURCE sql/250_lms_integration_schema.sql;

SOURCE sql/251_lms_employee_mapping.sql;
SOURCE sql/260_communication_preferences.sql;
SOURCE sql/261_profile_update_approval.sql;
SOURCE sql/290_pf_esic_optout.sql;
SOURCE sql/291_tds_manual_mode.sql;
SOURCE sql/292_cheque_name_validation.sql;
SOURCE sql/293_bank_change_pennyDrop.sql;
SOURCE sql/294_payroll_window_closure.sql;

SELECT 'mas_hrms schema complete' AS status;
SHOW TABLES;
