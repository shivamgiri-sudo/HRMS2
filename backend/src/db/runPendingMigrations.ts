import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";

// Migration governance configuration
const MIGRATION_LOCK_TIMEOUT_SECONDS = 60;
const MIGRATION_STRICT_MODE = process.env.MIGRATION_STRICT_MODE === "true";
const STOP_ON_FIRST_FAILURE = process.env.MIGRATION_STOP_ON_FAILURE !== "false"; // default true
// Bounds verifySchemaVersion()'s whole operation (connect + every query) — see the call
// site for why this exists. Matches the app's shared pool's own connectTimeout (db/mysql.ts).
const VERIFY_SCHEMA_TIMEOUT_MS = 10000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveSqlDir(): string {
  const candidates = [
    path.resolve(__dirname, "../../sql"),
    path.resolve(__dirname, "../../../sql"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

const SQL_DIR = resolveSqlDir();

// Canonical migration order, derived from 000_run_all.sql.
// 043_demo_data.sql is excluded unless SEED_DEMO_DATA=true.
// Non-b duplicates (020, 021, 022) are excluded — only b-variants are sourced.
// Duplicate numeric prefixes (010/010, 012/012, 198/198, 204/204, 271/271, 504/504) are intentional —
// tracking is by full filename in schema_migrations, so each file runs independently.
const MIGRATION_MANIFEST: string[] = [
  "001_core_org.sql",
  "002_employees.sql",
  "003_access_control.sql",
  "004_ats.sql",
  "005_attendance_wfm.sql",
  "006_leave.sql",
  "007_payroll.sql",
  "008_integration_hub.sql",
  "009_dialer_ispark.sql",
  "010_kpi.sql",
  "010_kpi_migration.sql",
  "011_exit_management.sql",
  "012_client_portal.sql",
  "012_roster_shift_times.sql",
  "015_platform_foundation.sql",
  "016_employee_lifecycle.sql",
  "017_ats_wfm_completion.sql",
  "018_payroll_exit_completion.sql",
  "019_performance_surfaces.sql",
  "020_lms_integration.sql",
  "020b_roster_governance.sql",
  "021_location_master.sql",
  "021b_attendance_leave_rta.sql",
  "022_benefits_claims.sql",
  "022b_account_control_workforce_mandate.sql",
  "023_career_pip.sql",
  "024_erp.sql",
  "025_goals_skills.sql",
  "026_notifications_transfer.sql",
  "027_jobs_reports.sql",
  "028_statutory_compliance.sql",
  "029_labour_law.sql",
  "030_dpdp_privacy.sql",
  "031_breach_log.sql",
  "032_consent_text_versions.sql",
  "033_kpi_process_config.sql",
  "034_kpi_families.sql",
  "035_portal_published_data.sql",
  "036_erp_billing.sql",
  "037_performance_feedback.sql",
  "037_performance_feedback_fix.sql",
  "038_engagement_gamification.sql",
  "039_engagement_activity_badges.sql",
  "040_communication.sql",
  "041_schema_gap_fill.sql",
  "042_maternity_schema_patch.sql",
  "044_attendance_engine.sql",
  "045_role_compat.sql",
  "046_call_centre_code.sql",
  "047_roster_preference.sql",
  "048_offerletter_cc.sql",
  "049_report_master.sql",
  "050_auth_mysql.sql",
  "051_ats_form_config.sql",
  "052_legacy_migration_tables.sql",
  "053_password_reset.sql",
  "054_ats_onboarding_flow.sql",
  "060_roster_master.sql",
  "061_roster_capacity.sql",
  "062_ats_candidate_created_by.sql",
  "064_leave_type_updated_at.sql",
  "065_department_description.sql",
  "066_company_events.sql",
  "067_org_settings.sql",
  "068_upload_batch.sql",
  "069_upload_batch_row_unique.sql",
  "070_attendance_clock_columns.sql",
  "071_communication_provider_config.sql",
  "102_biometric_tables.sql",
  // Additive migrations not in 000_run_all but with active backend dependencies
  "060_legacy_sync_schema.sql",
  "062_employees_legacy_fields.sql",
  "067_employee_task_system.sql",
  "099_ats_candidate_uploads.sql",
  "100_user_page_access.sql",
  "125_kpi_process_role_engine.sql",
  "128_ats_queue_token.sql",
  "129_ats_recruiter_roster.sql",
  "130_ats_interview_submission.sql",
  "131_ats_command_audit_log.sql",
  "132_email_sms_notification_system.sql",
  "134_external_db_credentials.sql",
  "135_payroll_masters.sql",
  "137_schema_gaps.sql",
  "373_create_candidate_onboarding_profile.sql",
  "138_ats_complete_journey.sql",
  "139_ats_enhanced_journey_safe.sql",
  "140_candidate_portal_tables.sql",
  "141_branch_head_approval.sql",
  "142_offer_letter_system.sql",
  "143_report_builder.sql",
  "150_leave_policy_engine.sql",
  "160_kpi_master_config.sql",
  "170_access_improvements.sql",
  "171_attendance_regularization_v2.sql",
  "172_employee_photo.sql",
  "173_employees_ctc_column.sql",
  "174_apr_attendance_rule.sql",
  "176_employee_work_schedule.sql",
  "177_employee_profile_sensitive_details.sql",
  "178_tax_declaration_form12bb.sql",
  "179_super_admin_access.sql",
  "180_ats_registration_onboarding_repair.sql",
  "181_careers_super_admin.sql",
  "181_integration_hub_last_run.sql",
  "182_user_notification_preferences.sql",
  "183_launch_data_repairs.sql",
  "184_master_data_integrity.sql",
  "185_integration_run_integrity.sql",
  "186_runtime_configuration_integrity.sql",
  "187_employee_official_email.sql",
  "188_integration_table_header_mapping.sql",
  "189_integration_call_daily.sql",
  "190_integration_biometric_daily.sql",
  "191_attendance_source_lineage.sql",
  "192_seed_current_leave_balances.sql",
  "193_kpi_live_data_bridge.sql",
  "194_kpi_process_reconciliation.sql",
  "195_reporting_manager_role_alignment.sql",
  "196_seed_call_master_header_mappings.sql",
  "197_salary_increment_governance.sql",
  "198_cosec_punch_evidence.sql",
  "198_it_provisioning.sql",
  "199_employee_directory_indexes.sql",
  "199_process_branch_dept_cleanup.sql",
  "200_employee_directory_process_index.sql",
  "200_onboarding_empcode_bgv_gaps.sql",
  "201_bgv_portal_initiation.sql",
  "202_onboarding_v2_court_check.sql",
  "203_bgv_missing_tables.sql",
  "204_people_experience_command_center.sql",
  "204_leave_type_master_fix.sql",
  "205_leave_policy_config_fix.sql",
  "206_leave_el_accrual_ledger.sql",
  "207_leave_2026_balance_correction.sql",
  "208_leave_2026_ml_el_accrual_seed.sql",
  "209_sync_2026_used_days_from_db_bill.sql",
  "210_fix_el_accrual_ledger_collation.sql",
  "211_employee_personal_contact_fields.sql",
  "212_reporting_manager_bulk_template.sql",
  "213_salary_prep_line_component_columns.sql",
  "214_performance_indexes.sql",
  "217_people_experience_support_hardening.sql",
  "218_deduplicate_badges.sql",
  "218_enterprise_foundation_helpers.sql",
  "219_agent_performance_page_access.sql",
  "219_peopleos_foundation_read_models.sql",
  "220_enterprise_foundation_helpers.sql",
  "221_peopleos_foundation_read_models.sql",
  "222_ensure_bulk_upload_templates.sql",
  "223_wfm_roster_decision_engine.sql",
  "224_wfm_notification_templates.sql",
  "225_employee_shift_rotation_type.sql",
  "226_wfm_bulk_upload_templates.sql",
  "227_week_off_preference_schema_fix.sql",
  "228_wfm_roster_assignment_lifecycle.sql",
  "229_roster_decision_audit_extension.sql",
  "230_attendance_reconciliation_rta_linkage.sql",
  "231_process_master_workload_type.sql",
  "232_wfm_process_planning_rule.sql",
  "233_wfm_slot_requirement.sql",
  "234_process_weekoff_day_rule.sql",
  "235_soft_delete_wfm_planning_tables.sql",
  "236_add_rejected_request_decision_type.sql",
  "237_attendance_dispute_schema.sql",
  "238_attendance_manual_override.sql",
  "239_conversion_funnel_schema.sql",
  "240_bgv_vendor_dispatch.sql",
  "241_ats_bgv_enhanced_tables.sql",
  "242_ats_interview_result_columns.sql",
  "243_lms_integration_hub_config.sql",
  "245_leave_credit_redesign.sql",
  "246_nominee_gratuity_distribution.sql",
  "250_lms_integration_schema.sql",
  "251_lms_employee_mapping.sql",
  "252_lms_sync_audit_table.sql",
  "260_communication_preferences.sql",
  "261_profile_update_approval.sql",
  "262_reporting_manager_change_request.sql",
  "263_superadmin_mas47814.sql",
  "264_business_action_queue.sql",
  "265_ats_lifecycle_alignment.sql",
  "266_hrms2_security_lifecycle_stabilization.sql",
  "267_lifecycle_completion_surfaces.sql",
  "268_production_hardening_appointment_provisioning.sql",
  "269_fix_lifecycle_route_schema_access.sql",
  "270_fix_shivam_page_access_and_schema_mismatch.sql",
  "271_candidate_onboarding_otp_dpdp_engine.sql",
  "271_performance_indexes.sql",
  "272_hrms2_joining_control_room_document_viewer.sql",
  "273_ats_candidate_missing_columns.sql",
  "274_attendance_gaps.sql",
  "277_letter_templates_mas.sql",
  "289_candidate_onboarding_full_field_parity.sql",
  "289_candidate_onboarding_full_field_parity_mysql8.sql",
  "290_dashboard_analytics_engine.sql",
  "291_incentive_approval_workflow.sql",
  "292_appointment_letter_esign.sql",
  "293_dpdp_withdrawal_workflow.sql",
  "294_tat_escalation_matrix.sql",
  "295_candidate_name_consistency_matrix.sql",
  "296_resignation_discussion_flow.sql",
  "297_remaining_workflow_page_access.sql",
  "298_candidate_onboarding_full_final_fix.sql",
  "299_appointment_letter_esign_final.sql",
  "300_dpdp_withdrawal_final.sql",
  "301_final_page_access_routing_fix.sql",
  "302_schema_mapping_stabilization.sql",
  "303_auth_password_reset_otp.sql",
  "304_missing_columns_fix.sql",
  "305_runtime_blockers_fix.sql",
  "306_salary_bypass_control.sql",
  "307_fix_blocked_migrations.sql",
  "308_email_templates_bulk_import.sql",
  "309_super_admin_full_page_access.sql",
  "310_vendor_payment_tracking.sql",
  "342_bgv_provider_config_labels.sql",
  "600_cost_centre_extended_schema.sql", // the entire cost-centre maker-checker column set that cost-centre-management.service.ts reads and writes - status, submitted_by/at, l1_approved_by/at, l2_approved_by/at, rejection_reason, revision_no, plus 30 operational and billing columns - added through 42 guarded CALL add_column_if_not_exists(...) invocations. It has never been in the manifest, so the runner has never executed it; production has all six key columns only because it was applied out of band, which is why the draft -> pending_l1 -> pending_l2 -> approved workflow works there and would not exist at all on a rebuilt database. Idempotent by construction: every column add is guarded on information_schema, the two CREATE TABLE statements are IF NOT EXISTS, and the only DROPs are of its own add_column_if_not_exists helper, which it defines at the top and removes at the bottom so it cannot leak into a later migration. Verified against production: all six maker-checker columns already present, so applying this is a no-op there. Parsed with the runner's own splitSql in newly-scheduled-migrations.test.ts, because a stored procedure body is exactly what a naive semicolon splitter mangles
  "1000_fix_engagement_schema_columns.sql",
  "343_global_page_availability.sql",
  "344_ats_recruiter_hiring_tracker.sql",
  "345_ats_walkin_recruiter_calling_security.sql",
  "345_onboarding_status_pipeline_extended.sql",
  "346_employee_joining_document_pack.sql",
  "346_luckpay_provider_transaction_log.sql",
  "347_epf_digital_compliance_pack.sql",
  "348_universal_digital_form_fill_engine.sql",
  "349_joining_document_actor_alignment.sql",
  "350_joining_document_public_token_hash_only.sql",
  "351_sanitize_internal_sign_links.sql",
  "352_ats_email_log_extended_types.sql",
  "353_luckpay_production_provider_config.sql",
  "354_two_level_wfm_approvals.sql",
  "355_epf_acroform_phase1.sql",
  "356_joining_document_status_safety_columns.sql",
  "357_ats_candidate_followup_columns.sql",
  "358_payroll_hr_validation_service_columns.sql",
  "359_rm_change_requests_table.sql",
  "360_salary_increment_governance_routes.sql",
  "361_widen_working_experience_column.sql",
  "362_provisioning_task_fields.sql",
  "363_joining_document_assigned_hr.sql",
  "364_incentive_bulk_upload_schema.sql",
  "365_payroll_deduction_type.sql",
  "366_page_codes_incentive_deduction.sql",
  "367_dpdp_compliance_role_access.sql",
  "368_core_master_upload_templates.sql",
  "369_fix_core_master_upload_templates.sql",
  "370_pf_creation_automation.sql",
  "371_user_device_sessions.sql",
  "372_add_name_on_cheque.sql",
  "374_employees_missing_indexes.sql",
  "375_salary_prep_line_attendance_source.sql",
  "376_break_management_module.sql",
  "377_process_pnl_governance.sql",
  "391_payroll_validation_freeze_columns.sql",
  "393_break_kiosk_allowed_processes.sql",
  "394_auto_roster_synced_tables.sql",
  "405_finance_grn_vendor_cost_attribution.sql",
  "406_process_pnl_financial_controls.sql",
  "407_shift_roster_bulk_upload_template.sql",
  "408_ats_candidate_assessment_engine.sql",
  "409_visitor_management_foundation.sql",
  "410_visitor_configuration_branch_fk.sql",
  "411_branch_budget_grn_approval_flow.sql",
  "450_policy_engine_config.sql",
  "451_company_feed_foundation.sql",
  "460_ats_performance_indexes.sql",
  "461_ops_manager_ats_queue_access.sql",
  "504_performance_intelligence_foundation.sql",
  "505_performance_source_connector_keys.sql",
  "506_sales_performance_metric_foundation.sql",
  "507_identity_source_snapshot.sql",
  "509_portal_client_master_fixes.sql",
  "510_portal_superadmin_user.sql",
  "580_performance_ingestion_platform.sql",
  "581_performance_multi_source_lineage.sql",
  "582_performance_governance_audit.sql",
  // ── Additional migrations not yet in manifest ──────────────────────────────
  "330_payroll_recalc_queue_and_config.sql",
  "331_salary_prep_line_extended_columns.sql",
  "332_weekoff_fairness_score.sql",
  "333_cost_centre_master_ensure.sql",
  "334_process_master_branch_mapping.sql",
  "335_holiday_work_auto_log.sql",
  "335_offer_pf_esi_flags.sql",
  "336_dpdp_compliance_gaps.sql",
  "336_leave_weekoff_reconciliation.sql",
  "337_employee_deduction_entries.sql",
  "337_noc_workflow.sql",
  "338_leave_reversal_log.sql",
  "338_tax_declaration_page_access.sql",
  "339_payroll_validation_status.sql",
  "339_statutory_config_audit_log.sql",
  "340_branch_alias_noida_okaya.sql",
  "340_tds_budget2025_slabs.sql",
  "341_dashboard_targets.sql",
  "341_onboarding_profile_missing_columns.sql",
  "342_masmis_upload_tables.sql",
  "351_page_catalog_route_repairs.sql",
  "360_schema_json_seeding.sql",
  "364_ats_substitute_interviewer.sql",
  "367_ats_hiring_activity_followup.sql",
  "368_ats_hiring_walkin_date.sql",
  "376_profile_page_catalog.sql",
  "377_ats_hiring_followup_attempt.sql",
  "380_salary_disbursal_and_branch_address.sql",
  "392_branch_hr_contact.sql",
  "395_overtime_process_config.sql",
  "396_overtime_rounding_config.sql",
  "396_statutory_config_history.sql",
  "397_salary_prep_line_loan_emi.sql",
  "398_run_incentive_tracking.sql",
  "399_statutory_config_defaults.sql",
  "400_payroll_branch_readiness.sql",
  "401_payroll_calendar.sql",
  "402_salary_prep_line_bulk_outputs.sql",
  "403_payroll_run_signoff.sql",
  "404_payroll_incentive_tracking.sql",
  "408_leave_lapse_on_payroll_close.sql",
  "410_pt_slab_gujarat_and_branch_state_normalization.sql",
  "411_correct_historical_pt_for_no_pt_states.sql",
  "412_finance_expense_head_master.sql",
  "412_payroll_tax_engine_tables.sql",
  "413_salary_prep_run_tds_mode.sql",
  "413_vendor_payment_transaction_ledger.sql",
  "414_finance_grn_sequence.sql",
  "415_bpo_pnl_revenue_cost_model.sql",
  "416_smart_grn_allocation_document_intelligence.sql",
  "417_budget_subhead_coverage_control.sql",
  "418_grn_allocation_pnl_attribution.sql",
  "419_grn_validation_override_control.sql",
  "420_grn_validation_schema_hardening.sql",
  "421_process_lob_pnl_foundation.sql",
  "422_vendor_payment_lob_bridge.sql",
  "423_cost_centre_lob_compatibility.sql",
  "424_employee_reimbursement_claim.sql",
  "425_branch_budget_cost_centre_allocation.sql",
  "425_mira_openrouter_company_knowledge.sql",
  "migrations/426_employee_geofence_alerts.sql",
  "426_pnl_component_master.sql",
  "426_mira_audit_resilience.sql",
  "427_finance_meter_subsystem.sql",
  "428_finance_cost_centre_mapping_history.sql",
  "429_finance_saved_views.sql",
  "430_finance_grade_headcount_driver.sql",
  "431_branch_master_seq_fix.sql",
  "432_master_close_date.sql",
  "433_budget_line_corrections.sql",
  "434_meter_sharing_and_cc_drivers.sql",
  "435_pnl_components_real_shape.sql",
  // 436 is deliberately NOT listed. It failed on a missing rule_name, and the runner had already
  // written its filename into schema_migrations, so every retry hits a duplicate primary key and
  // STOP_ON_FIRST_FAILURE then blocks every migration after it. The file is kept for history and
  // superseded by 438, which carries the corrected statement.
  "437_pnl_wfm_follows_process_mapping.sql",
  "438_pnl_people_classification_seed_v2.sql",
  "439_pnl_running_salary_snapshot.sql",
  "435_bgv_check_type_name_match.sql",
  "500_ai_provider_foundation.sql",
  "501_lifecycle_consolidation_phase1.sql",
  "502_designation_bgv_requirements.sql",
  "503_pt_slab_dedup.sql",
  "504_auth_account_lockout.sql",
  "508_ats_onboarding_bridge_code_columns.sql",
  // ── DPDP Privacy Hardening migrations (feature/dpdp-privacy-hardening) ──────
  "126_ats_candidate_pii_hash_columns.sql",     // PII hash columns on ats_candidate (was missing from manifest)
  "999_grant_employee_resignation_dpdp.sql",    // Employee role page access to DPDP_WITHDRAWAL (was missing)
  "511_wfm_session_call_id.sql",
  "512_quality_dashboard_page_access.sql",
  "513_dpdp_withdrawal_consolidation.sql",      // Canonical withdrawal fields, task table, evidence table
  "514_privacy_data_inventory.sql",             // Privacy data asset/purpose/field-policy/system registry
  "515_employee_pii_encryption_columns.sql",    // Additive encrypted PAN/Aadhaar columns on employees
  "516_privacy_retention_worker_tables.sql",    // Retention run/candidate/approval/certificate tables
  "518_dpdp_feature_flags.sql",                 // DPDP feature flag config keys (all default OFF/dry-run)
  "519_ats_performance_indexes.sql",            // ATS command center covering indexes
  "520_missing_page_codes_seed.sql",            // Missing page codes seed
  "521_security_audit_event_table.sql",         // Security audit event table
  "522_dpdp_withdrawal_admin_rerun.sql",        // DPDP withdrawal admin rerun
  "523_job_requisition.sql",                    // Job requisition master + candidate linking tables
  "524_job_requisition_batch_link.sql",         // Planned batch columns on job_requisition
  "528_job_requisition_handover.sql",           // Handover workflow columns on job_requisition
  "530_auth_session_security_hardening.sql",    // Pre-auth challenge table, token family columns, auth invitation
  "531_document_vault_security_hardening.sql",  // Document vault security hardening
  "532_migration_governance_hardening.sql",     // Migration governance hardening
  "533_worker_distributed_safety.sql",          // Worker distributed safety
  "535_attendance_reconciliation_issue.sql",    // NCOSEC-to-payroll attendance reconciliation issue ledger
  "536_attendance_reconciliation_apr_issue_types.sql", // APR payroll attendance reconciliation issue types
  "537_payroll_attendance_conflict_review.sql", // Payroll attendance control tower review ledger
  "538_route_page_access_backfill.sql",         // Backfill route-mapped page codes and grants
  "542_attendance_reconciliation_source_conflict_issue_type.sql", // Reconciliation issue type for dialler rows without source evidence
  "543_cosec_exclusion_and_inactive_issue_type.sql", // Ignore intentional COSEC identities and separate inactive punch activity
  // 1006/1007 existed on disk but were never registered here — confirmed live (2026-08-13)
  // that payroll_branch_readiness already HAS process_id/process_manager_signoff/etc. (1006's
  // columns), so it ran through some other path while the manifest didn't know it happened.
  // Both are safe to register now regardless: 1006 uses ADD COLUMN/INDEX IF NOT EXISTS and a
  // guarded unique-key swap, 1007 uses INSERT IGNORE — re-running either against a DB that
  // already has them is a verified no-op, not a duplicate-column error.
  "1006_payroll_process_readiness_extend.sql",  // Extend payroll_branch_readiness: process_id, attendance_data_ready, process_manager_signoff
  "1007_payroll_process_readiness_page.sql",    // Register PAYROLL_PROCESS_READINESS page catalog entry + role grants
  "1008_migrate_photo_urls_to_api.sql",         // Migrate employee photo URLs from /uploads/ to /api/files/
  "1009_ats_hiring_followup_call_feedback.sql", // ATS hiring: follow-up call outcome, date, notes, reschedule columns
  "1021_payroll_signoff_columns_and_ceo_sod.sql", // salary_prep_run sign-off columns (route 500'd without them) + narrow ceo create/delete grants
  "1022_notification_event_registry.sql",          // notification_event_config is required at startup and by notificationGateway.notify()
  "1022_page_catalog_path_reconciliation.sql",    // WORKFORCE_COMMAND_CENTER path regression (404 for 8 roles) + retire ADVANCED_REPORTS stub
  "1023_notification_dispatch_claim.sql",          // notification_dispatch_claim is required by the dispatch worker claim path
  "1023_discard_approved_records.sql",            // Discard approved leave/regularization/dispute: pre-approval snapshots + discard audit log
  "1024_candidate_onboarding_document_rejected_status.sql", // document_status lacked 'rejected'; every secure-viewer reject hit ERROR 1265
  "1028_salary_certificate_request_collation.sql", // utf8mb4_0900_ai_ci vs employees' utf8mb4_unicode_ci — the join 500'd with ERROR 1267
  "1027_ceo_my_kpi_revoke.sql",                   // CEO is not measured on operational KPIs — remove the hollow /my-kpi page from that role only
  "1029_ungated_routes_page_catalog.sql", // the ONLY definition anywhere of the page_catalog rows and role_page_access grants for FINANCE_GRN, FINANCE_BRANCH_BUDGET, FINANCE_BUDGET_CONSOLIDATION, FINANCE_PROCESS_PNL, FINANCE_PNL_CONFIG, FINANCE_PNL_LOBS, FINANCE_PNL_PERIOD_CLOSE and FINANCE_VENDOR_PAYMENTS. Never in the manifest, so never run by the runner; production holds 8 catalog rows and 23 grants purely because it was applied out of band. On a rebuilt database every Finance page would render its Gate denial for every role except super_admin - the same failure FINANCE_COST_CENTRES shipped with, which two migrations cited as a cautionary example and 1129 finally fixed. Purely additive: INSERT ... ON DUPLICATE KEY UPDATE only, no ALTER, no DROP, no DELETE, so a replay against production rewrites the same rows with the same values and changes nothing
  "1030_statutory_config_versioning.sql",
  "1031_statutory_filing_act_2025_forms.sql",   // Income-tax Act 2025 renumbered the quarterly salary TDS statement from Form 24Q to Form 138; the ENUM is widened, never narrowed, so filed rows keep meaning what they meant         // statutory_config keys are UNIQUE, so a Finance Act change overwrote the old rates and a prior month could no longer be recomputed at the rates it was actually deducted under
  "1032_tds_certificate_part_a.sql",           // Part A of the salary TDS certificate is issued by TRACES and cannot be generated here; this records which document belongs to which employee and year
  "1033_sensitive_action_log_entity_id_width.sql", // entity_id was CHAR(36), so every composite key (employee:date, employee:FY, designation::role) overflowed and the audit row was silently dropped — 26 approved regularizations left no ATTENDANCE_RECORD_CORRECTED trail at all
  "1035_kpi_master_config_designation.sql",     // A process target overrode a designation target instead of combining, so "EXECUTIVE on Onfido" could not be targeted separately; adds designation_id as an optional second dimension
  "1036_kpi_metric_scoring_type.sql",           // min_threshold was stored on all 291 config rows and never scored; adds an opt-in scoring_type so a floor/ceiling can gate, without moving any existing score
  "1039_salary_prep_run_kind.sql",               // salary_prep_run could not say what a run *is*, so a legacy import and the operational payroll for 2026-03 looked like duplicates of each other
  "1042_esign_transaction_poll_state.sql",       // Luckpay's completion callback is unreliable, so eSign completion has to be pulled on a backoff rather than waited for
  "1046_salary_assignment_package_link.sql",     // nothing recorded WHICH approved package an employee was hired on, so appointment letters printed Bonus 0.00 for packages that grant one
  "1047_company_signing_certificate.sql",       // the previous "company sign" step was a database flag with no signature at all; this holds the real credential
  "1048_appointment_letter_issue.sql",          // new table rather than appointment_letter_request, which carries two competing schemas from migrations 267 and 299
  "1049_joining_document_esign_kit.sql",        // one signing session for all joining documents; the provider takes one file per call, so merging is the only route to a single billed eSign
  "1047_process_metric_definition.sql",          // all 97 configured processes hold the same 3 metrics with ONE distinct target between them, because metric_code is globally unique and no table let a process name its own; this adds the per-process definition and its display label
  "1051_kpi_master_config_effective_dating.sql", // kpi_master_config upserts in place, so editing a target rewrote history — a June score reported as measured against an August target; adds effective_from/to and widens the unique key
  "1052_qa_audit_capture.sql",                   // there is no quality schema in mas_hrms at all — QA_EVALUATION and QA_CALIBRATION have been granted since June with no route and no table behind them; manually-audited processes had nowhere to record a score
  "1053_qa_evaluation_page_access.sql",          // QA_EVALUATION and QA_CALIBRATION did not exist in production at all — no page_catalog row and no grants — so /quality/audit-forms was gated on a code that blocks every role
  "1057_process_quality_target.sql",             // coaching raised nothing for 41 agents because zero QUALITY_SCORE targets exist anywhere; per-process thresholds with approval and history, since measured quality runs 23.7% to 72.7% across clients
  "1054_branch_head_approval_pending_status.sql", // 138 and 141 both CREATE this table and disagree; production got 141's ENUM('approved','rejected'), so every "send to branch head" INSERT of 'pending' threw and rolled back the stage change with it
  "1054_alert_worker_governance.sql",          // alert_cooldown + the interview-delay-alert worker_config row; without this line the table is never created and alert-cooldown.ts throttles nothing
  "1055_branch_head_approval_missing_columns.sql", // 1054 fixed the enum; probing the real INSERT then showed notified_at/created_at/updated_at missing and branch_head_id NOT NULL, so the same statement still threw
  "1056_branch_head_approval_candidate_id.sql", // 138 and 141 each declare a column the other omits; production (141) has no candidate_id
  "1058_process_quality_target_state_machine.sql", // draft->simulated->pending->approved->active lifecycle; DB enforces the approver is not the author and that one open-ended active exists per process
  "1059_branch_notification_recipient.sql", // recipients were inferred from three tables with no stated intent; this is the intent
  "1060_salary_verification.sql",            // salary_verification_flag + salary_employee_verification + payroll_branch_readiness verification columns (applied manually before runner registration)
  "1060_netlogin_half_day_floor_config.sql", // the net-login half-day floor was hardcoded at 240 while the biometric one was configurable; they agreed only by coincidence
  "1061_finance_budget_topup_request.sql", // GRN overspend was already hard-blocked, but there was no formal way to ask for more against a specific budget line short of re-running the whole budget through approval again; this is that request entity
  "1062_grn_consumption_reversal.sql", // once a GRN passed finance_head_approved, budget-consumption.consume() had moved its amount into consumed with no way back; adds the 'consumption_reversed' status the reversal action sets
  "1063_auto_roster_schedule_config.sql", // wfm_process_planning_rule gets auto_schedule_enabled + auto_schedule_day_of_week so the scheduler worker knows which processes to generate for, and on which day
  // 1064 is deliberately NOT listed. It failed on invalid syntax (ADD COLUMN IF NOT EXISTS /
  // CREATE INDEX IF NOT EXISTS, unsupported by this server's MySQL) and the runner had already
  // written its filename into schema_migrations, so every retry hit a duplicate primary key and
  // STOP_ON_FIRST_FAILURE then blocked every migration after it — same failure mode as 436.
  // The file is kept for history and superseded by 1068, which carries the corrected statements.
  "1065_billability_seat_cost.sql", // is_billable is 1 on all 58,626 rows and billable_status contradicts it on nearly every one; billability is really per (process x designation), and seat cost — what the client pays per person — was never modelled at all
  "1066_billability_page_access.sql", // without a grant the screen is invisible to everyone but super_admin, which is exactly how FINANCE_COST_CENTRES ended up unreachable
  "1067_missing_page_catalog_entries.sql", // MCNMEET, MODULE_LAUNCHER, PAYROLL_SALARY_VERIFICATION were referenced in routes/nav/rbacPageMatrix.ts but had no page_catalog row, failing page-access-deployment.contract.test.ts
  "1068_celebration_post_type.sql", // supersedes 1064 with the same additive columns/index, written with the guarded INFORMATION_SCHEMA + PREPARE/EXECUTE pattern this server's MySQL actually accepts
  "1069_db_bill_budget_grn_snapshot.sql",
  "1070_db_bill_expense_particulars.sql", // the budget and GRN LINE tables — expense_entry_particular carries CostCenterId, which is the only place cost is attributed below branch; expense_particular records each budget amount twice, so expense_type must be filtered when aggregating // db_bill is the live finance system and mas_hrms mirrored none of its budget (18,433 rows), GRN (85,463) or invoice line items (21,055) — the last of which carry the cost-centre-wise seat rate the P&L needs
  "1071_pnl_revenue_basis_components.sql", // the statement renders only what finance_pnl_component_master lists, so invoicedRevenue/plannedRevenue/seatRevenueEarned/seatShortfall were computed on every request and dropped before any reader saw them
  "1072_festival_greetings.sql", // festival_calendar table + 2026 seed data (Diwali, Holi, Eid, Independence Day, Christmas, etc.) + worker_config row
  "1070_correct_auto_approved_bgv_and_bridge.sql", // never registered despite the 1070 number being reused by db-bill; applied by hand on 2026-08-03 (42 candidate_bgv_check + 6 candidate_bgv_report rows reset from fake system-verified/clear, ats_onboarding_bridge backfilled from real evidence) — listed here so a fresh environment picks it up; both halves are idempotent no-ops against data that is already corrected
  "1073_employee_profile_parity.sql", // manual HR "Add Employee" only ever captured 8 fields against the candidate journey's ~60; adds employee_education, employee_experience, employees.annual_income/count_of_dependents, employee_statutory_info declaration columns
  "1074_grn_invoice_gst_components.sql", // grn_invoice_component table + grn_cost_allocation.invoice_component_id — lets one vendor GRN's declared invoice total be broken into repeatable {amount without tax, GST slab} components (same invoice, multiple GST rates) instead of inheriting one GST rate from whichever budget line was picked
  "1075_bank_detail_sync_map_account_encrypt_false.sql", // corrects legacy_sync_map's bank_detail row: transform_rules_json declared 'account_encrypt':true but nothing has ever read that key (confirmed by grep) and live data is 100% unencrypted plaintext — the flag was asserting something the sync has never done
  "1076_mira_company_services_seed.sql", // 425's seed only inserted 6 of FALLBACK_FACTS's 7 rows (missing company-services); facts() does dbFacts.length ? dbFacts : FALLBACK_FACTS — all-or-nothing, not merged — so once any DB rows exist, a services-category question got zero facts, not even the fallback text, because 'services' was never among the seeded 6
  "1077_ai_prompt_audit_detected_intent.sql", // adds ai_prompt_audit_log.detected_intent for Mira Analytics top-intent breakdowns — instruments future requests only; question_hash/sanitized_context_hash are one-way SHA-256 hashes, nothing to backfill historical rows from
  "1078_ai_rate_limit_bucket.sql", // backs ai-rate-limiter.ts with a real table — the in-memory Map had no persistence and no cross-process sharing, so each backend process got its own independent 100/day bucket per user and a restart silently reset everyone's counter
  // 1079-1082 existed as files but were listed in neither the manifest nor the lock, so
  // they could never run anywhere — schema_migrations has no record of any of them and
  // none of their tables exist in production. That is exactly the silent-never-applied
  // failure this manifest is meant to prevent. Order matters here: 1079 and
  // 1080_credit_notes both ALTER finance_budget_snapshot, and 1081 builds on the credit
  // note table 1080 creates.
  // 1079_budget_snapshot_active_flag.sql and 1080_credit_notes_and_budget_adjustments.sql
  // are deliberately NOT listed here — see knownUnlisted in MIGRATION_MANIFEST.lock.json.
  // Their objects already exist in production, so the runner hits them as idempotent
  // errors and, by the governance rule below, refuses to record them as applied. Listing
  // them would leave verifySchemaVersion permanently short two migrations, which reports
  // the whole service as degraded (a 503 on /api/health). They go back in the manifest
  // once an admin has verified the schema and marked them complete in schema_migrations.
  //
  // Two different sessions both numbered a migration 1080. The manifest and
  // schema_migrations track full filenames, so the collision is not fatal and neither
  // file is renamed — renaming a migration is how one silently re-runs. They are
  // unrelated: BMI capture vs billing credit notes.
  "1080_bmi_manual_input.sql",
  "1081_credit_note_lines_and_provision_deductions.sql",
  "1082_apr_eligibility_config_operations_executive_fix.sql",
  "1083_wfm_attendance_exceptions_page_code.sql", // gives /wfm/attendance-exceptions its own page code instead of borrowing WFM_LIVE_TRACKER (shared with 4 unrelated pages, and it locked out payroll — who own the 455 open salary_payable_days_mismatch blockers). Additive seed, already applied to live on 2026-08-07; idempotent, so a boot re-run is a no-op
  "1084_job_requisition_interviewer_grant_removal.sql", // interviewer held the JOB_REQUISITION page grant but appears in none of the 27 endpoints in job-requisition.routes.ts, so the page 403'd for all 9 of them; the grant was the outlier, not the guards (recruiter/manager/assistant_manager fixed the other way, by widening REQUISITION_READ_ROLES)

  // Registered late, out of numeric order, and that is correct: this array is ordered by
  // POSITION, not by filename, and tracking in schema_migrations is by filename. The file
  // has sat in backend/sql since it was written but was never added here, so it never ran —
  // exactly the silent-never-applied failure this manifest exists to prevent. access.routes.ts
  // already INSERTs assigned_by_user_id (see the comment there referencing this migration),
  // so without it every scope grant throws ER_BAD_FIELD_ERROR and the grant endpoint has
  // never worked. It only touches user_assignment_scope (created back in 003) and is guarded,
  // so running it here rather than at slot 1049 is safe. Sibling files 1049_joining_document_esign_kit.sql
  // and 1049_mcnmeet_module.sql share the prefix and are unrelated.
  "1049_user_assignment_scope_granted_by.sql",

  // ── Finance / GRN / Imprest / Vendor enhancement, Phase A ────────────────────
  // All additive and guarded. 1090 ships its cutover flag OFF, so none of these change
  // behaviour on their own; they only make the new behaviour possible.
  "1085_grn_billing_cycle_and_accounting_period.sql", // OPEN/CLOSED is a business attribute kept OUT of the 12-value workflow status enum; accounting_period is the FY month the GRN books to and the source of MM/YY in the new number (bill_date is vendor-controlled and must not mint a serial in a month whose sequence has moved on)
  "1086_vendor_master_enrichment.sql",                // first ALTER to vendor_master since 024_erp.sql; adds tally name, structured address, GST-enabled/state-code and TDS terms. gst_number stays canonical — no duplicate gstin column. Two backfills, both derivations from data already in the row
  "1087_branch_master_gst_registration.sql",          // gives "Billing State Code" a source; it has none today. Display/validation only — deriving gst_type from it would silently move tax on flows that already reconcile
  "1088_vendor_expense_mapping.sql",                  // vendor -> head/sub-head restriction, intersected server-side with approved budget lines. Ships disabled (finance_config.vendor_expense_mapping_enforced = 0) because every existing vendor has zero mapping rows
  "1089_finance_approval_event.sql",                  // the workflow history GRN/top-up/imprest never had. Throws rather than swallowing, unlike audit_action_log/sensitive_action_log — a history that can drop a row is not a history (see 1033)
  "1090_finance_grn_monthly_sequence.sql",            // per-company monthly sequence for {prefix}/MM/YY/SERIAL, keyed (company_code, period_code) because db_bill issues under two live entities — CompId 1 `Mas` (68,646) and CompId 2 `IDC` (8,590). New table alongside finance_grn_sequence, which keeps its (branch_id, financial_year) PK and every historical number. No seed: every month starts at 1
  "1092_vendor_expense_mapping_legacy_import.sql",    // 1,273 of I-Spark's 1,730 vendor->head/sub-head mappings, covering 946 vendors, so Requirement 2 works on day one instead of Finance re-keying them. Static seed because db_bill is a separate MySQL 5.5 server a migration cannot reach; matched on head_code/sub_head_code because the master's UUIDs differ per environment. The 457 not imported are listed in the file, not dropped silently — nearly all are legacy's year-versioned capex sub-heads
  "1093_imprest_manager_and_allocation.sql",           // HRMS2 had no imprest model at all — `imprest` existed only as a grn_type value. Modelled on db_bill's imprest_manager (46 rows) and imprest_allotment_master (2,896, still live), but with DECIMAL money instead of int, DATE instead of varchar, effective dating on the manager, and an approval chain the legacy allotment never had
  "1094_imprest_transaction_ledger.sql",               // append-only ledger the balance derives from, plus the grn_request bridge columns and the two returned_* statuses for Requirement 9. Append-only is a code-and-review invariant, not a DB one: MySQL TRIGGERs are unavailable here, so a source-scan test asserts no UPDATE/DELETE against the table exists
  "1098_payroll_accounting_ledger_map.sql",            // Payroll -> Tally voucher mapping as CONFIGURATION, not code: which legal entity a salary posts to, and which Tally ledger each component becomes. The entity rule ships EMPTY on purpose — an unresolvable entity must refuse to produce a voucher, because defaulting everyone to MAS would put iSpark salaries in MasCallnet's books. The ledger map is seeded from the verified MAS/IDC June-2026 vouchers
  "1099_grn_period_allocation.sql",                   // Multi-month recognition (Req 5). Child of grn_cost_allocation, NOT of grn_request, so cost-centre/process/LOB attribution survives the split. It is deliberately not extra grn_cost_allocation rows: those ARE the budget-consumption rows, and 12 of them would be 12 consumption events under a rule that consumes the invoice month only. Splits pnl_cost_amount, never amount_with_tax — recoverable GST is not an expense, and leaving amount_with_tax whole is what keeps one invoice at one vendor payable
  // Deliberately NOT added: a 'salary' value on grn_request.grn_type. db_bill shows 39,099
  // historical Salary entries, but the last was 25-May-2021 and every year since 2023-24 has
  // zero — the feature was discontinued. HRMS2's payroll path (pnl-running-salary,
  // actual-people-cost) is the live source of people cost, and a second writable source would
  // double-count it in the P&L while still looking plausible. Historical rows remain readable
  // through the db_bill mirror without a writable type here.
  "1095_uat_feedback_intake.sql",                      // Phase 1 of the UAT governance platform: structured feedback intake, audit spine, attachments, comments, deterministic static-scan records, SLA policy and approver delegation. It seeds the common UAT_FEEDBACK and admin UAT page codes used by the platform routes.
  "1096_uat_release.sql",                              // Phase 1 part two: approvals, releases, structured retest evidence and rollback. Phase 2 checklist governance builds on these approval/release tables, so this must run before 1103.
  "1097_page_code_alias_grant_reconciliation.sql", // 13 role/page grants pointed at "alias" page codes no route gates on — active in the matrix, conferring nothing. Grants the real code where the role's job needs it (interviewer→ATS_RECRUITER_QUEUE, branch_head→ATS_DASHBOARD, payroll_hr→PAYROLL_EPF_COMPLIANCE, finance/accounts_head→ATS_JOINING_CONTROL_ROOM) and retires the dead EMPLOYEES alias rather than handing the employee directory to 22 more users as a side effect
  "1100_uat_notification_events.sql",                  // Registers the twelve UAT lifecycle events. notificationGateway.notify() fails CLOSED, so a call site whose event_code has no row here is silently dead — registering the events and wiring the call sites are two halves of one change, and shipping either alone produces a feature that looks present and does nothing. Left in the column-default dispatch mode so delivery is observable before anything reaches a real person; going live is an operational call, not a migration's to take
  "1101_team_attendance_page_path_fix.sql",            // Team Attendance was unreachable two ways at once: page_catalog.TEAM_ATTENDANCE pointed at '/team/attendance', which is mounted nowhere (so ModuleLauncher 404'd every wfm/manager holding the grant), while the route that does exist gated on TEAM_ATTENDANCE_MONTH, a code no migration ever created (so the gate denied everyone, super_admin included). Repoints the catalog at the real route and the router at the granted code, consolidating two codes onto the one that already carries the grants — same reasoning as 1097, which retired an alias rather than blessing it. Issues no new grant
  "1102_vendor_company_branch_applicability.sql",      // Vendor Master as THREE concepts: identity, legal-entity applicability, branch applicability. Legacy merged identity with branch by duplicating the vendor row - 1,829 rows for 1,552 names, with "Unicel Technologies" existing six times across five branches, each copy carrying its own PAN and GST. Rows are opt-in restrictions: no row means the vendor is available everywhere, so all 1,821 existing vendors keep working unchanged and this cannot break a live flow by omission. Also adds Pikquick as the third legal entity - it owns four cost centres and is company 3 in db_bill, and without it a Pikquick GRN serial could never be issued
  "1103_payroll_voucher_cohort_and_entity_seed.sql",  // Unblocks the salary voucher. 1098 shipped its entity rule EMPTY because the MAS/IDC key was unknown and it guessed at employment_type; the key is actually the employee_code prefix, so the matcher is added and both rules seeded. Also makes the MAS voucher's two-column split configuration: it is C-suite remuneration (verified - MAS00001 CEO and MAS02477 COO each reproduce their column exactly, and the two branches with no CHIEF employee have a zero column), and the C-suite changes, so it must be a row rather than two employee codes in a service
  "1104_salary_voucher_page_access.sql",              // Page catalog row + grants for the Salary Voucher screen. A <Route> alone does not make a page usable here - FINANCE_COST_CENTRES shipped with a route and no catalog row and was invisible to everyone but super_admin. Grants match the route roles and the API VOUCHER_ROLES exactly (finance_head, payroll_hr, super_admin): the page renders a whole branch payroll including individual advance recoveries, so it stays narrower than the GRN set. can_export only - the endpoint is read-only
  "1103_uat_governance_checklist.sql",                 // Phase 2 of the UAT platform: the checklist engine's tables, the LLM call log and effective-dated model pricing. Two things here are deliberate rather than incidental. Evaluations pin rule_version plus the shas of both control-plane JSON files, because "why was this allowed in March" is otherwise unanswerable and the natural wrong answer is to re-run today's rules against yesterday's decision. And pricing is a table, not a constant: a constant silently rewrites the cost of every historical call the next time someone edits it, so a spend report would disagree with itself between deploys. Also carries uat_job, the durable queue the validator runs through: an outbound call that can take a minute and fail halfway must not live inside a submit request, where a restart loses the work and leaves the item in `validating` forever with nobody aware. The seeded checklist rows are mirrors for the admin UI only — the engine reaches its floor verdict from uat/*.json, never from a DB row, and merges with worstOf() so a DB row can only make a verdict worse
  "1104_uat_prompt_governance.sql",                    // Phase 3: change-type governance and the build prompt. Two design choices carry the weight. Every switch in uat_pipeline_config ships OFF and is checked ALONGSIDE its env var with either able to veto - an env var needs a deploy to change and the moment you most want to stop the pipeline is the moment you least want to deploy, while a DB row is instant but absent if never seeded, so requiring both means a missing switch is a stop rather than a start. And the prompt is a stored row with its hash, template version and allowlist, not a string assembled on demand: it is the instruction set a coding agent acts on, so "what was it told to do" has to survive the answer being needed months later. change_type policy is a table too, so adding a signing function is a row and not a deploy, and `unclear` has its own row precisely so the gate points at triage rather than finding no policy and reading that as no approval required
  "1106_uat_build_run.sql",                            // Phase 4 schema, held behind gates. The tables ship; the feature does not. uat_gate_status carries G1-G8 with `met` defaulting to 0 and the seed supplying only the requirement text, so no gate can arrive attested - and assertDispatchAllowed() refuses while any row is unmet, which makes the hold a property of the running system rather than of everyone remembering the plan. An EMPTY gate table is read as all-unmet, not as no gates, because a migration that failed to seed would otherwise silently unlock the most dangerous feature here. uat_build_callback is keyed on (run, kind, attempt, gates_sha256) so a GitHub retry after a network ambiguity succeeds while a replay cannot record a second result. Note fk_uat_evobj_fb: FK names are database-global in MySQL and fk_uat_ev_fb was already taken by uat_feedback_event in 1095

  // ── Registered late, out of numeric order — same reasoning as 1049 above ─────
  // This file has sat in backend/sql since 2026-08-07 and was in NO manifest, so it has
  // never run: report_master.CC_HEADCOUNT is still named "Call Centre Headcount" on live
  // (verified read-only on 192.168.10.6, 2026-08-08). Its own header explains the omission
  // — "production runs with SKIP_MIGRATIONS=true, so a deploy applies nothing" — and that
  // premise is false for this deployment: there is no SKIP_MIGRATIONS, migrations run at
  // boot, so the author's intended manual run never had to be manual.
  //
  // Leaving it unlisted is the worse half of a half-shipped change. The CODE side already
  // landed (reporting.service.ts cc_headcount now filters e.active_status = 1, fixing a 52x
  // overstatement), so the report computes call-centre headcount correctly while still
  // being LABELLED in the way that made users read it as cost-centre headcount — which is
  // the confusion the rename exists to remove.
  //
  // ⚠ Adding it here means the rename applies on the next restart. That is the intent, but
  // it is a user-visible label change: "Call Centre Headcount" -> "Call Centre (Dialer)
  // Headcount". Name only — report_code, query_key, category and permissions are untouched,
  // so every link, saved filter and role grant keeps working, and no row is deleted.
  //
  // The 1084 prefix collides with 1084_job_requisition_interviewer_grant_removal.sql above.
  // Harmless: this array is ordered by POSITION and schema_migrations tracks full filenames,
  // exactly as the 1049 note records for its own sibling collision.
  "1084_cc_headcount_disambiguate_cost_vs_call_centre.sql",
  "1105_revoke_unusable_alias_corrective_grants.sql", // self-correction to 1097: three of its five corrective grants opened a page whose APIs reject the role — interviewer on the recruiter workspace, finance_head/accounts_head on the joining control room. Reverted there; branch_head→ATS_DASHBOARD and payroll_hr→PAYROLL_EPF_COMPLIANCE were verified working and kept. Re-added after 334f16e1 dropped this line
  "1107_retire_duplicate_alias_page_grants.sql", // retires 37 page grants on alias codes no route gates on, only where the role already holds the canonical code for the same page — so access is unchanged and only a duplicate/dead launcher tile goes away. The 7 alias-ONLY grants are left alone: those are access questions, and 1097/1105 is the cautionary tale
  "1112_notification_dispatch_block.sql",        // The emergency stop the dispatchService path never had. notificationEventService -> dispatchService carries the whole 53-event catalogue and read NO enable flag, so halting the 1,863-message eSign storm required `pm2 stop hrms2-workers` — all 45 workers. scope='global' or an event_code, effective in <60s, no deploy. Deliberately NOT a notification_event_config row: recipient_spec there is json NOT NULL and the gateway resolves recipients from it, so a row added purely as a switch asserts a recipient policy this path never reads — the exact trap the repo already warns about. Seeded UNBLOCKED, and the reader fails OPEN, because a killswitch that silences payroll mail on a DB blip is worse than the storm it prevents
  "1109_esign_notification_cooldown.sql",        // Durable cooldown for esign-compliance, replacing in-process Maps that every pm2 restart emptied — with a cycle running at startup, that put 1,428 emails and SMS onto 10 contacts over 3 days from 3 pending documents, 47 of them to one preboarding candidate. Also seeds the worker_config row the worker now reads, DISABLED, because there was previously no killswitch anywhere: notification_event_config has no row for either event and only the gateway reads that table, while this worker dispatches straight through dispatchService, which consults no flag at all. Turn it on with a single UPDATE once the cooldown table is seen filling
  "1108_retire_alias_only_page_grants.sql", // retires the last 7 grants on alias page codes no route gates on, held by roles that do NOT hold the canonical code. Each was checked against what actually decides access before deciding: interviewer is rejected by every /ats/recruiter/* endpoint; hr_admin and payroll_admin are absent from their target routes' own role lists; branch_payroll/finance_head point at PAYROLL_DASHBOARD whose page_catalog row is inactive. Nobody loses reachable access
  "1113_reactivate_drifted_page_catalog_rows.sql", // re-activates MODULE_LAUNCHER, ORG_CHART, ORG_MASTERS and CUSTOMIZATION_MANAGER, four real routed pages (208-1,947 line components) that nobody in production can open: an inactive page_catalog row is discarded by getUserPageAccess's `COALESCE(pc.active_status,1)=1` filter AND excluded from the super_admin all-active rule, so 10 live can_view grants across 10 roles are silently voided. Drift, not retirement: every deliberate retirement here names its codes (601, 1022, 1025, 1097/1105, 1108) and none names these, while 1067 explicitly created MODULE_LAUNCHER active on 2026-08-03 to fix a failing contract test. ORG_MASTERS is the tell — it is in the demo ALL_PAGES, so a demo login opens Org Masters while no real user can. Grants nothing new; only stops existing grants being discarded. Runs once, so it cannot override a later admin decision
  "1111_uat_admin_page_grants.sql", // seeds the two admin role_page_access rows for UAT_TRIAGE_CONSOLE and UAT_RELEASE_BOARD. 1095 seeds page_catalog and rbacPageMatrix.ts lists both under admin, but neither is read at runtime for role grants: getUserPageAccess() resolves from role_page_access plus COMMON_USER_PAGE_CODES, and the live table had 0 rows for any UAT page against admin's 48 others. Without this, super_admin sees all four UAT pages via the all-active rule and every employee sees UAT_FEEDBACK via the common set, but no admin can open the triage console or release board — the pages ship unreachable by the population meant to run them. INSERT IGNORE, not ON DUPLICATE KEY UPDATE, so it never resurrects a grant that 1105/1107/1108-style retirement deliberately revoked
  "1110_bank_account_number_encryption.sql", // adds employee_bank_detail.account_number_enc for the AES-256-GCM work in 851d78ca. Was unlisted because it could not run: it was written `ADD COLUMN IF NOT EXISTS`, which is MariaDB syntax that MySQL 8.0.42 rejects with ER_PARSE_ERROR — the same mistake that got 1064 dropped. So the column reached production by hand while schema_migrations had no row for it and a fresh database would not get it at all, leaving five payroll/finance queries reading a column that only exists here. Rewritten with the PREPARE idiom used by 181 migrations in this directory and executed against mas_hrms: 5/5 statements OK, 16 columns before and after, 12,768 rows and 6,491 encrypted values untouched. A bare ADD COLUMN would have been tolerated as ER_DUP_FIELDNAME but only lands on migrationHealth.skipped, which is not recorded-as-applied
  "1120_rebaseline_138_checksum_crlf.sql", // stops the checksum-mismatch warning that migration 138 logs on EVERY boot. NB: do not name another .sql file inside double quotes in these comments — the manifest guard parses quoted .sql strings as entries and will report your prose as a missing file. Not content drift: the runner sha256s raw file bytes, and 138 was applied by executor 'manual:manual-repair' from a Windows checkout, so the stored hash is of the CRLF copy (4b6b0184) while every Linux environment reads the LF file (0157b52b). Stripping CR from the CRLF copy reproduces 0157b52b exactly; git diff is empty and git ls-files -v reports H, so the tracked content never changed. Re-baselines to the LF hash, guarded on the exact known-bad value so it is idempotent and cannot touch another migration. Does not re-run 138 — the runner skips applied files regardless of checksum. Lesson: apply migrations from the server, never from a Windows working copy
  "1121_rebaseline_436_checksum.sql", // stops the checksum-mismatch warning migration 436 logs on every boot. Unlike the 138 case this IS content drift, not line endings: 436 ran on 2026-07-31 and was edited afterwards, its INSERT gaining a rule_name column plus a CONCAT to populate it, so the stored hash describes a file that no longer exists. Rebaselining is normally the wrong answer — it cannot tell "gained a comment" from "gained SQL the database never ran", and burying the second is real schema drift. Checked against live before writing this rather than assumed: the 13 department rows at scope_type='department', priority=50 all carry a populated rule_name, so the edited statement HAS run, applied by hand without the ledger being updated. Nothing is outstanding; only the record is stale. Guarded on the exact old hash so it is idempotent and cannot touch another row. Found by scripts/checksum-drift-audit.mjs, which recovers the version that actually ran from git blob history and diffs it with comments and whitespace normalised away — 436 was the only one of 504 it could prove had substantive drift
  "1117_deactivate_e2e_fixture_employees.sql", // deactivates MAS36039..MAS36048, ten E2E fixtures ("Test <role> E2E ...", @e2etest.local) carrying active_status = 1 and so counted as live staff — they were the whole remainder of the no-valid-branch population after 1115, and they generate real attendance/roster/leave data, inflating headcount 1,127 vs a real 1,112. Deactivation, not deletion, so their history stays and is simply attributed to an inactive employee. Guarded on employee_code + branch_id IS NULL + the e2etest email + NOT EXISTS(salary_prep_line): the payroll guard is the load-bearing one, since it makes the statement decline any row payroll has costed. The four "Codex E2E Candidate" rows and "Jeera Test" are deliberately NOT included — they sit on real branches and the Codex ones carry 2 salary_prep_line rows each. Reversible; note these hold auth_user logins, so an external E2E pipeline needing them ACTIVE would need the rollback in the file header
  "1115_reactivate_operational_branches.sql", // flips active_status 0 -> 1 on Delhi Office (DELHI) and Head Office (HQ, Mumbai). Both carry live staff — 51 of 51 and 11 of 12 have attendance in the last 30 days (newest 2026-08-06) — and neither has a close_date, so neither was deliberately closed; 63 people work at branches the platform treats as shut. Moving the employees instead is not available: every active branch is Ahmedabad or Noida. Note these are NOT duplicate rows to merge — HEAD OFFICE (CORP) is Sector 62 Noida and Head Office (HQ) is Mumbai, so merging on name would relocate 12 Mumbai employees and corrupt their ID-card address, payroll voucher grouping and attendance scoping. Guarded on active_status = 0 AND close_date IS NULL AND an EXISTS on live employees, so it is idempotent and declines to force a row whose state has since changed
  "1114_seed_expense_categories.sql", // seeds the seven expense categories. expense_categories has existed and been empty since backend/sql/migrations/099_create_expense_tables.sql half-applied: that file created this table as its first statement then died on its second, where expense_claims declares employee_id INT with a foreign key to employees(id), which is char(36) — MySQL rejects a foreign key whose type does not match the referenced key (errno 3780) — so the master was created, never populated, and the three tables after it never created at all. With an empty master the expenses module cannot accept a line, because addExpenseItem validates category_id against it. The seven names map one-to-one onto expense_claim.category ENUM(travel,accommodation,meals,transport,communication,office,other), which toCategoryEnum() matches by lowercased name; anything outside that set would silently store as 'other'. Idempotent by name rather than INSERT IGNORE, since the table has no unique key on name. Applied to mas_hrms 2026-08-08 (ids 1-7) and then re-executed inside a rolled-back transaction to prove it: 7 statements, 0 affectedRows, count unchanged. expense_claim and the CEO P&L were verified unchanged either side
  "1116_create_kpi_template_and_process_assignment.sql", // creates kpi_process_assignment, which /api/portal/internal/kpi-assignments joins to kpi_template and process_master and which its POST and DELETE write to. The table does not exist, so all three raised ER_NO_SUCH_TABLE and the KPI Assignments tab in EnhancedClientMaster.tsx could not list, save or delete. This re-runs DDL that 509_portal_client_master_fixes.sql already contains rather than designing anything new: 509 is listed here and schema_migrations records it applied on 2026-07-19, yet none of its three declared tables exists — portal_user_sessions, portal_user_permissions and kpi_process_assignment are all absent, so that file was recorded as applied without its statements taking effect. Only the table the endpoints need is repaired here; the two portal tables are left alone deliberately, because whatever allowed 509 to be recorded without running may have done the same to other files and wants investigating rather than patching file by file. The definition matches 509's exactly — same UNIQUE KEY, index, FK, charset and collation — so the two cannot drift. That UNIQUE KEY on (process_id, template_id, effective_from) is load-bearing: the POST uses ON DUPLICATE KEY UPDATE and without a unique constraint to update against would insert a duplicate on every re-assignment. char(36) utf8mb4_unicode_ci matches kpi_template.id; the server default is utf8mb4_0900_ai_ci and an FK whose collation differs from the referenced key is rejected with errno 3780, which is what half-applied 099. kpi_template is NOT created here — it already exists, created 2026-05-29, and is owned by 010_kpi.sql earlier in this manifest. CREATE TABLE IF NOT EXISTS, so it is idempotent; not executed by hand — it applies on the next backend start
  "1118_complete_509_portal_client_master.sql", // applies the part of 509_portal_client_master_fixes.sql that never took effect. 509 is recorded applied on 2026-07-19 and its first two column additions did land (client_master.legal_entity_name, process_master.process_owner_name), but nothing after them. Cause, traced statement by statement: 509 guards its client_user ALTER on one column (COUNT(*) ... COLUMN_NAME='phone'), phone was absent so the guard passed, but the ALTER adds eleven columns and an index in a single all-or-nothing statement and access_level already existed — so it failed ER_DUP_FIELDNAME, which is on the runner's idempotent list and was swallowed as benign, ending the file before its three CREATE TABLEs. Each column here is guarded on itself, which is the whole point; access_level is deliberately excluded since re-adding it is the exact statement that broke 509, and the index is guarded on INFORMATION_SCHEMA.STATISTICS because the column can exist while the index does not. The two CREATE TABLEs are copied from 509 unchanged so the files cannot disagree — those two were executed 2026-08-09 and already exist; the ten columns had not applied at that point. No application code reads portal_user_sessions or portal_user_permissions today, so this restores intended schema without changing behaviour on its own. Every statement is individually guarded, so re-running is a no-op
  "1119_complete_246_gratuity_audit.sql", // applies the part of 246_nominee_gratuity_distribution.sql that never took effect. 246 is recorded applied and its first table landed (gratuity_distribution exists), but three later objects did not. Found by auditing all 475 manifest files recorded as applied against the tables they declare, after 509 turned out to have lost its tail the same way; 246 is the only other genuine instance. Two distinct known traps: gratuity_calculation_audit declares FKs to employees(id) and exit_request(id) but no COLLATE, and the server default utf8mb4_0900_ai_ci against those tables' utf8mb4_unicode_ci is rejected with errno 3780 (what half-applied 099); and the two full_final_calculation columns were written ADD COLUMN IF NOT EXISTS, MariaDB syntax MySQL 8.0.42 rejects with ER_PARSE_ERROR (what got 1064 dropped and left 1110 unlisted). Executed 2026-08-09: 12/12 statements OK, table created utf8mb4_unicode_ci with both FKs intact, both columns added. 246's follow-up UPDATE back-filling nominee_distribution_status is deliberately NOT repeated — the column is created with its declared default, and re-running a back-fill months later would overwrite any status since set; this adds schema, it does not decide anyone's F&F state. Nothing reads the audit table today, but it is the record of how a gratuity figure was reached, which a payroll platform should not compute without. Every statement individually guarded, so re-running is a no-op
  "1122_employees_aadhaar_blind_index.sql", // adds employees.aadhaar_blind_index CHAR(64) NULL and idx_employees_aadhaar_blind. Purely additive: nothing writes or reads the column, so applying it changes no behaviour. It is the missing half of the lookup path for encrypted statutory identifiers — aadhaar_number and pan_number are now fully encrypted alongside their plaintext (30,108 and 23,341 rows, measured 2026-08-10), but the plaintext cannot be retired while anything still looks these values up by equality, and the duplicate-employee guard in employee-creation-orchestrator.service.ts does exactly that. pan_blind_index already exists with its index; there was no Aadhaar equivalent, and Aadhaar is the better key of the two — 1,043 of 1,117 active employees carry one (93%) against PAN's 915 (82%). char(64) matches pan_blind_index and blindIndex()'s HMAC-SHA256 hex output exactly; nullable because most rows have no Aadhaar and a blind index of an absent value is meaningless. Population is deliberately NOT here: scripts/statutory-blind-index-backfill.ts must run on the production host, because an index built with the development key matches nothing at lookup time and nothing reports an error — the duplicate guard would simply stop finding duplicates, reopening the hole that MAS63086/MAS62457 exposed rather than closing it. That script refuses to run when isUsingDevBlindIndexKey() is true, which is the only defence available: a blind index is one-way, so there is no ciphertext to parity-check against as there is for the encrypted columns. Both statements guarded through information_schema + PREPARE, since MySQL 8.0.42 rejects MariaDB's ADD COLUMN IF NOT EXISTS with ER_PARSE_ERROR; the index is guarded separately against STATISTICS because the column can exist while the index does not. Idempotent, so re-running is a no-op
  "1123_statutory_identifier_encryption_columns.sql", // adds the encrypted-at-rest columns for the statutory identifiers that still had none: ats_candidate.aadhar_number_encrypted and .pan_number_encrypted, employee_statutory_info.pan_number_encrypted plus pan_blind_index and its index, and vendor_master.pan_number_encrypted. Purely additive — every column is nullable and nothing reads or writes any of them, so applying this changes nothing observable. employees was encrypted on 2026-08-10 (aadhaar 30,108 / pan 23,341, ciphertext matching plaintext exactly) but these three tables were not, and between them they hold roughly 54,000 identifiers in cleartext with nowhere to put ciphertext: ats_candidate.aadhar_number 28,764, ats_candidate.pan_number 24,929, employee_statutory_info.pan_number 3,341, vendor_master.pan_number 1,373. ats_candidate matters more than its name suggests — roughly 30,000 of its 37,634 rows are legacy EMPLOYEE records carried in by candidate_code, so this is staff PII. Two deliberate omissions: employee_statutory_info.aadhaar_id gets nothing, because it does not hold Aadhaar numbers (3,946 populated, exactly 1 matching ^[0-9]{12}$, and 9,186 values of <= 3 characters drawn from 14 distinct strings — blank, 'NA', 'N/A', ',', 'NAN', 'aa'), so encrypting it would dress a data-quality problem as a security fix; and ats_candidate gets no blind index because aadhar_number_hash and pan_number_hash already exist and are already the lookup path, so a second index would create two rival lookups for one value. employee_statutory_info.pan_blind_index IS added, because the duplicate-employee guard reads s.pan_number by equality and would have no lookup path once plaintext is retired. Population is a separate explicit backfill (scripts/statutory-identifier-encrypt-backfill.ts) that proves it holds the production key by decrypting existing employees ciphertext before writing anything — verified refusing on a dev machine: 0/25 decrypt, exit 1, nothing written. Each column is guarded individually through information_schema + PREPARE rather than one multi-column ALTER, deliberately: 509_portal_client_master_fixes lost its tail precisely because eleven columns went in one all-or-nothing statement that failed ER_DUP_FIELDNAME on one of them. MySQL 8.0.42 also rejects MariaDB's ADD COLUMN IF NOT EXISTS with ER_PARSE_ERROR. Idempotent, so re-running is a no-op
  "1124_salary_prep_line_covering_index.sql", // covering index (employee_id, gross_salary, net_salary) for the payroll summary's two payroll-line aggregates. /api/payroll/summary runs 3.5s warm over the public DB link, and profiling statement by statement puts effectively all of it in one subquery shape that appears twice: SELECT 1 530ms, COUNT(*) active employees 475ms, SUM(ctc) 311ms, SUM(gross_salary) over the join 3,659ms, whole query 3,653ms. So it is neither chatty nor middleware. employee_id is already indexed (idx_spl_employee_run, idx_overtime) so another plain index would change nothing — what is missing is the summed columns, so the server resolves the key by index then reads the row for gross_salary/net_salary 14,277 times. Additive: no existing index is dropped, so DROP INDEX reverses it completely. 80,338 rows, quick build. Guarded on INFORMATION_SCHEMA.STATISTICS rather than ADD INDEX IF NOT EXISTS, which is MariaDB syntax MySQL 8.0.42 rejects. NOT applied by hand — the ALTER hit "Lock wait timeout exceeded" against the live backend and workers holding transactions on this table, and it rolled back cleanly (6 indexes / 10 index columns before and after). Boot runs migrations before the app serves, which is when contention is lowest, so it applies there
  "1125_legacy_payslip_snapshot_account_encryption.sql", // adds account_number_enc TEXT NULL and account_enc_key_version TINYINT NOT NULL DEFAULT 1 to legacy_payslip_snapshot. Purely additive: both nullable-or-defaulted, nothing reads or writes either, so applying this changes nothing observable. This is the largest unprotected PII store left — 115,698 populated bank account numbers, 18,521 distinct, varchar(50), with no protected sibling of any kind, roughly 4x the employees encryption done on 2026-08-09. The coverage scan classifies it NO_PROTECTED_COLUMN_EXISTS, its worst category, and by row count it is the biggest entry in that report. The TABLE is alive and must not be dropped — it is salary source #3 for appointment letters and holds the only arrear column anywhere — but the COLUMN is dead: verified across backend/src and src, nothing references it, every account_number in payroll.routes.ts and payroll.executor.ts is qualified to a different table (ebd.account_number or e.bank_account_number) so none can resolve here, and the one SELECT * against the table destructures an explicit allow-list of salary fields that never touches it. That is why this one is unusually cheap to finish: for employees.pan_number the expensive part of retiring plaintext is migrating ~10 readers, whereas here there are none, so backfill can be followed straight by clearing the plaintext. Encrypting rather than scrubbing because only 105,317 of the 115,698 match the account currently on the employee record — about 10,000 are accounts since changed, which is audit history worth keeping. No updated_at hazard: unlike employees this table has no on-update timestamp column and no triggers (both verified live), so the backfill needs none of the timestamp suppression that one required. Population is a separate explicit backfill, scripts/legacy-payslip-account-encrypt-backfill.mjs, which must run on the production host — anywhere else loadKey silently substitutes the all-zeros dev key and writes ciphertext production can never decrypt. Both columns guarded individually through information_schema + PREPARE, since MySQL 8.0.42 rejects MariaDB ADD COLUMN IF NOT EXISTS with ER_PARSE_ERROR, and per-column rather than one ALTER because a multi-column statement is all-or-nothing. Idempotent, so re-running is a no-op
  "1128_statutory_filing_record.sql", // creates the table behind /api/payroll/statutory-filing, which has never existed, so every endpoint on that router has always returned 500. The router creates it lazily via ensureTable(), and that DDL cannot execute: MySQL 8.0 requires a functional key part in its own parentheses and the shipped UNIQUE KEY wrote COALESCE(state_code, '') bare, which is ER_PARSE_ERROR - proven against production 8.0.42 by running the exact DDL as a TEMPORARY table. Every call site was `await ensureTable().catch(() => {})`, so the parse error was discarded and the query after it failed on a table that had never been created; the initialise endpoint then reported created=0 skipped=6 from its own `catch { skipped++ }`, a success shape for an operation that did nothing. Purely additive and idempotent - CREATE TABLE IF NOT EXISTS for a new empty table, no data to migrate because it has never held a row, nothing else touched. Applying it makes the statutory filing tracker (EPF/ESIC/PT/TDS 24Q/138/LWF due dates, challans and filed status) work for the first time.
  "1129_cost_centre_page_access.sql", // seeds the page_catalog row and role_page_access grants for FINANCE_COST_CENTRES, which have never existed in any SQL file. This is the page two other migrations already cite in their own headers as the cautionary example - 1066 and 1104 both describe it as "shipped with a route and no catalog row and was invisible to everyone but super_admin" - and neither of them fixed it. Everything else is present and working: the Route and Gate in finance.routes.tsx:57, the CostCentreManagementPage component, a navConfig entry, and 14 live endpoints in cost-centre-management.routes.ts; but WorkforcePageGate resolves access from role_page_access, so with no grant it denies every caller except super_admin, who is elevated to all active page codes unconditionally. Grants mirror CC_READ_ROLES in the router exactly (super_admin, admin, finance_head, accounts_head, finance, branch_head, branch_admin) rather than a wider set, because granting a role the page while the API refuses its calls is the defect this same audit found on six other screens. Write flags follow the API's own narrower CC_CREATE_ROLES/CC_L1_APPROVAL_ROLES split, so finance/branch_head/branch_admin get can_view only; can_delete is off for everyone because the service supersedes rather than deletes, and a cost centre is what budgets, GRNs and P&L attribution resolve spend through. Purely additive and idempotent - two INSERT ... ON DUPLICATE KEY UPDATE statements against page_catalog and role_page_access, no schema change, no existing grant touched. Rollback is the two active_status = 0 updates in the file's footer
  "1129_org_chart_access_log.sql", // creates the table behind org-chart access auditing, which has never existed, so no org chart view, search, node lookup or export has ever been recorded. logOrgChartAccess() wraps its INSERT in try/catch and logs to console - correct for an audit write, since a failed log should not deny a user their page, but it means a missing table yields a working feature with no audit trail and nothing surfaces the difference. The org chart itself was never broken; only the record of who looked at it. Worth creating because the chart exposes the whole reporting hierarchy and the module already logs four action types against it including export, which the charter requires be auditable - the recording code is complete and already called on every path, only the table was absent. Columns come straight from that INSERT; append-only, so there is no unique key to get wrong. Verified by running the exact DDL as a TEMPORARY table against production 8.0.42 and replaying all four action types through it. Idempotent and additive.
  "1130_ats_candidate_record_type.sql", // adds ats_candidate.record_type VARCHAR(20) NOT NULL DEFAULT 'candidate' plus idx_ats_candidate_record_type. ats_candidate holds 37,696 rows of which 29,926 are legacy EMPLOYEE records whose candidate_code matches a real employees.employee_code, and only 7,770 are genuine candidates; nothing marked which was which, so ~20 query sites each repeat a correlated NOT EXISTS over 30k rows. employees and candidate_onboarding_profile got source_type/source in migrations 052 and 062 — ats_candidate, the table that actually got polluted, never did. Purely additive and inert: every existing row takes the DEFAULT, which is deliberately WRONG for the 29,926 legacy rows until scripts/ats-candidate-record-type-backfill.mjs runs, and nothing reads the column until excludeEmployeeShapedCandidatesSql is repointed in a separate change AFTER that backfill. Repointing early would mark every legacy row as genuine and undo every exclusion fixed this week. status='Inactive' is not a usable proxy and the file records the confusion matrix showing it would wrongly drop 2,626 genuine candidates. Column and index guarded separately via information_schema + PREPARE (MySQL 8.0 rejects ADD COLUMN IF NOT EXISTS), so re-running is a no-op
  "1131_bulk_operation_jobs.sql", // creates the table behind the client portal bulk operations, which has never existed. createBulkJob() is called from client.routes.ts and its INSERT is not wrapped, so posting a bulk job has always returned 500 - unlike most of the missing-table defects found alongside it, this one never failed silently, the feature simply never worked. Every column is determined by code rather than inferred: the INSERT names five and returns result.insertId so the key must be numeric AUTO_INCREMENT not a UUID, updateBulkJobProgress writes four more and toggles status between PROCESSING and COMPLETED, and the exported BulkOperationJob interface names the rest. status is VARCHAR not ENUM because the interface types it string and only two values appear in code; an ENUM would silently reject a third one added later, which is this table diagnosis in another form. Verified by executing the DDL as a TEMPORARY table against production 8.0.42 and replaying createBulkJob, both updateBulkJobProgress transitions and getBulkJobs through it. completed_at is created to match the interface but nothing writes it - flagged, not fixed, since that is existing behaviour. Idempotent and additive.
  "1132_salary_prep_line_reimbursement_total.sql", // adds salary_prep_line.reimbursement_total DECIMAL(10,2) NOT NULL DEFAULT 0.00, matching incentive_total which sits next to it in every write. payrollCalculate.service.ts has written to this column on every targeted recalculation since commit 0840dfe1 with no migration ever creating it; verified live 2026-08-12 by triggering a targeted recalculation for 130 employees and watching all 130 fail with ER_BAD_FIELD_ERROR on this exact column. Not limited to that cohort - any targeted recalculation, for any employee, in any month, hits the same failure; the original bulk run-generation path is unaffected, which is why existing salary_prep_line rows look fine. Guarded via information_schema + PREPARE, so re-running is a no-op. Changes no payroll arithmetic - only closes the schema gap the code already assumed existed.
  "1133_performance_feedback_request_overall_comments.sql", // adds performance_feedback_request.overall_comments TEXT NULL, the one field of a submitted review 037_performance_feedback.sql left without a column. Ratings live at one row per (request_id, competency_id) in performance_feedback_response, so its comments column is per competency; the reviewer's single closing narrative (managerFinalComment, max 2000 chars) has no home at that grain. performance_feedback_report.manager_feedback is where it is finally read back, but the report is generated by a separate later step, so nothing could hold the text in between. The service had been writing it to performance_feedback_response.development_areas and overall_strengths, neither of which exists, so no submission has ever stored it. Nullable to match manager_feedback and because the 5 existing request rows predate it. Verified by executing the DDL against a TEMPORARY copy of the production table on 8.0.42 and replaying submitFeedback and generateReport through it. Guarded by information_schema, so re-running is a no-op; additive, touching no existing column, index or constraint.
  "1134_upload_batch_import_audit.sql", // adds upload_batch.imported_by CHAR(36) NULL and imported_at DATETIME NULL, the two columns every bulk-upload service already tried to write when closing a batch. The table tracked who uploaded and who validated but nothing about the import, so the completion UPDATE named two columns that did not exist and raised ER_BAD_FIELD_ERROR - leaving batch_status at its previous value and imported_rows unset, which is why a finished upload never showed as imported. Commit 227b92c1 dropped the two names to make the update work; this restores the audit they were reaching for. Shapes match the columns beside them: imported_by mirrors uploaded_by/validated_by (CHAR(36), nullable, no FK), imported_at mirrors validated_at (DATETIME, nullable). Nothing is backfilled and the 4 existing rows are untouched. Each ADD is guarded independently by information_schema, so re-running is a no-op and a partially-applied state resolves correctly. Verified by executing both ALTERs against a TEMPORARY copy of the production table on 8.0.42 and replaying the completion UPDATE through it.
  "1135_mira_fix_draft.sql", // creates mira_fix_draft, the record for the still-unbuilt second half of Mira issue-triage: today the pipeline only ever produces a diagnosis (root-cause hypothesis + suggested next step) and explicitly logs it as "not an applied fix" - nothing generates a real code change, and nothing pushes or deploys anything. Reported live 2026-08-13 when a super_admin asked what execution happened after a triage diagnosis and there was no answer. This table is Phase 1 (schema only, additive, inert): one row per AI-drafted fix attempt against a triaged work_item, carrying the diff, why the server-side deny-list accepted or auto-rejected it, who reviewed it, and the deploy outcome. Nothing reads or writes it yet - see mira-fix-draft-guard.ts for the deny-list that must gate it before any deploy route exists. Same collation as work_item (utf8mb4_unicode_ci) explicitly, since work_item_id will be joined against work_item.id and a mismatched default throws ER_CANT_AGGREGATE_2COLLATIONS on the first join. No FK on work_item_id, matching work_item's own style of indexing rather than constraining assigned_to_user_id. CREATE TABLE IF NOT EXISTS, so re-running is a no-op.
  "1137_lms_admin_role_catalog.sql", // seeds workforce_role_catalog with 'lms_admin', a role lms.service.ts's hasLmsAdminRole() has checked for since that function was written but which was never added to the catalog, so assignRole() (which validates against this catalog) could never actually grant it to anyone. Found live 2026-08-13 diagnosing Harneet Kaur's "LMS access is not assigned for the admin portal" error; applied directly to production and verified (role seeded, granted to her user_roles, ROLE_ASSIGNED audit row written) before this file was added here, so this entry is for every other environment, not a pending action on this one. Additive only, INSERT ... ON DUPLICATE KEY UPDATE against static reference data - no PII, no encryption keys, unlike 1136's blind-index migration - so unlike that one this is safe to apply automatically at next boot.
  "1138_leave_balance_deduction_audit.sql", // CREATE TABLE IF NOT EXISTS only, no existing table/column touched — records the (leave_type_id, balance_year, days) breakdown a leave approval actually deducted, so cross-year and CL/ML-pooled deductions can be reversed exactly instead of re-derived. Part of the 2026-08-13 leave-module audit fix (#12/#13/#14/#7).
  "1139_disable_dead_leave_approval_workflow.sql", // UPDATE approval_workflow_master SET active_status=0 for the never-wired 'LEAVE_APPROVAL' TL->HR workflow definition — it was visible in /workflow-admin as an apparently-live 2-step workflow including an HR step, contradicting the confirmed Employee->Manager->Approved-only policy. No leave_request has ever referenced it (never called), so no dependent rows exist. Reversible (row kept, only active_status flipped). Part of the 2026-08-13 leave-module audit fix (#24).
  "1211_salary_prep_run_incentives_applied_at.sql", // Creates salary_prep_run.incentives_applied_at, which migrations 398 and 404 both FAILED to create - each used `ADD COLUMN IF NOT EXISTS`, rejected by this server MySQL 8.0.42 with ER_PARSE_ERROR (the migration-1006 failure mode). 398 is recorded as applied in schema_migrations (2026-07-20) while the column does not exist; verified live 2026-08-13 over the public host, information_schema returns 0. Two live paths break on it: POST /runs/:id/calculate SELECTs the column unless force=true and so 500s (masked today only because the readiness gate 409s first), and incentives.service.ts applyToRun() UPDATEs it as its final statement, after having already rewritten salary_prep_line. Additive and idempotent: nullable, no default, both statements information_schema-guarded, so every existing run reads NULL - which is true, since incentive_upload_batch is empty. No payroll figure changes.
  "1212_payslip_email_tracking_and_missing_indexes.sql", // salary_prep_line.payslip_emailed + payslip_emailed_at + idx_spl_payslip_gen, and profile_update_approval.idx_branch_status. Migration 402 declared all four of its columns in ONE `ADD COLUMN IF NOT EXISTS` statement, which this MySQL 8.0.42 rejects at the token (the 1006/398 failure mode) — yet 402 is RECORDED AS APPLIED. Two of its columns exist (added out of band), the other two never did; same story for 262's index. Verified live over the public host 2026-08-13. This is not dormant schema: POST /runs/:id/email-payslips does nothing but UPDATE those two columns, and GET /runs/:id/bulk-payslip-summary SELECTs one of them, so both endpoints — reachable and unshadowed, checked against every router mounted on /api/payroll ahead of payrollMoreRouter — have 500'd on every call since they shipped. Additive and idempotent: payslip_emailed is NOT NULL DEFAULT 0, which is the correct reading of every existing row since nothing could ever have set it; both indexes are read-path only; all four statements are information_schema-guarded and the profile_update_approval one is additionally guarded on its column existing, so a rebuilt database that runs this before 262 does not fail. No payroll figure is read or written.
  "1215_payment_file_reproducibility.sql", // Adds file_name, content_sha256, total_amount, excluded_count and excluded_amount to the EXISTING payroll_register_export_log, plus idx_pre_run_hash — rather than creating a second payment-file log beside it, which would be the two-rival-systems mistake this audit keeps finding elsewhere. That table already has a live writer (payrollCompliance.routes.ts) and its register_type enum already carries bank_register; it holds 0 rows only because that register endpoint has never been called. GET /runs/:id/neft-export now records every generated file here BEFORE handing it over, so a regeneration can be compared byte-for-byte against what was submitted to the bank. Every column is NULLable with no default so the existing writer keeps working untouched and existing rows keep their meaning. Turns readiness check PAYFILE_GENERATION_NOT_REPRODUCIBLE from a permanent SOURCE_MISSING into a real gate that fails only when one run has two generations with DIFFERENT hashes. Reads and writes no payroll figure.
  "1216_incentive_upload_batch_remarks.sql", // Adds incentive_upload_batch.remarks, which incentives.service.ts createBatch() has always tried to INSERT and which does not exist on the table. The INSERT is not wrapped in a catch, so POST /api/incentives/batches raises ER_BAD_FIELD_ERROR and NO incentive batch can be created by any caller — very likely why the entire incentive pipeline reads as built-but-unused (all four incentive tables hold 0 rows and salary_prep_line.incentive_total is 0.00 across all 80,469 lines, while db_bill paid Rs 12,91,754 of incentive in June 2026 alone). Found by a PREPARE sweep of every SQL literal against the live schema. Added rather than dropped from the INSERT because the API accepts remarks, the service signature declares it and getBatchById returns it via SELECT iub.*, so dropping it would silently discard a caller value. TEXT NULL, information_schema-guarded, no existing row affected (there are none). No payroll figure touched.
  "1140_absence_penalty_config.sql", // CREATE TABLE IF NOT EXISTS only — architecture for a future superadmin-configurable additional unplanned-absence deduction (effective-dated, approval-gated, modelled on statutory_config_version). NOT wired into payrollCalculate.service.ts and NOT activated; with no approved row ever inserted, backend/src/shared/absencePenaltyConfig.ts's read helper always returns 0. Part of the 2026-08-13 leave-module audit (policy sign-off, "future configurable unplanned-absence penalty").
  "1202_week_off_policy_default.sql", // CREATE TABLE IF NOT EXISTS only, no existing table/column touched — the process/branch/org-default tier (tier 3-5) of the week-off resolution hierarchy roster-generation.service.ts now consults when neither an approved week_off_preference (tier 1) nor a process roster_template pattern (tier 2) resolves an employee's week-off day. Empty table, no seed row at any scope — the business decision is explicit that this must never default to Sunday, so an unconfigured scope stays unconfigured rather than substituting a guess; roster.governance.service's advanceCycleStatus() now blocks a cycle's publish transition when a generation run recorded any employee for which no tier resolved anything (WEEK_OFF_POLICY_MISSING). Part A.1 of the 2026-08-13 roster enterprise-controls program.
  "1141_payroll_bank_exception.sql", // CREATE TABLE IF NOT EXISTS only — the workflow overlay behind the new Bank Payment Readiness page (/payroll/bank-readiness): who owns each bank exception, its workflow status and notes. Deliberately stores NO readiness class and NO account number: the classification is recomputed live on every request by bank-payment-readiness.service.ts, because a stored snapshot would keep asserting MISSING after HR fixed the record — the same both-directions-wrong failure salary_prep_run.total_employees already has here. COLLATE=utf8mb4_unicode_ci is explicit, not decorative: employees.id is utf8mb4_unicode_ci while the server default is utf8mb4_0900_ai_ci, so an unqualified CREATE TABLE yields a table whose first join to employees dies with errno 3780. UNIQUE KEY on employee_id is load-bearing — the PATCH endpoint is an INSERT ... ON DUPLICATE KEY UPDATE keyed on it and would otherwise append a row per edit. Verified by replaying the exact DDL as a TEMPORARY table against production 8.0.42, including the ON DUPLICATE KEY path and the join to employees and auth_user. Additive and idempotent.
  "1142_payroll_bank_readiness_page_access.sql",
  "1200_shift_versioning.sql", // adds wfm_shift_master.version / parent_shift_id / effective_from / effective_to / is_locked / created_by, the effective-dated shift lineage. NOT optional: wfm.service.ts INSERTs all six by name (the versioned-shift INSERT around line 245) and SELECTs is_locked in its lock guard, and NONE of the six exists on production - verified live 2026-08-13, information_schema returns 0 for every one. So every call down that path throws ER_BAD_FIELD_ERROR today. It was in knownUnlisted, i.e. declared never-to-run, which turned a loud manifest-guard failure into a silent runtime one. Idempotent by construction: 13 information_schema guards driving PREPARE/EXECUTE (the header explains it deliberately avoids ADD COLUMN IF NOT EXISTS, which this MySQL 8.0.42 rejects at the token - the 1006 failure mode). Its only DROP is `ALTER TABLE wfm_shift_master DROP INDEX shift_code` guarded on that index existing, replacing the unqualified unique key with the versioned one; no data is dropped
  "1201_shift_versioning_backfill.sql", // backfills version = 1 and effective_from for the shift rows that predate 1200. Must follow 1200 and does: UPDATE-only, no DDL, no DROP, no DELETE. Re-running rewrites the same values, so it is idempotent in effect
  "1210_minimum_rest_policy.sql", // creates wfm_rest_override_log and the minimum-rest policy config that rest-policy.service.ts reads. The TABLE already exists on production (applied out of band, no schema_migrations row), so listing it here is for every other environment and for a rebuilt database, where the service would otherwise hit ER_NO_SUCH_TABLE. CREATE TABLE IF NOT EXISTS plus information_schema-guarded ALTERs; no DROP or DELETE at all
  "1212_roster_swap_lifecycle.sql", // creates wfm_roster_swap_request and its lifecycle columns, which wfm-ext.service.ts reads and writes (before_state_json, after_state_json, applied_at, requester_assignment_id, target_assignment_id, rest_override_used). Table exists on production out of band; unlisted it would never reach any other environment. 10 information_schema guards driving 9 PREPARE/EXECUTE blocks, no DROP, no DELETE. NOTE the filename collision: 1212_payslip_email_tracking_and_missing_indexes.sql is a DIFFERENT file from a different session, also listed - the manifest keys on the full filename so both coexist, but do not assume a number identifies a migration here
  // 1213_wfm_shift_master_immutability_trigger.sql — REMOVED FROM MANIFEST (moved to knownUnlisted).
  // Requires MySQL SUPER privilege or log_bin_trust_function_creators=1 to create a trigger with
  // binary logging enabled — neither is available on the production host (maslms user). Running it
  // causes a hard startup failure that takes the whole server down. The trigger enforces that locked
  // shift versions cannot be edited in place; the application-layer lock guard in wfm.service.ts
  // provides the same protection without a DB trigger. Re-schedule only after confirming the production
  // MySQL user has the required privilege or log_bin_trust_function_creators=ON.
  "460_budget_line_tax_amendment.sql", // CREATE TABLE IF NOT EXISTS finance_budget_line_tax_amendment — maker-checker audit trail for governed tax-treatment corrections on active budget lines. Shipped in 737a0a42 with its code (requestTaxAmendment/reviewTaxAmendment in branch-budget.service.ts) but never scheduled; without it every tax-amendment API call fails with ER_NO_SUCH_TABLE. COLLATE=utf8mb4_unicode_ci explicit (3f15543d): FK to finance_budget_header(id) is utf8mb4_unicode_ci. Placed LAST: its FK requires finance_budget_header to exist, which is created later in a rebuilt database. CREATE TABLE IF NOT EXISTS — safe to re-run.
  "440_finance_phase1.sql", // Finance Phase 1 - TDS on payments, HSN/SAC, advance payments and debit notes. Shipped in c4c5d8f8 with its code but never scheduled, and it is in neither the manifest nor knownUnlisted, so migration-manifest-guard.test.ts has been failing on it: the runner never executes it, and grn.routes.ts reads vendor_debit_note, which therefore does not exist in mas_hrms at all. Deliberately placed LAST rather than at its numeric position. Its four guards ALTER vendor_payment_transaction (created by 413), vendor_payment_tracking (310), grn_invoice_component (1074) and grn_period_allocation (1099); a guard that finds the column absent fires the ALTER, so running this at position 440 would hit ER_NO_SUCH_TABLE on a rebuilt database for the two tables created later, and the split_method guard would silently no-op because @sm_type comes back NULL. Additive and idempotent by construction: three CREATE TABLE IF NOT EXISTS, each with explicit COLLATE=utf8mb4_unicode_ci and no foreign keys, and four information_schema-guarded ALTERs. Note it rewrites grn_period_allocation.split_method from enum('equal','by_days','manual') to enum('equal','custom','manual'), dropping by_days - that value appears nowhere in backend or frontend and the table holds 0 rows, while 'custom' is what grn-period-allocation.service.ts writes and the live enum rejects under STRICT_TRANS_TABLES. Verified by executing the whole file twice against a scratch schema holding real copies of all four dependency tables on production 8.0.42: 23 statements, clean on pass 1, no-op on pass 2, and a debit note inserts successfully afterwards.
  "441_finance_phases_2_3_4.sql", // Finance Phases 2-4 - budget transfer/virement, capex-opex classification, per-line alert threshold, IRN on GRN, and provision/accrual GRNs. Shipped with its code but never scheduled, so it sat in neither the manifest nor knownUnlisted: migration-manifest-guard.test.ts failed on it, and branch-budget.service.ts writes finance_budget_transfer and finance_budget_line.expenditure_type / alert_threshold_pct, none of which existed in mas_hrms. Placed LAST, after 440, for the same reason 440 is: it ALTERs finance_budget_line and grn_request, and running it at its numeric position would precede their creation on a rebuilt database. Additive and idempotent by construction: one CREATE TABLE IF NOT EXISTS with explicit COLLATE=utf8mb4_unicode_ci and no foreign keys, plus five information_schema-guarded ALTERs. The one statement that is not purely additive is the grn_type enum rewrite to (vendor, imprest, provision); verified read-only against production 2026-08-12 that the live type is exactly enum(vendor, imprest) and all 4 grn_request rows are vendor, so 0 rows lose a value.
  ];

export type MigrationHealth = {
  status: "not_started" | "running" | "ok" | "failed";
  applied: string[];
  skipped: string[];
  failed: Array<{ filename: string; error: string }>;
  startedAt: string | null;
  completedAt: string | null;
};

let migrationHealth: MigrationHealth = {
  status: "not_started",
  applied: [],
  skipped: [],
  failed: [],
  startedAt: null,
  completedAt: null,
};

export function getMigrationHealth(): MigrationHealth {
  return {
    ...migrationHealth,
    applied: [...migrationHealth.applied],
    skipped: [...migrationHealth.skipped],
    failed: migrationHealth.failed.map((item) => ({ ...item })),
  };
}

function isIdempotentMigrationError(error: unknown): boolean {
  const dbError = error as { code?: string; errno?: number; message?: string } | null | undefined;
  const code = dbError?.code;
  const errno = Number(dbError?.errno ?? 0);
  const msg = String(dbError?.message ?? "").toLowerCase();
  // A gate-3 assertion failure is never idempotent-benign: it means the schema is absent, which
  // is the opposite of "already there". Excluded explicitly rather than relying on its wording
  // dodging the message-based fallbacks below — those match substrings like "already exists",
  // and an assertion message is free text that a later edit could easily walk into.
  if (code === "SCHEMA_ASSERTION_FAILED") return false;
  return (
    // Named codes (mysql2 preferred)
    code === "ER_TABLE_EXISTS_ERROR" ||   // 1050
    code === "ER_DUP_FIELDNAME" ||        // 1060
    code === "ER_DUP_KEYNAME" ||          // 1061
    code === "ER_CANT_DROP_FIELD_OR_KEY" ||// 1091
    // Numeric codes as fallback (in case mysql2 version differs)
    errno === 1050 ||  // table already exists
    errno === 1060 ||  // duplicate column name
    errno === 1061 ||  // duplicate key name
    errno === 1091 ||  // can't drop non-existent field/key
    // Message-based fallback
    msg.includes("duplicate column") ||
    msg.includes("already exists") ||
    msg.includes("duplicate key") ||
    msg.includes("can't drop")
  );
}

/**
 * Compute SHA-256 hash of file content for checksum tracking.
 */
function computeFileChecksum(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Acquire MySQL advisory lock for migration exclusivity.
 * Only one process can hold 'hrms_migration_lock' at a time.
 * Returns true if lock acquired, false if timeout.
 */
async function acquireMigrationLock(conn: mysql.Connection): Promise<boolean> {
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT GET_LOCK('hrms_migration_lock', ?) AS acquired`,
      [MIGRATION_LOCK_TIMEOUT_SECONDS]
    );
    const acquired = (rows[0] as { acquired: number | null })?.acquired === 1;
    if (acquired) {
      console.log(`[migration] advisory lock acquired by ${os.hostname()} (pid: ${process.pid})`);
    }
    return acquired;
  } catch (error) {
    console.error("[migration] failed to acquire advisory lock:", error);
    return false;
  }
}

/**
 * Release MySQL advisory lock after migrations complete.
 */
async function releaseMigrationLock(conn: mysql.Connection): Promise<void> {
  try {
    await conn.query(`SELECT RELEASE_LOCK('hrms_migration_lock')`);
    console.log("[migration] advisory lock released");
  } catch (error) {
    console.error("[migration] failed to release advisory lock:", error);
  }
}

/**
 * Check if a previously applied migration has a different checksum.
 * Returns null if no checksum recorded, the stored checksum otherwise.
 */
async function getStoredChecksum(
  conn: mysql.Connection,
  filename: string
): Promise<string | null> {
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT checksum_sha256 FROM schema_migrations WHERE filename = ?`,
      [filename]
    );
    if (rows.length === 0) return null;
    return (rows[0] as { checksum_sha256: string | null }).checksum_sha256;
  } catch {
    return null;
  }
}

/**
 * Pre-process SQL from a MySQL CLI file:
 * Strips DELIMITER directives and replaces the custom delimiter (// or $$)
 * with the standard semicolon so that splitSql can handle the file normally.
 * mysql2/promise does not understand DELIMITER — it is a CLI-only command.
 */
function normaliseDelimiters(raw: string): string {
  // Match: DELIMITER <delim> ... DELIMITER ; blocks
  // Replaces custom delimiters (e.g. // or $$) with ; and removes DELIMITER lines.
  return raw.replace(
    /DELIMITER\s+(\S+)([\s\S]*?)DELIMITER\s*;/gi,
    (_match, delim: string, body: string) => {
      // Escape the custom delimiter for use in a regex
      const escaped = delim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Replace all occurrences of the custom delimiter with ;
      return body.replace(new RegExp(escaped, "g"), ";");
    }
  );
}

/**
 * Safe SQL splitter that respects:
 *  - single-quoted strings (with '' and \' escapes)
 *  - double-quoted identifiers (with "" and \" escapes)
 *  - backtick-quoted identifiers (with `` escapes)
 *  - line comments (-- ...)
 *  - block comments (/* ... *\/)
 *  - DELIMITER directives (pre-processed by normaliseDelimiters)
 *  - BEGIN...END compound statement nesting (stored procedures / functions)
 *    Semicolons inside a BEGIN...END body are NOT statement terminators.
 *    END IF / END LOOP / END WHILE / END CASE / END REPEAT do NOT close
 *    the compound block; only a bare END does.
 *
 * Returns non-empty, trimmed statement strings.
 */
export function splitSql(raw: string): string[] {
  raw = normaliseDelimiters(raw);
  const statements: string[] = [];
  let current = "";
  let i = 0;
  const len = raw.length;
  let beginDepth = 0; // tracks BEGIN...END nesting depth

  const isWordChar = (c: string | undefined): boolean =>
    c !== undefined && /\w/.test(c);

  while (i < len) {
    const ch = raw[i];

    // Line comment: consume to end of line (do not add to current)
    if (ch === "-" && raw[i + 1] === "-") {
      while (i < len && raw[i] !== "\n") i++;
      continue;
    }

    // Block comment: consume until */ (do not add to current)
    if (ch === "/" && raw[i + 1] === "*") {
      i += 2;
      while (i < len) {
        if (raw[i] === "*" && raw[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    // Quoted string/identifier: copy verbatim including the closing quote
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      const doubleEscape = quote; // '' inside '' means literal quote
      current += ch;
      i++;
      while (i < len) {
        const c = raw[i];
        if (c === "\\" && (quote === "'" || quote === '"')) {
          // backslash escape: consume both chars
          current += raw[i] + (raw[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (c === quote) {
          current += c;
          i++;
          // doubled quote inside same-quote string = escaped literal
          if (raw[i] === doubleEscape) {
            current += raw[i];
            i++;
            continue;
          }
          break; // closing quote
        }
        current += c;
        i++;
      }
      continue;
    }

    // Keyword detection at a word boundary (not mid-identifier)
    const prevIsWord = i > 0 && isWordChar(raw[i - 1]);
    if (!prevIsWord && /[A-Za-z_]/.test(ch)) {
      // Read the full identifier/keyword
      let j = i;
      while (j < len && isWordChar(raw[j])) j++;
      const word = raw.slice(i, j).toUpperCase();

      if (word === "BEGIN") {
        beginDepth++;
        current += raw.slice(i, j);
        i = j;
        continue;
      }

      if (word === "END") {
        // Peek past whitespace to find the next word
        let k = j;
        while (k < len && (raw[k] === " " || raw[k] === "\t" || raw[k] === "\r" || raw[k] === "\n")) k++;
        let m = k;
        while (m < len && isWordChar(raw[m])) m++;
        const followWord = raw.slice(k, m).toUpperCase();
        // END IF / END LOOP / END WHILE / END CASE / END REPEAT are
        // control-flow terminators — they do NOT close a BEGIN...END block
        const isControlEnd =
          followWord === "IF" ||
          followWord === "LOOP" ||
          followWord === "WHILE" ||
          followWord === "CASE" ||
          followWord === "REPEAT";
        if (!isControlEnd && beginDepth > 0) {
          beginDepth--;
        }
        current += raw.slice(i, j);
        i = j;
        continue;
      }

      // Any other identifier: add in full and advance
      current += raw.slice(i, j);
      i = j;
      continue;
    }

    // Statement terminator: only split when outside a BEGIN...END block
    if (ch === ";") {
      if (beginDepth === 0) {
        const stmt = current.trim();
        if (stmt) statements.push(stmt);
        current = "";
      } else {
        current += ch;
      }
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  // Trailing statement without terminator
  const tail = current.trim();
  if (tail) statements.push(tail);

  return statements;
}

/**
 * Ensures the target database exists before the pooled connection (which
 * requires the DB name) is used. Uses a temporary no-database connection.
 */
async function ensureDatabaseExists(
  host: string,
  port: number,
  user: string,
  password: string,
  dbName: string
): Promise<void> {
  const conn = await mysql.createConnection({ host, port, user, password });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(
      `ALTER DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`[migration] database '${dbName}' ensured`);
  } finally {
    await conn.end();
  }
}

/**
 * Run a single SQL file on a dedicated connection (text-protocol query, not
 * prepared-statement execute) so that:
 *  - DDL works (CREATE TABLE, ALTER TABLE, etc.)
 *  - Session variables (@var) persist across statements within the file
 *  - PREPARE / EXECUTE / DEALLOCATE blocks work correctly
 *
 * USE and SOURCE directives are silently skipped (they are MySQL CLI artefacts).
 */
async function runFileOnConnection(
  conn: mysql.Connection,
  filePath: string
): Promise<void> {
  const rawSql = fs.readFileSync(filePath, "utf8");
  const statements = splitSql(rawSql).filter((stmt) => {
    const upper = stmt.toUpperCase();
    return !upper.startsWith("SOURCE ") && !upper.startsWith("USE ");
  });

  /*
   * An idempotent error is tolerated per statement, not per file.
   *
   * This loop used to let any throw propagate, and the caller then classified the whole file as
   * "idempotent - already exists" and moved on. So one benign duplicate silently discarded every
   * statement after it, while schema_migrations still reported the file applied.
   *
   * 509_portal_client_master_fixes.sql is what that looks like. It guards an ALTER on a single
   * column - COUNT(*) ... COLUMN_NAME='phone' - but the ALTER adds eleven columns and an index in
   * one statement, and access_level already existed on client_user. A multi-ADD ALTER is
   * all-or-nothing, so it failed with ER_DUP_FIELDNAME, which is on the idempotent list. The file
   * stopped there: the ten other columns were never added and the three CREATE TABLE statements
   * after it never ran, one of which the portal's KPI Assignments tab needs. schema_migrations
   * has recorded it applied since 2026-07-19.
   *
   * Continuing is the conservative choice, not the risky one. Every statement here is one the
   * manifest already intends to run; the previous behaviour ran an arbitrary prefix of them
   * decided by whichever duplicate happened to come first. A genuine error - a bad column, a
   * missing table, a syntax error - is not on the idempotent list and still aborts the file.
   */
  for (const [index, stmt] of statements.entries()) {
    try {
      await conn.query(stmt);
    } catch (error) {
      if (!isIdempotentMigrationError(error)) throw error;
      const code = (error as { code?: string }).code ?? "idempotent";
      console.warn(
        `[migration] ${path.basename(filePath)}: statement ${index + 1}/${statements.length} ` +
        `already applied (${code}); continuing with the rest of the file`
      );
    }
  }
}

/**
 * ─── Gate 3: the schema a migration declares must actually exist afterwards ───
 *
 * Three things are independent, and this codebase fails all three in different places:
 *
 *   1. the runner did not throw          -> schema_migrations.success = 1
 *   2. the file's DDL is executable here -> MySQL 8 accepts it
 *   3. the declared schema exists        -> nothing checked this until now
 *
 * Gate 1 has never implied gate 3. Measured on production 2026-08-13: eight manifest files are
 * recorded success = 1 while 40 of the columns they declare do not exist. 398, 402 and 404 are
 * the reachable ones — payslip_emailed breaks two mounted endpoints and incentives_applied_at
 * disables the guard against wiping applied incentives on recalculate. All three were written
 * `ADD COLUMN IF NOT EXISTS`, MariaDB syntax MySQL 8.0.42 rejects with ER_PARSE_ERROR, and were
 * recorded applied anyway because at the time the parse error was classified at file level.
 *
 * A file that fails this check is recorded success = 0, which keeps it OUT of appliedMap
 * (buildSchemaMigrationsAppliedRowsQuery filters `success = 1 OR success IS NULL`), so it is
 * retried on the next boot rather than being remembered as done. That is the self-healing half of
 * failing closed.
 *
 * WHY THE PARSER IS DELIBERATELY TIMID
 *
 * A false positive here blocks production startup, because a failed migration halts the chain.
 * So this asserts only what it can read unambiguously and stays silent otherwise — silence costs
 * a missed assertion, a wrong assertion costs an outage. Specifically it skips:
 *
 *   · any file containing DROP / RENAME / CHANGE COLUMN — the file's net intent is not
 *     decidable from a forward scan, and a migration that legitimately drops a column must not
 *     then be told the column is missing
 *   · TEMPORARY tables, which are session-scoped and gone by the time we look
 *   · anything schema-qualified (`db_masmis.foo`) — another database this account may not see;
 *     that exact case produced the only false positives in the 2026-08-13 sweep
 *   · DDL built inside PREPARE string literals, which it cannot see into. Those files are the
 *     well-written ones; they are simply not covered.
 */
const SCHEMA_ASSERTION_UNSAFE = /\b(DROP\s+(TABLE|COLUMN|INDEX)|RENAME\s+(TABLE|COLUMN)|CHANGE\s+COLUMN)\b/i;

export interface DeclaredSchema {
  tables: string[];
  columns: Array<{ table: string; column: string }>;
  skipped: boolean;
}

/** Strip comments and string literals so DDL keywords inside them are not mistaken for statements. */
function stripNoise(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ")
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
}

export function parseDeclaredSchema(rawSql: string): DeclaredSchema {
  const sql = stripNoise(rawSql);
  if (SCHEMA_ASSERTION_UNSAFE.test(sql)) return { tables: [], columns: [], skipped: true };

  const tables: string[] = [];
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?(\s*\.)?/gi)) {
    if (m[1]) continue;            // TEMPORARY — gone before we could look
    if (m[3]) continue;            // schema-qualified — another database
    tables.push(m[2].toLowerCase());
  }

  const columns: Array<{ table: string; column: string }> = [];
  for (const alter of sql.matchAll(/ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?(\s*\.)?([\s\S]*?);/gi)) {
    if (alter[2]) continue;        // schema-qualified
    const table = alter[1].toLowerCase();
    for (const c of alter[3].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi)) {
      columns.push({ table, column: c[1].toLowerCase() });
    }
  }

  return { tables: [...new Set(tables)], columns, skipped: false };
}

/**
 * Returns the declared objects that are absent from the database. Empty means the assertion holds.
 *
 * A column on a table that is itself missing is reported as the table only — one cause, one line,
 * rather than a wall of columns all saying the same thing.
 */
export async function findMissingDeclaredSchema(
  conn: mysql.Connection,
  declared: DeclaredSchema
): Promise<string[]> {
  if (declared.skipped) return [];
  if (declared.tables.length === 0 && declared.columns.length === 0) return [];

  const missing: string[] = [];
  const wantedTables = new Set<string>([...declared.tables, ...declared.columns.map((c) => c.table)]);

  const [tableRows] = await conn.query<RowDataPacket[]>(
    `SELECT LOWER(table_name) AS t FROM information_schema.tables
      WHERE table_schema = DATABASE() AND LOWER(table_name) IN (${[...wantedTables].map(() => "?").join(",")})`,
    [...wantedTables]
  );
  const haveTables = new Set((tableRows as Array<{ t: string }>).map((r) => r.t));

  for (const t of declared.tables) if (!haveTables.has(t)) missing.push(`table ${t}`);

  const checkable = declared.columns.filter((c) => haveTables.has(c.table));
  for (const c of declared.columns) {
    if (!haveTables.has(c.table) && !missing.includes(`table ${c.table}`)) missing.push(`table ${c.table}`);
  }
  if (checkable.length > 0) {
    const [colRows] = await conn.query<RowDataPacket[]>(
      `SELECT LOWER(table_name) AS t, LOWER(column_name) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND LOWER(table_name) IN (${[...new Set(checkable.map((c) => c.table))].map(() => "?").join(",")})`,
      [...new Set(checkable.map((c) => c.table))]
    );
    const haveCols = new Set((colRows as Array<{ t: string; c: string }>).map((r) => `${r.t}.${r.c}`));
    for (const c of checkable) {
      if (!haveCols.has(`${c.table}.${c.column}`)) missing.push(`column ${c.table}.${c.column}`);
    }
  }

  return missing;
}

/**
 * Runs pending SQL migrations in manifest order and records a health summary.
 *
 * GOVERNANCE FEATURES:
 * - MySQL advisory lock prevents concurrent migrations across instances
 * - Checksum tracking detects modified migration files
 * - MIGRATION_STRICT_MODE=true: missing files block execution (not skip)
 * - STOP_ON_FIRST_FAILURE (default true): halts chain after first hard error
 * - Each migration records start_time, end_time, duration_ms, checksum, executor
 *
 * - Uses MIGRATION_MANIFEST (derived from 000_run_all.sql) instead of directory scan.
 * - Each migration file runs on a dedicated single connection (for session variable support).
 * - Safe SQL splitter avoids false splits on semicolons inside string literals.
 * - Runs 043_demo_data.sql only when SEED_DEMO_DATA=true.
 * - Production startup is blocked when any migration fails.
 */
export async function runPendingMigrations(): Promise<MigrationHealth> {
  if (process.env.SKIP_MIGRATIONS === 'true') {
    migrationHealth = { status: "ok", applied: [], skipped: [], failed: [], startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
    return migrationHealth;
  }

  migrationHealth = {
    status: "running",
    applied: [],
    skipped: [],
    failed: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
  };

  const connConfig = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: false,
  };

  // Connection for advisory lock (kept open throughout migration run)
  let lockConn: mysql.Connection | null = null;

  try {
    await ensureDatabaseExists(
      env.DB_HOST,
      env.DB_PORT,
      env.DB_USER,
      env.DB_PASSWORD,
      env.DB_NAME
    );

    // Ensure schema_migrations tracking table exists with governance columns
    let schemaMigrationsCapabilities: SchemaMigrationsCapabilities;
    {
      const conn = await mysql.createConnection(connConfig);
      try {
        await conn.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            filename        VARCHAR(255) NOT NULL PRIMARY KEY,
            applied_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            checksum_sha256 VARCHAR(64)  NULL,
            environment     VARCHAR(50)  NULL,
            start_time      DATETIME     NULL,
            end_time        DATETIME     NULL,
            duration_ms     INT          NULL,
            executor        VARCHAR(255) NULL,
            success         TINYINT(1)   NOT NULL DEFAULT 1,
            error_message   TEXT         NULL
          )
        `);
        // Add governance columns if missing (for existing tables)
        await conn.query(`
          ALTER TABLE schema_migrations
          ADD COLUMN IF NOT EXISTS checksum_sha256 VARCHAR(64) NULL,
          ADD COLUMN IF NOT EXISTS environment VARCHAR(50) NULL,
          ADD COLUMN IF NOT EXISTS start_time DATETIME NULL,
          ADD COLUMN IF NOT EXISTS end_time DATETIME NULL,
          ADD COLUMN IF NOT EXISTS duration_ms INT NULL,
          ADD COLUMN IF NOT EXISTS executor VARCHAR(255) NULL,
          ADD COLUMN IF NOT EXISTS success TINYINT(1) NOT NULL DEFAULT 1,
          ADD COLUMN IF NOT EXISTS error_message TEXT NULL
        `).catch(() => {
          // MariaDB/older MySQL may not support ADD COLUMN IF NOT EXISTS
        });
        schemaMigrationsCapabilities = await getSchemaMigrationsCapabilities(conn, env.DB_NAME);
      } finally {
        await conn.end();
      }
    }

    // GOVERNANCE: Acquire advisory lock before running any migrations
    lockConn = await mysql.createConnection(connConfig);
    const lockAcquired = await acquireMigrationLock(lockConn);
    if (!lockAcquired) {
      throw new Error(
        `Could not acquire migration lock within ${MIGRATION_LOCK_TIMEOUT_SECONDS}s. ` +
        `Another migration may be running. Use SKIP_MIGRATIONS=true to bypass.`
      );
    }

    // Read the set of already-applied migrations with checksums
    const appliedMap = new Map<string, string | null>(); // filename -> checksum
    {
      const conn = await mysql.createConnection(connConfig);
      try {
        const [rows] = await conn.query<RowDataPacket[]>(
          buildSchemaMigrationsAppliedRowsQuery(schemaMigrationsCapabilities!)
        );
        for (const row of rows as RowDataPacket[]) {
          appliedMap.set(String(row.filename), row.checksum_sha256 ?? null);
        }
      } finally {
        await conn.end();
      }
    }

    // Build the effective file list: manifest + optional demo seed
    const files: string[] = [...MIGRATION_MANIFEST];
    if (env.SEED_DEMO_DATA) {
      const idx = files.indexOf("050_auth_mysql.sql");
      files.splice(idx + 1, 0, "043_demo_data.sql");
    }

    const executor = `${os.hostname()}:${process.pid}`;
    const environment = env.NODE_ENV || "development";

    for (const file of files) {
      // GOVERNANCE: Stop if we've already hit a failure and STOP_ON_FIRST_FAILURE is enabled
      if (STOP_ON_FIRST_FAILURE && migrationHealth.failed.length > 0) {
        console.warn(`[migration] stopping due to previous failure (STOP_ON_FIRST_FAILURE=true)`);
        break;
      }

      const filePath = path.join(SQL_DIR, file);

      // GOVERNANCE: In strict mode, missing files are fatal
      if (!fs.existsSync(filePath)) {
        if (MIGRATION_STRICT_MODE) {
          const message = `Missing migration file: ${file} (MIGRATION_STRICT_MODE=true)`;
          migrationHealth.failed.push({ filename: file, error: message });
          console.error(`[migration] FATAL: ${message}`);
          break;
        }
        console.warn(`[migration] skipping missing file: ${file}`);
        migrationHealth.skipped.push(file);
        continue;
      }

      // Compute checksum for this file
      const currentChecksum = computeFileChecksum(filePath);

      // GOVERNANCE: Check for modified migrations
      if (appliedMap.has(file)) {
        const storedChecksum = appliedMap.get(file);
        if (storedChecksum && storedChecksum !== currentChecksum) {
          if (MIGRATION_STRICT_MODE) {
            const message = `Checksum mismatch for ${file}: stored=${storedChecksum.slice(0,8)}... current=${currentChecksum.slice(0,8)}... (MIGRATION_STRICT_MODE=true)`;
            migrationHealth.failed.push({ filename: file, error: message });
            console.error(`[migration] FATAL: ${message}`);
            break;
          }
          console.warn(`[migration] checksum mismatch for already-applied ${file} (stored checksum differs from current file)`);
        }
        migrationHealth.skipped.push(file);
        continue;
      }

      // Each file gets its own dedicated connection for session-variable isolation
      const startTime = new Date();
      const conn = await mysql.createConnection(connConfig);
      try {
        await runFileOnConnection(conn, filePath);

        // GATE 3: the file ran without throwing — now prove it actually left the schema it
        // declares. Recorded-successful has never implied schema-present; see
        // parseDeclaredSchema for the eight production files where it did not.
        const declared = parseDeclaredSchema(fs.readFileSync(filePath, "utf8"));
        const missing = await findMissingDeclaredSchema(conn, declared);
        if (missing.length > 0) {
          throw Object.assign(
            new Error(
              `SCHEMA_ASSERTION_FAILED: ${file} ran without error but the schema it declares is ` +
              `not present: ${missing.join(", ")}. Recorded success = 0 so it is retried rather ` +
              `than remembered as applied. A migration whose DDL MySQL silently would not apply ` +
              `(e.g. MariaDB's ADD COLUMN IF NOT EXISTS) reaches exactly this state.`
            ),
            { code: "SCHEMA_ASSERTION_FAILED" }
          );
        }

        const endTime = new Date();
        const durationMs = endTime.getTime() - startTime.getTime();

        // Record as applied with governance metadata
        await conn.query(
          buildSchemaMigrationsInsertStatement(schemaMigrationsCapabilities!, { success: true }),
          buildSchemaMigrationsInsertParams(
            schemaMigrationsCapabilities!,
            {
              filename: file,
              checksumSha256: currentChecksum,
              environment,
              startTime,
              endTime,
              durationMs,
              executor,
            },
            { success: true }
          )
        );
        migrationHealth.applied.push(file);
        console.log(`[migration] applied: ${file} (${durationMs}ms)`);
      } catch (error: unknown) {
        // GOVERNANCE: Never mark a migration as success=1 on ANY error.
        // Even for idempotent errors (table already exists), we skip the file
        // but do NOT record it as successfully applied. The admin must verify
        // schema state and explicitly mark as complete if needed.
        if (isIdempotentMigrationError(error)) {
          migrationHealth.skipped.push(file);
          console.log(`[migration] skipped (idempotent - already exists): ${file}`);
        } else {
          const endTime = new Date();
          const durationMs = endTime.getTime() - startTime.getTime();
          const message = error instanceof Error ? error.message : String(error);
          // Record failed migration attempt
          const conn2 = await mysql.createConnection(connConfig);
          try {
            await conn2.query(
              buildSchemaMigrationsInsertStatement(schemaMigrationsCapabilities!, { success: false }),
              buildSchemaMigrationsInsertParams(
                schemaMigrationsCapabilities!,
                {
                  filename: file,
                  checksumSha256: currentChecksum,
                  environment,
                  startTime,
                  endTime,
                  durationMs,
                  executor,
                  errorMessage: message,
                },
                { success: false }
              )
            );
          } finally {
            await conn2.end();
          }
          migrationHealth.failed.push({ filename: file, error: message });
          console.error(`[migration] FAILED: ${file} — ${message}`);
        }
      } finally {
        await conn.end();
      }
    }
  } catch (error: unknown) {
    migrationHealth.failed.push({
      filename: "migration-runner",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // GOVERNANCE: Always release advisory lock
    if (lockConn) {
      await releaseMigrationLock(lockConn);
      await lockConn.end();
    }
  }

  migrationHealth.completedAt = new Date().toISOString();
  migrationHealth.status = migrationHealth.failed.length > 0 ? "failed" : "ok";

  if (migrationHealth.failed.length > 0 && env.NODE_ENV === "production") {
    const names = migrationHealth.failed.map((item) => item.filename).join(", ");
    throw new Error(`Production startup blocked because migrations failed: ${names}`);
  }

  return getMigrationHealth();
}

// Schema verification state tracking
export type SchemaVerificationState = {
  state: "unverified" | "verifying" | "verified" | "incompatible" | "error";
  appliedCount: number;
  pendingCount: number;
  pendingFiles: string[];
  lastCheckedAt: string | null;
  valid: boolean;
};

const verificationState: SchemaVerificationState = {
  state: "unverified",
  appliedCount: 0,
  pendingCount: 0,
  pendingFiles: [],
  lastCheckedAt: null,
  valid: false,
};

export function buildSchemaMigrationsAppliedQuery(hasSuccessColumn: boolean): string {
  return hasSuccessColumn
    ? "SELECT filename FROM schema_migrations WHERE success = 1 OR success IS NULL"
    : "SELECT filename FROM schema_migrations";
}

type SchemaMigrationsCapabilities = {
  hasChecksumSha256: boolean;
  hasEnvironment: boolean;
  hasStartTime: boolean;
  hasEndTime: boolean;
  hasDurationMs: boolean;
  hasExecutor: boolean;
  hasSuccess: boolean;
  hasErrorMessage: boolean;
};

async function getSchemaMigrationsCapabilities(
  conn: mysql.Connection,
  dbName: string
): Promise<SchemaMigrationsCapabilities> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'schema_migrations'`,
    [dbName]
  );

  const columnSet = new Set(
    (rows as Array<{ COLUMN_NAME?: string | null }>).map((row) => String(row.COLUMN_NAME ?? ""))
  );

  return {
    hasChecksumSha256: columnSet.has("checksum_sha256"),
    hasEnvironment: columnSet.has("environment"),
    hasStartTime: columnSet.has("start_time"),
    hasEndTime: columnSet.has("end_time"),
    hasDurationMs: columnSet.has("duration_ms"),
    hasExecutor: columnSet.has("executor"),
    hasSuccess: columnSet.has("success"),
    hasErrorMessage: columnSet.has("error_message"),
  };
}

export function buildSchemaMigrationsAppliedRowsQuery(
  capabilities: Pick<SchemaMigrationsCapabilities, "hasChecksumSha256" | "hasSuccess">
): string {
  const checksumSelect = capabilities.hasChecksumSha256
    ? "checksum_sha256"
    : "NULL AS checksum_sha256";
  const successWhere = capabilities.hasSuccess
    ? " WHERE success = 1 OR success IS NULL"
    : "";
  return `SELECT filename, ${checksumSelect} FROM schema_migrations${successWhere}`;
}

export function buildSchemaMigrationsInsertStatement(
  capabilities: SchemaMigrationsCapabilities,
  options: { success: boolean }
): string {
  const columns = ["filename"];
  const values = ["?"];
  const updates: string[] = [];

  if (capabilities.hasChecksumSha256) {
    columns.push("checksum_sha256");
    values.push("?");
  }
  if (capabilities.hasEnvironment) {
    columns.push("environment");
    values.push("?");
  }
  if (capabilities.hasStartTime) {
    columns.push("start_time");
    values.push("?");
  }
  if (capabilities.hasEndTime) {
    columns.push("end_time");
    values.push("?");
    updates.push("end_time = VALUES(end_time)");
  }
  if (capabilities.hasDurationMs) {
    columns.push("duration_ms");
    values.push("?");
  }
  if (capabilities.hasExecutor) {
    columns.push("executor");
    values.push("?");
  }
  if (capabilities.hasSuccess) {
    columns.push("success");
    values.push(options.success ? "1" : "0");
    if (!options.success) updates.push("success = 0");
  }
  if (!options.success && capabilities.hasErrorMessage) {
    columns.push("error_message");
    values.push("?");
    updates.push("error_message = VALUES(error_message)");
  }

  const sql = `INSERT INTO schema_migrations (${columns.join(", ")}) VALUES (${values.join(", ")})`;

  // A SUCCESS must be recordable over a previous FAILURE, for exactly the reason the failure
  // branch below documents — and this half was missed when that one was fixed, which turned the
  // bug into its mirror image and made it permanent instead of merely repeatable.
  //
  // What happened on production 2026-08-13, to 1006_payroll_process_readiness_extend.sql:
  //   1. It failed once and left a success = 0 row.
  //   2. On the next boot its SQL ran again and SUCCEEDED — it is idempotent, and every column
  //      and index it adds was verifiably already present on the live table.
  //   3. This function then returned a bare INSERT to record that success, which collided with
  //      the row from step 1: "Duplicate entry ... for key 'schema_migrations.PRIMARY'".
  //   4. The runner caught that and reported it as THE MIGRATION failing — so the error attached
  //      to the migration names a primary key it never touches, which is why it reads as a
  //      corrupt migration rather than a bookkeeping bug, and why rewriting the migration (the
  //      obvious response) cannot possibly help.
  //   5. The failure path, which does upsert, rewrote success = 0. Back to step 2, forever.
  //
  // With STOP_ON_FIRST_FAILURE that poisoned row blocked all 7 migrations queued behind it, and
  // renaming the file was the only escape — which re-runs an applied migration everywhere else.
  //
  // On success we therefore also clear the stale failure: flip success back to 1 and null the
  // error_message, so the row reflects the run that just worked rather than the one that did not.
  if (options.success) {
    const successUpdates = [...updates];
    if (capabilities.hasSuccess) successUpdates.push("success = 1");
    // Without this the row keeps the old failure's text beside success = 1, which is the kind of
    // contradiction that costs an hour the next time someone reads this table during an incident.
    if (capabilities.hasErrorMessage) successUpdates.push("error_message = NULL");
    if (capabilities.hasStartTime) successUpdates.push("start_time = VALUES(start_time)");
    if (capabilities.hasDurationMs) successUpdates.push("duration_ms = VALUES(duration_ms)");
    if (capabilities.hasExecutor) successUpdates.push("executor = VALUES(executor)");
    // Same guarantee as the failure branch: every entry above is conditional on an optional
    // column, so on a minimal table the clause could otherwise be empty and the statement invalid.
    const clause = successUpdates.length > 0 ? successUpdates : ["filename = filename"];
    return `${sql} ON DUPLICATE KEY UPDATE ${clause.join(", ")}`;
  }

  // A failure MUST be recordable more than once. Every `updates` entry above is conditional on an
  // optional column, so on a table without them the clause was omitted entirely — the first failure
  // wrote a row, and every retry then died on the primary key with "Duplicate entry", which the
  // runner reported as the migration's own failure. With STOP_ON_FIRST_FAILURE that one poisoned
  // row blocks every migration behind it, permanently, and the only way out was renaming the file.
  // filename = filename is a no-op that guarantees a valid clause.
  const failureUpdates = updates.length > 0 ? updates : ["filename = filename"];
  return `${sql} ON DUPLICATE KEY UPDATE ${failureUpdates.join(", ")}`;
}

function buildSchemaMigrationsInsertParams(
  capabilities: SchemaMigrationsCapabilities,
  values: {
    filename: string;
    checksumSha256: string | null;
    environment: string;
    startTime: Date;
    endTime: Date;
    durationMs: number;
    executor: string;
    errorMessage?: string;
  },
  options: { success: boolean }
): unknown[] {
  const params: unknown[] = [values.filename];
  if (capabilities.hasChecksumSha256) params.push(values.checksumSha256);
  if (capabilities.hasEnvironment) params.push(values.environment);
  if (capabilities.hasStartTime) params.push(values.startTime);
  if (capabilities.hasEndTime) params.push(values.endTime);
  if (capabilities.hasDurationMs) params.push(values.durationMs);
  if (capabilities.hasExecutor) params.push(values.executor);
  if (!options.success && capabilities.hasErrorMessage) params.push(values.errorMessage ?? null);
  return params;
}

export function getSchemaVerificationState(): SchemaVerificationState {
  return { ...verificationState, pendingFiles: [...verificationState.pendingFiles] };
}

export function isSchemaReady(): boolean {
  return verificationState.state === "verified" && verificationState.valid;
}

/**
 * Verify the current schema version by checking which migrations have been applied.
 * This is a read-only operation that does not run any migrations.
 * Returns verification status for use by the migrate script --status flag.
 */
export async function verifySchemaVersion(): Promise<SchemaVerificationState> {
  verificationState.state = "verifying";
  verificationState.lastCheckedAt = new Date().toISOString();

  try {
    const host = env.DB_HOST;
    const port = Number(env.DB_PORT ?? 3306);
    const user = env.DB_USER;
    const password = env.DB_PASSWORD;
    const dbName = env.DB_NAME;

    if (!host || !user || !password || !dbName) {
      verificationState.state = "error";
      verificationState.valid = false;
      return getSchemaVerificationState();
    }

    // This intentionally does NOT reuse the app's shared pool (db/mysql.ts) — migrations
    // must not compete with app traffic for pool slots, and this function needs to work
    // even before the pool exists at boot. But that raw connection had no bound on it at
    // all. Verified live 2026-08-13: under real DB contention this whole operation
    // (connect + queries) stalled 79+ seconds on a single /api/health/version hit — every
    // caller waiting on it, including the Vite dev proxy, hung with it. connectTimeout
    // bounds the connect/auth phase specifically; VERIFY_SCHEMA_TIMEOUT_MS below bounds
    // the whole operation (connect + every query), so a stall in either phase can no
    // longer hang this route indefinitely.
    let inFlightConn: mysql.Connection | null = null;
    const work = (async (): Promise<SchemaVerificationState> => {
      const conn = await mysql.createConnection({ host, port, user, password, database: dbName, connectTimeout: VERIFY_SCHEMA_TIMEOUT_MS });
      inFlightConn = conn;
      try {
        // Check if schema_migrations table exists
        const [tables] = await conn.execute<RowDataPacket[]>(
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'schema_migrations'`,
          [dbName]
        );

        if (!tables.length) {
          // Table doesn't exist — all migrations are pending
          verificationState.appliedCount = 0;
          verificationState.pendingCount = MIGRATION_MANIFEST.length;
          verificationState.pendingFiles = MIGRATION_MANIFEST.slice(0, 20);
          verificationState.state = verificationState.pendingCount > 0 ? "incompatible" : "verified";
          verificationState.valid = verificationState.pendingCount === 0;
          return getSchemaVerificationState();
        }

        const capabilities = await getSchemaMigrationsCapabilities(conn, dbName);

        // Get applied migrations, tolerating older schema_migrations layouts that
        // do not yet have a success column.
        const [applied] = await conn.execute<RowDataPacket[]>(
          buildSchemaMigrationsAppliedQuery(capabilities.hasSuccess)
        );
        const appliedSet = new Set((applied as Array<{ filename: string }>).map((r) => r.filename));

        // Calculate pending
        const pending = MIGRATION_MANIFEST.filter((f) => !appliedSet.has(f));

        verificationState.appliedCount = appliedSet.size;
        verificationState.pendingCount = pending.length;
        verificationState.pendingFiles = pending.slice(0, 20);
        verificationState.state = pending.length === 0 ? "verified" : "incompatible";
        verificationState.valid = pending.length === 0;

        return getSchemaVerificationState();
      } finally {
        await conn.end();
      }
    })();

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        // Best-effort: force-close whatever connection is in flight so it does not
        // linger past this function returning. work() keeps running to completion in
        // the background either way — this only stops it from blocking the caller.
        inFlightConn?.destroy();
        reject(new Error(`verifySchemaVersion exceeded ${VERIFY_SCHEMA_TIMEOUT_MS}ms`));
      }, VERIFY_SCHEMA_TIMEOUT_MS).unref();
    });

    return await Promise.race([work, timeout]);
  } catch (error) {
    verificationState.state = "error";
    verificationState.valid = false;
    console.error("[migration] Schema verification error:", error);
    return getSchemaVerificationState();
  }
}

// Export the migration manifest for tests
export { MIGRATION_MANIFEST };
