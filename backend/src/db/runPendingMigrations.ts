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

/**
 * Errors that mean "try again", not "the schema is wrong".
 *
 * The runner's outer catch used to record EVERY failure as `migration-runner`, and in production
 * any recorded failure throws and refuses to start the server. That is right for a deterministic
 * schema problem — a missing file, a checksum mismatch, bad SQL — and badly wrong for a momentary
 * lock, which is what took production down on 2026-08-17: an ER_LOCK_WAIT_TIMEOUT on
 * `CREATE TABLE IF NOT EXISTS salary_certificate_request`, a table that had existed since 31 July.
 * Nothing was wrong with the schema; the boot was refused for ~40 minutes across two deploys
 * because a lock was briefly held.
 *
 * `db/mysql.ts` has its own TRANSIENT_DB_ERROR_CODES, but that set is deliberately connection-level
 * only — adding lock codes there would silently re-run statements inside other people's
 * transactions. Lock retries are safe HERE specifically, because the runner holds an advisory lock,
 * resets migrationHealth on every attempt, and every migration it applies is idempotent by
 * contract. Keep the two sets separate.
 */
const TRANSIENT_MIGRATION_ERROR_CODES = new Set([
  "ER_LOCK_WAIT_TIMEOUT",      // 1205 — someone held the row/metadata lock; retrying usually wins
  "ER_LOCK_DEADLOCK",          // 1213 — InnoDB picked us as the victim
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
]);
const TRANSIENT_MIGRATION_ERRNOS = new Set([1205, 1213]);
/** Total attempts, so a genuinely stuck lock still fails the boot rather than looping forever. */
const MIGRATION_MAX_ATTEMPTS = 3;
const MIGRATION_RETRY_BASE_MS = 3000;

/** Exported so the retry policy can be tested against real driver error shapes, not by grepping. */
export function isTransientMigrationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; errno?: unknown };
  if (typeof candidate.code === "string" && TRANSIENT_MIGRATION_ERROR_CODES.has(candidate.code)) {
    return true;
  }
  return typeof candidate.errno === "number" && TRANSIENT_MIGRATION_ERRNOS.has(candidate.errno);
}

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
// Exported so scripts/migrate-fresh-test.ts replays THIS list rather than a copy of it.
// It previously kept its own duplicate under a "must stay in sync with
// runPendingMigrations.ts" comment; the copy drifted to 115 entries against 524 here, so
// the fresh-database test silently skipped ~400 migrations - including every recent one -
// while still reporting "All migrations passed".
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
  "1048_salary_package_add_lta.sql", // Adds lta (Leave Travel Allowance) DECIMAL(12,2) DEFAULT 0.00 to salary_package_master and salary_package_state_wise. Applied out of band (both columns confirmed live 2026-08-20) but never registered; original ADD COLUMN IF NOT EXISTS is MariaDB-only syntax MySQL 8.0.42 rejects — rewritten as information_schema-guarded PREPARE/EXECUTE, matching the rest of this manifest. payroll.routes.ts and payroll-statutory-override.routes.ts read the column live.
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
  "1217_salary_prep_line_gratuity.sql", // Adds salary_prep_line.gratuity DECIMAL(10,2) NOT NULL DEFAULT 0, the gratuity employer cost that makes CEO-overview people cost agree with the Process P&L. Real dependency, not dormant schema: bpo-pnl.service.ts reads COALESCE(spl.gratuity, 0) directly. Verified live 2026-08-15 against mas_hrms 8.0.42 — the column EXISTS on production but schema_migrations has no row for this file, i.e. it was applied out of band, which is exactly why it needs registering: every other environment and any rebuilt database is missing it. The file was already written in this repository's guarded idiom (one information_schema COUNT driving a PREPARE/EXECUTE, since MySQL 8.0 rejects ADD COLUMN IF NOT EXISTS at the token), so it is idempotent as-is and left byte-for-byte unchanged. Placed at its natural numeric position: salary_prep_line and its AFTER anchor esic_employer are both created by 007_payroll.sql, so the dependency is satisfied long before 1217 on a rebuilt database. Purely additive — no DROP, no DELETE, no UPDATE, no row touched, and no payroll figure read or written; on production every guard evaluates false and the file is a complete no-op.
  "1218_grn_phase_a_columns.sql", // GRN Phase A: seven grn_request columns (company_code, vendor_state_code, billing_state_code, gst_enabled, is_late_invoice, late_invoice_reason, is_unbudgeted), grn_cost_allocation.is_unbudgeted, four indexes and fk_grn_company_code. Real dependency: grn-smart.service.ts UPDATEs is_late_invoice and vendor_state_code by name. Verified live 2026-08-15 — every one of those objects, the FK included, ALREADY EXISTS on production while schema_migrations has no row for the file: applied out of band, same lineage as 1217. REWRITTEN in the same commit that registers it, because the original text was one multi-column ALTER plus four bare CREATE INDEX plus an inline ADD CONSTRAINT, which is not re-runnable — a second execution raises ER_DUP_FIELDNAME (1060) then ER_DUP_KEYNAME (1061), and since migrations run at boot here, registering that form would have failed on its first scheduled run against the one database that matters. The declared schema is unchanged: same types, nullability, defaults, AFTER positions, index definitions and FK action clauses, now expressed as 13 information_schema-guarded PREPARE/EXECUTE blocks. The FK is additionally guarded on finance_company existing, and both sides are utf8mb4_unicode_ci (verified live), which is what InnoDB requires. Natural numeric position is correct and it does NOT need the 440/441 place-it-last treatment: grn_request comes from 310_vendor_payment_tracking.sql, grn_cost_allocation from 416_smart_grn_allocation_document_intelligence.sql and finance_company from 1090_finance_grn_monthly_sequence.sql, all before 1218. Purely additive — no DROP, no DELETE, no UPDATE, no row touched.
  "1219_suspend_unhandled_retention_policies.sql", // UPDATE data_retention_policy SET is_active=0 for 6 of its 7 rows (data_breach_log, leave_request, portal_otp, salary_prep_run, wfm_attendance_session, employees) — privacy-retention.worker.ts can only ever act end-to-end on the 7th, ats_candidate (the only entity_type with both an ENTITY_QUERIES candidate query AND an ANONYMIZE_HANDLERS execution handler). 5 of the 6 have no query at all, so the worker's `if (!queryTemplate) continue;` skips them silently before a single candidate row is ever written — invisible even in a dry run. employees has a working query (correctly identifies exited employees past the 8-year window in dry-run) but no execution handler, and its declared action_on_expiry ('archive') is not implemented as a distinct operation anywhere in the worker at all. Verified live 2026-08-14: privacy_retention_candidate is completely empty across every entity_type, confirming this isn't "working, just no candidates yet." is_active=1 on all 6 was a false compliance signal — anyone reading the table saw "7 retention policies configured" when 1 does anything. Data-visibility fix only: retention_days/action_on_expiry/every other column untouched, only is_active flips. Reactivate a specific row individually once real handler coverage exists for it — do not reactivate all 6 together. Delta-audit 2026-08-14, Section K item 5 (Option B — stop the signal now; Option A, building the missing handlers, is separate scheduled follow-up work).
  "1220_full_final_paid_transition.sql", // adds ff_paid_by CHAR(36), ff_paid_at DATETIME and ff_payment_reference VARCHAR(100) to full_final_calculation, all nullable. Purely additive and inert on apply: no row is touched and no status changes. full_final_calculation.status is enum('draft','verified','approved','paid') but 'paid' had never been reachable — ff.service.ts's only status write was `SET status = 'approved'` — and the table had nowhere to record a payment, so the state was unreachable AND unrecordable. Verified live 2026-08-15: nothing has ever been 'paid'. Two things were silently inert as a result: FF_PAID_BUT_EMPLOYEE_ACTIVE (labelled P0) queries status='paid' and so could never fail, reporting a clean pass on a control never once evaluated; and the "already paid, cannot re-approve" guards in approveFF and ff-approval-guard.compat.routes.ts were dead branches. The workflow rules (approved-only, payment reference required, approver cannot also mark paid) live in ff.service.ts markFfPaid, deliberately not in this file — who may pay and on what evidence is a payroll/finance policy decision, reviewable in one place rather than encoded in DDL. Columns guarded individually via information_schema + PREPARE (MySQL 8.0 rejects ADD COLUMN IF NOT EXISTS); idempotent.
  "1221_transfer_record_applied_at.sql", // adds transfer_record.applied_at DATETIME NULL. mobility.service.ts has always written and read this column — applyTransferToEmployee does `UPDATE transfer_record SET applied_at = NOW()` and applyPendingTransfers filters on `applied_at IS NULL` — but it does not exist, so every one of those statements raises ER_BAD_FIELD_ERROR. Verified live 2026-08-15: the table has id, employee_id, transfer_type, from_value, to_value, effective_date, reason, approved_by, status, initiated_by, created_at, updated_at and nothing else, and holds 0 rows — consistent with the feature never having completed once. NOT dead code: createTransfer is routed and applies inline whenever effective_date <= today, which is the common case, and that call ends in the failing UPDATE. Worse, applyTransferToEmployee moves the EMPLOYEE row (branch_id/process_id/reporting_manager_id) BEFORE stamping applied_at, so the throw lands after the employee has already been reassigned — a half-applied transfer. Purely additive and nullable, so applying changes nothing except that those statements stop throwing. Does NOT schedule applyPendingTransfers: that sweep mutates employee rows in bulk and turning it on is a separate decision with an owner; its misleading "called by a nightly scheduled job" comment is corrected in the same change. Guarded via information_schema + PREPARE (MySQL 8.0 rejects ADD COLUMN IF NOT EXISTS); idempotent.
  "1222_roster_manager_rejected_enum.sql", // appends 'manager_rejected_employee_request' to wfm_roster_assignment.final_roster_status. wfm.routes.ts POST /roster/:assignmentId/reject-employee-request writes exactly that literal, but the enum does not contain it and production runs STRICT_TRANS_TABLES, so the UPDATE raises ER_DATA_TRUNCATED (1265) and the request 500s — every time, for every manager, since the column was created. Verified live 2026-08-15: the enum has 10 members and that is not one of them; 0 rows hold '' (the non-strict coercion fallback) and all 413,386 sit at 'generated', confirming the path has never once landed. The throw precedes the roster_decision_audit INSERT, so a rejection the manager believes they recorded leaves neither an assignment change nor an audit row. The read side already assumes the value exists — GET /api/wfm/my-weekoff filters on it and both wfm.routes.ts and rta.routes.ts branch on it in CASE expressions — so the enum was the only place it was missing; remapping the write onto an existing state instead would collapse a distinct outcome into another and change what the audit trail means. Appended LAST so every existing member keeps its ordinal (MySQL stores enums by index, so a mid-list insert would silently reinterpret stored rows); NOT NULL DEFAULT 'generated' carried through unchanged. Purely additive — no row touched, nothing starts happening on apply except that the route stops throwing. Guarded via information_schema + PREPARE; idempotent.
  "1140_absence_penalty_config.sql", // CREATE TABLE IF NOT EXISTS only — architecture for a future superadmin-configurable additional unplanned-absence deduction (effective-dated, approval-gated, modelled on statutory_config_version). NOT wired into payrollCalculate.service.ts and NOT activated; with no approved row ever inserted, backend/src/shared/absencePenaltyConfig.ts's read helper always returns 0. Part of the 2026-08-13 leave-module audit (policy sign-off, "future configurable unplanned-absence penalty").
  "1202_week_off_policy_default.sql", // CREATE TABLE IF NOT EXISTS only, no existing table/column touched — the process/branch/org-default tier (tier 3-5) of the week-off resolution hierarchy roster-generation.service.ts now consults when neither an approved week_off_preference (tier 1) nor a process roster_template pattern (tier 2) resolves an employee's week-off day. Empty table, no seed row at any scope — the business decision is explicit that this must never default to Sunday, so an unconfigured scope stays unconfigured rather than substituting a guess; roster.governance.service's advanceCycleStatus() now blocks a cycle's publish transition when a generation run recorded any employee for which no tier resolved anything (WEEK_OFF_POLICY_MISSING). Part A.1 of the 2026-08-13 roster enterprise-controls program.
  "1141_payroll_bank_exception.sql", // CREATE TABLE IF NOT EXISTS only — the workflow overlay behind the new Bank Payment Readiness page (/payroll/bank-readiness): who owns each bank exception, its workflow status and notes. Deliberately stores NO readiness class and NO account number: the classification is recomputed live on every request by bank-payment-readiness.service.ts, because a stored snapshot would keep asserting MISSING after HR fixed the record — the same both-directions-wrong failure salary_prep_run.total_employees already has here. COLLATE=utf8mb4_unicode_ci is explicit, not decorative: employees.id is utf8mb4_unicode_ci while the server default is utf8mb4_0900_ai_ci, so an unqualified CREATE TABLE yields a table whose first join to employees dies with errno 3780. UNIQUE KEY on employee_id is load-bearing — the PATCH endpoint is an INSERT ... ON DUPLICATE KEY UPDATE keyed on it and would otherwise append a row per edit. Verified by replaying the exact DDL as a TEMPORARY table against production 8.0.42, including the ON DUPLICATE KEY path and the join to employees and auth_user. Additive and idempotent.
  "1142_payroll_bank_readiness_page_access.sql",
  "1143_quality_executive_page_access.sql", // widens QUALITY_EXECUTIVE (/quality/executive) role_page_access to match QUALITY_DASHBOARD's active grants (branch_head, branch_qa, qa, quality_analyst — ceo/coo/super_admin/tq_head already had it). The route stopped redirecting to /quality-dashboard and now renders ExecutiveQualityDashboard.tsx directly (2026-08-17, holds the Drill-Down/Heatmap/Agent Risk/Inbound/CLAP VOC/Sales & Funnel/AI & ROI tabs moved off QualityDashboard.tsx), so without this those four roles would see "Access Denied" opening a page whose tabs they could already see at the old address. INSERT ... ON DUPLICATE KEY UPDATE only, no DELETE.
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
  "1214_billing_provision_period_code.sql", // Adds period_code CHAR(7) to billing_provision_snapshot and back-fills it from finance_year + month_label. billing_provision_snapshot (7,350 rows) is the primary per-cost-centre monthly billing data from db_bill.provision_master but had no period_code column, forcing PnL revenue queries to do a runtime CASE expression per row. The backfill computes e.g. finance_year="2026-27" + month_label="Jul-26" → "2026-07". The new index (period_code, cost_centre_code) directly serves the UNION branch added to getInvoicedRevenueActuals() and revenueByBranch(), which are the primary revenue computation paths. Without this migration the revenue fix falls back to an inline CASE expression; with it, queries are index-range scans. ALTER adds a nullable column; backfill UPDATE touches 7,350 rows and is safe to re-run (WHERE period_code IS NULL guard).
  "1215_cost_centre_reward_penalty.sql", // Creates cost_centre_reward_penalty — stores manually-entered rewards and penalties per cost centre per period with maker-checker approval (draft → approved/rejected). Many cost centres have per-client reward/penalty billing terms known only at month-end (e.g. CSAT bonuses, SLA breach deductions) that must be entered by finance and approved by finance_head before flowing into the PnL as incentive_revenue (rewards) and penalty (penalties). CREATE TABLE only — safe to re-run. No FK to cost_centre_master to avoid FK-ordering issues on a rebuilt database.
  "1224_wfm_rest_policy_enforcement_mode.sql", // Adds enforcement_mode ENUM('warn','block') NOT NULL DEFAULT 'block' to wfm_rest_policy, so the one canonical rest resolver in rest-policy.service.ts can tell all four roster write paths whether a shortfall blocks the write or records a REST_GAP_WARNING and proceeds (owner ruling 2026-08-16, decision 2: WARN first, BLOCK after the NOIDA-2 exceptions are remediated). DEFAULT 'block' preserves today's behaviour exactly, so the migration cannot loosen enforcement by itself — the 11-hour organisation policy is seeded separately, in WARN, as a configuration step. wfm_rest_policy is EMPTY in production, so this ALTER rewrites no rows. information_schema-guarded PREPARE/EXECUTE, not ADD COLUMN IF NOT EXISTS, which this MySQL 8 server rejects while still recording the migration as applied. Re-runnable; no DROP, no DELETE.
  "1223_lms_reminder_log.sql", // Adds due_date + course_duration_hours to lms_learning_progress_snapshot and creates lms_reminder_log, which deduplicates reminder sends so a daily cron tick cannot re-email the same (employee, course, window). Shipped 2026-08-14 with its code but registered nowhere, so migration-manifest-guard.test.ts has been red on it and lms-reminders.cron.js would have hit ER_NO_SUCH_TABLE on its first sweep. Syntax repaired 2026-08-16: the original used MariaDB ADD COLUMN IF NOT EXISTS (x2) and CREATE INDEX IF NOT EXISTS, which MySQL 8.0.42 rejects with ER_PARSE_ERROR while the runner records the migration as applied — the 2026-08-13 outage pattern. Now information_schema-guarded PREPARE/EXECUTE; schema itself unchanged. Verified read-only 2026-08-16 that neither column, the index, the table, nor a schema_migrations row exists, so this applies cleanly and re-runs as a no-op. Additive; no DROP, no DELETE.
  "530_cosec_sync_queue.sql", // Creates cosec_user_sync_queue — the per-new-hire COSEC registration push outcome queue that cosec-registration.service.ts reads and writes. Shipped in 63ddf8f8 with the auto-registration feature but registered in neither the manifest nor knownUnlisted, so a rebuilt database would not have the table and every registration attempt would raise ER_NO_SUCH_TABLE. THIRD unregistered migration found today (1226, 1229, this one), all from different sessions, all named correctly and instantly by migration-manifest-guard.test.ts — and all missed because GitHub Actions has been unable to start a job, so its red is indistinguishable from every other commit's red. Verified before scheduling: the table ALREADY EXISTS on production with 0 rows (applied out of band, like 1217 and 1218 before it), so this is a no-op there and a correctness fix for every other environment; CREATE TABLE IF NOT EXISTS so it is re-runnable; and employee_id is utf8mb4_unicode_ci matching employees.id, so a join cannot die with errno 3780 — the collation trap this repo has hit before. The file name says cosec_sync_queue while the table is cosec_user_sync_queue; the code agrees with the TABLE, which is what matters, and renaming the file now would only break this entry. Its `USE mas_hrms;` line is the convention in 170 of these files, not a defect introduced here.
  "1229_statutory_override_notification_events.sql", // Registers the three PF/ESIC opt-out notification events (submitted / decided / revoked) in notification_event_config. Shipped in c8337a5c with the opt-out workflow it belongs to, but registered in neither the manifest nor knownUnlisted, so it would never have run and the workflow would have approved and revoked opt-outs while telling nobody. Second unregistered migration today — 1226 was the first — and migration-manifest-guard.test.ts named both correctly; nobody saw either because GitHub Actions has been unable to start a job all day, so its red is indistinguishable from every other commit's red. Verified live against production before scheduling, rather than trusting the file's header: enabled DEFAULTS to 0 and dispatch_mode to 'shadow' (the INSERT sets neither, so a default of 1 would have started sending mail on apply), notification_event_config carries uq_nec_event(event_code) so the INSERT IGNORE is genuinely idempotent rather than merely intended to be, and none of the three event_codes exists yet so this does real work. The backfill floor is armed in the same file, so a first worker sweep cannot replay historical opt-out requests as fresh notifications. Adds rows to a config table only — no payroll, attendance or statutory figure is read or written, and nothing sends until someone enables it deliberately.
  "1226_fix_festival_calendar_2026.sql", // Corrects 9 festival_calendar dates for 2026 and adds 4 missing festivals. Shipped in af3a2cc5 with its companion edit to 1072_festival_greetings.sql but registered NOWHERE — not in the manifest, not in knownUnlisted — so it would never have run: the 1072 edit fixes a rebuilt database while production, where 1072 is already recorded as applied, would have kept serving the wrong dates indefinitely. That is the correct two-part pattern (fix the seed for fresh builds, add a forward migration for existing ones) with the second part left unscheduled. migration-manifest-guard.test.ts names this file exactly and has been red since af3a2cc5 landed; nobody saw it because GitHub Actions has been failing to start any job all day, so CI reported the same red it reports for every commit. Verified safe to schedule against production 2026-08-17: each UPDATE is guarded on the OLD date so it is a no-op once applied, and festival_calendar carries a composite UNIQUE on (festival_name, festival_date) — confirmed live, not assumed — so the INSERT IGNORE collides rather than duplicating, both on a re-run and on a rebuilt database where the corrected 1072 has already inserted the same four rows. Touches only greeting content; no payroll, attendance or statutory figure. The dates themselves are that commit's sourcing and are NOT re-adjudicated here — they remain worth a human check before the greetings send.
  "1225_lms_admin_identity_map.sql", // Creates lms_admin_identity_map — per-person LMS administrator identity (owner ruling 2026-08-16, decision 7). resolveDirectLmsIdentity() picked the LMS admin account with ORDER BY CASE WHEN admin_id = 'LMS-ADMIN' THEN 0 ELSE 1 END LIMIT 1, so every HRMS admin launching the LMS acted as the one shared 'LMS-ADMIN' account and the LMS audit trail could not attribute any administrative change to a person. The LMS is protected and its admin_user_master has no employee_code or email column to join on, so the mapping lives here and the LMS schema is untouched. Created EMPTY on purpose: which HRMS person is which LMS admin is a fact only the LMS administrator holds, and a wrong row hands someone another person's admin identity. Until a row exists the launch refuses with LMS_IDENTITY_NOT_MAPPED. One CREATE TABLE IF NOT EXISTS, no FK, no DROP, no DELETE, re-runnable.
  "1227_cost_centre_billing_client_name.sql", // Adds cost_centre_master.billing_client_name — the legal entity a cost centre invoices, which no column currently holds. client_name does NOT contain a client: verified against db_bill on 2026-08-17 across 400 cost centres joined on bill_source_id, it equals cost_master.process_name (the campaign) on 400 of 400 and cost_master.client (the entity) on 0 of 400, and it is byte-identical to process_name_bill on all 785 populated rows. So one client reads as many — "Vodafone" is 14 client_name values that are 14 processes for Vodafone Mobile Services Ltd, and searching the real name finds nothing. Neither existing id helps: client_id is NULL on all 927 and its FK points at the portal-TENANT registry (api_key, subscription_status, 12 dead rows), while db_bill dialdesk_client_id resolves on 287 of 287 to a client whose name disagrees with the row's own text on 287 of 287. The reliable source is already in mas_hrms: billing_invoice_snapshot joins bill_client + cost_centre_code on 10,987 real invoices (592 distinct clients, current to 2026-08), resolving 399 of 437 active cost centres. ADDITIVE ONLY — nullable column plus an index; client_name, process_name_bill and client_id are untouched, so every existing read, filter and report is unchanged. Backfill is a separate reviewable script because 10 cost centres billed more than one client and must not be collapsed silently. information_schema-guarded PREPARE/EXECUTE, not ADD COLUMN IF NOT EXISTS which this MySQL 8 server rejects while recording the migration applied. Re-runnable; no DROP, no DELETE.
  "1228_offer_esic_opt_out.sql", // Adds ats_employment_offer.esic_opt_out alongside the existing pf_opt_out (migration 335). Investigated 2026-08-17: neither pf_opt_out nor any ESIC equivalent is written by any code path — payroll-hr.service.ts's and ats.onboarding.service.ts's offer INSERT/UPDATE statements never reference it, so the column has sat unused since it was added. Owner clarified the real process: Payroll HR elects PF/ESIC opt-out at offer creation, not the candidate during onboarding (candidate_onboarding_profile.pf_opt_out_elected exists but is separately broken — saveStatutory() never persists it — and is explicitly not the intended decision path). This migration adds only the missing column; the offer-creation wiring, the employee-creation transfer into employee_statutory_override, and the Payroll HR UI ship alongside it in the same change. information_schema-guarded PREPARE/EXECUTE, not ADD COLUMN IF NOT EXISTS which this MySQL 8 server rejects while recording the migration applied. Re-runnable; no DROP, no DELETE.
  "1230_rbac_super_admin_only_page_access_sweep.sql", // Go-live UAT sweep 2026-08-17/18: a full role_page_access query across every pageCode referenced by a ProtectedRoute roles={} array (86 codes) found 16 pages where the DB grant was never backfilled beyond super_admin — the same FINANCE_GRN/QUALITY_EXECUTIVE pattern fixed twice earlier the same day, now confirmed systemic. 15 confirmed genuine under-grants (role list taken directly from each route's own roles={} prop, i.e. this makes the DB agree with what the source code already documents as intended); SUPER_ADMIN_POLICY_ENGINE was checked and found correctly scoped, so excluded. PAYROLL_TDS_PART_A additionally had NO page_catalog row at all (total lockout) — inserted, with can_create/can_edit granted too since its backend requireRole(...PAYROLL_ROLES) guard was individually verified to match the route's roles list exactly. The other 15 get can_view only (deliberately conservative — write-capability parity with each page's own backend guard was not individually re-verified for all 15 in the time available). Dry-run verified via a rolled-back transaction against production before this file was written: exact intended grant set confirmed per page code, zero persisted changes. RBAC/access-control DATA fix only — no payroll/statutory calculation logic, bank data or encryption key touched; the backend requireRole guards (the real security boundary in this codebase, not UI route gating) are unchanged.
  "1231_maternity_org_masters_page_access.sql", // Continuation of 1230: a full page_catalog scan beyond the roles={}-prop sample found 46 more super_admin-only pages. Most (~37) have zero live <Gate pageCode=> reference in any route file today — likely stale/orphaned catalog rows from renamed pageCodes, unconfirmed and deliberately NOT acted on here pending a follow-up check of whether they're consulted anywhere outside src/config/routes/. Two have strong, confirmed evidence of being genuine under-grants and are fixed: MATERNITY_LEAVE (workforce.routes.tsx's own roles={['super_admin','admin','hr']} on the route itself) and ORG_MASTERS (no roles= on the route, but navConfig.tsx lists admin|hr consistently across all three nav entries pointing at this pageCode). View-only, same conservative default as 1230. Dry-run verified via a rolled-back transaction before this file was written.
  "1232_bgv_check_unique_constraint.sql", // Adds UNIQUE(candidate_id, check_type) to candidate_bgv_check, closing a race in createOrUpdateCheck() (bgv-verification.service.ts): SELECT-existing-then-branch-UPDATE-or-INSERT with no unique constraint let two near-simultaneous calls for the same (candidate_id, check_type) both see "no existing row" and both insert. Observed live: one candidate accumulated 39 duplicate aadhaar rows and 18 duplicate bank rows, all fired milliseconds apart against the mock BGV provider. All existing duplicates cleaned up separately first (bgv-check-duplicate-cleanup.ts --apply, 2026-08-17) and re-verified duplicate-free immediately before this file was written (2026-08-18, bgv-check-duplicate-scan.ts, public-IP connection — office LAN was unreachable that session). information_schema-guarded PREPARE/EXECUTE for the ALTER, matching 1224/1225/1227/1228/503 — this MySQL 8.0.42 server rejects ADD CONSTRAINT ... IF NOT EXISTS with ER_PARSE_ERROR while still recording the migration as applied. A SIGNAL-based custom error message was tried for the duplicate-data guard and does not work here — SIGNAL is rejected via PREPARE/EXECUTE outside a stored program, confirmed live against this server ("This command is not supported in the prepared statement protocol yet") — so the migration relies on the audit SELECT for visibility and the ALTER's own ER_DUP_ENTRY as the safety net, same as 503_pt_slab_dedup.sql. Prerequisite for rewriting createOrUpdateCheck as a single atomic INSERT ... ON DUPLICATE KEY UPDATE, shipped alongside it. Additive only; no DROP, no DELETE.
  "1233_org_masters_hr_write_permission.sql", // Closes the gap 1231's own header flagged as unverified: "write-capability parity with each page's backend guard was not individually verified" for the 15 view-only recovered pages. This is that verification for ORG_MASTERS/hr specifically — go-live UAT continuation session, 2026-08-18. Confirmed live by reading org.routes.ts directly: every ORG_MASTERS create/edit/status-toggle endpoint already accepts requireRole("admin", "hr"), while delete is requireRole("admin") only (hr excluded). UPDATE-only against the row 1231 already inserted: sets can_create=1, can_edit=1 for (ORG_MASTERS, hr), leaves can_view/can_delete/active_status untouched since the backend boundary for those was already correctly reflected. No new row, no DROP, no DELETE.
  "1235_payroll_head_onboarding_requests_access.sql", // Resend-onboarding-link access fix (2026-08-18): grants payroll_head the ATS_ONBOARDING_REQUESTS page (can_view/can_create/can_edit=1, mirroring branch_hr's existing grant on this page). Backend requireRole/hasScopedAccess access for payroll_head on POST /send-token/:candidateId and GET /requests is granted in the same code change to ats.onboarding.routes.ts. Additive INSERT ... ON DUPLICATE KEY UPDATE against role_page_access; no DROP, no DELETE.
  "1236_payroll_hr_onboarding_requests_reactivate.sql", // Follow-up to 1235: payroll_hr already passed requireRole on the same two routes (since migration 1005) but its role_page_access row for ATS_ONBOARDING_REQUESTS was active_status=0 in production, with no deliberate deactivation found across every migration touching payroll_hr or this page code (1005, 1097, 1104, 1105, 1230, 271, 345) — treated as drift and reactivated. Single-row UPDATE ... SET active_status=1 WHERE active_status=0; no DROP, no DELETE.
  "1237_legacy_document_verified_backfill.sql", // One-time catch-up for migrateDocumentsFromLegacy.ts::insertBatch()'s verified=0 default, fixed to verified=1 the same session (these are historical documents verified offline before this system existed, same reasoning as the legacy joining-checklist placeholder's status='verified'). UPDATE employee_documents SET verified=1 WHERE legacy_source IN ('document_master','qual_docoments','esignature') AND verified=0 — scoped to the three genuine migration sources, deliberately excluding legacy_source='manual' (13 rows, provenance not established by any code comment found). Explicitly reviewed with the owner before registration: read-only breakdown run twice (2026-08-18, no drift between runs) — document_master 196,417 rows + esignature 62 rows = 196,479 rows flip from verified=0 to verified=1. Idempotent; no DROP, no DELETE.
  "1238_dispatch_log_skipped_status.sql", // Part of the SMS-dispatch DLT fix (2026-08-18): widens dispatch_log.status to add 'skipped', so dispatch.service.ts can distinguish an event it deliberately did not attempt over SMS (no registered DLT template mapped) from one that was attempted and genuinely failed. MODIFY COLUMN widening an ENUM — additive, preserves every existing value and row, naturally idempotent to re-run.
  "1240_emergency_contact_onboarding_backfill.sql", // One-time catch-up for the emergency-contact sync gap fixed the same session in employee-creation-orchestrator.service.ts (commit 6930066f) — candidate->employee conversion never copied candidate_onboarding_profile.emergency_contact_name/relation/mobile into employee_emergency_contact, the table the ID card and both HR/self-service emergency-contact editors read. Explicitly approved by the owner in the same session ("ok do it") after the exact scope was shown. Read-only scope check (2026-08-18): of 32,787 candidate_onboarding_profile rows only 100 have a non-empty emergency_contact_mobile; 98 have no matching employees row at all (never converted) and are correctly left alone; exactly 2 already-converted employees are eligible (MAS63085, MAS63086, both active), neither already has a contact_seq=1 row. INSERT ... SELECT ... WHERE NOT EXISTS, re-verified read-only against the live values before registration. Additive only — no DROP, no DELETE, no UPDATE of any existing row; UNIQUE KEY uq_emp_emergency_seq(employee_id, contact_seq) backstops a duplicate/concurrent run.
  "migrations/1300_client_billing_foundation.sql", // Foundation schema for the client-billing replica — creates three new tables (client_invoice_number_sequence, client_invoice, client_invoice_line) only. Does not touch existing cost_centre_master, branch_master, billing_invoice or billing_*_snapshot tables. Replaces the legacy db_bill/InitialInvoicesController.php proforma-invoice engine with a modern equivalent that fixes the race condition in invoice numbering (legacy used LOCK TABLES READ, incorrect mode and no real serialization). Uses MySQL's INSERT ... ON DUPLICATE KEY UPDATE last_value = LAST_INSERT_ID(last_value + 1) idiom for safe concurrent numbering. Pure CREATE TABLE — no ALTER of existing tables, no data migration. Additive and idempotent by construction; safe to re-run. Approval-stage fields (bill_no, rejected_*) included now to avoid future ALTER TABLE on a production table. cost_centre_id CHAR(36) COLLATE utf8mb4_unicode_ci matches cost_centre_master(id) collation.
  "migrations/1301_client_billing_approval_workflow.sql", // Approval-workflow schema for the client-billing replica — creates five new tables (client_provision, client_provision_deduction, client_po_number, client_po_particular, client_invoice_audit_log) with provision tracking, PO tracking, and append-only audit log for invoice state transitions. Does not touch client_invoice or any existing table. client_provision and client_po_number use atomic SQL balance mutations to fix legacy's PHP string-coercion balance bugs. client_invoice_audit_log replaces legacy's four inconsistent reject mechanisms with one auditable path. Pure CREATE TABLE — no ALTER of existing tables, no data migration. Additive and idempotent by construction; verified against live MySQL 8.0. Every column uses CHAR(36) COLLATE utf8mb4_unicode_ci to match employees/cost_centre_master collation and avoid errno 3780 on FK joins.
  "migrations/1302_client_billing_credit_notes.sql", // Credit-note schema for the client-billing replica (docs/superpowers/specs/2026-08-19-client-billing-credit-notes-design.md). Two new tables: client_credit_note (with id, invoice_id FK, cost_centre_id FK, category, finance_year, month_label, credit_date, description, credit_no, credit_status, gst_type, apply_gst, total_amount, igst/cgst/sgst_amount, approved_by/at, created_by/at), client_credit_note_line (id, credit_note_id FK, particulars, qty, rate, amount). Does not touch client_invoice, client_invoice_line, cost_centre_master, or any db_bill/billing_invoice/billing_*_snapshot table. Legacy db_bill.tbl_credit_note.credit_no is a DD-MM/FY-FY date stamp that collides (confirmed live: ids 163 and 164 both 2026-08-18 carry credit_no='18-08/26-27'). client_credit_note.credit_no is minted via the numbering service, format CN-<stateCode>-<NN>/<FYshort>, scoped per (stateCode, companyName, financeYear). invoice_id is a real FK to client_invoice (replaces legacy's proforma_bill_no, which despite its name stores the invoice's real bill number). Pure CREATE TABLE. Table-level COLLATE=utf8mb4_unicode_ci (foundation phase's collation incident), no surrogate AUTO_INCREMENT id (numbering-service incident), IF NOT EXISTS on both (reserved-word/idempotency incident). Every statement verified against live MySQL 8 with PREPARE before this file was committed. Additive and idempotent by construction; safe to re-run.
  "1241_minimum_wage_gate_columns.sql", // Adds min_wage_provisional/min_wage_check_note to salary_package_master and ats_offer_letters for the new minimum-wage validation gate (minimum-wage-gate.service.ts), which reads minimum_wage_master (028_statutory_compliance.sql) back for the first time — until now it had a working CRUD API/admin UI but nothing consumed it. Follows the same provisional-not-blocked shape as F&F's is_ff_provisional and TDS/gratuity's status/reason results; wired into payrollMasters.service.ts createPackage/updatePackage (checked by branch_name, the only location signal that table has) and ats/offer-letter.service.ts generateOfferLetter (checked by candidate.branch_id, falling back to branch_name). Both flag columns default 0 so all 295 existing packages and every historical offer letter read as "not yet evaluated", not "flagged" — nothing retroactive. information_schema-guarded PREPARE/EXECUTE, not ADD COLUMN IF NOT EXISTS which this MySQL 8 server rejects while recording the migration applied. Additive only; no DROP, no DELETE, no payroll/salary calculation logic touched — this is a validation gate, not an arithmetic change. Live coverage measured 2026-08-19: minimum_wage_master holds 24 active rows across only 6 states (DL/HR/KA/MH/TS/UP); of 1,356 active employees, 918 (68%) resolve to one of those 6 and get a real floor comparison, 430 (32%) resolve to a real state with no configured floor (provisional, not blocked), and 8 have no resolvable state at all.
  "migrations/430_rbac_matrix_applied_grants.sql", // RETROACTIVELY REGISTERED 2026-08-19 — shipped earlier the same day (eb8fafa8, the RBAC applier provenance fix) but never added here, an oversight caught by an independent QA re-audit reading the file tree directly. The number collides with the unrelated, already-applied sql/430_finance_grade_headcount_driver.sql (different directory, sql/ vs sql/migrations/ — the "migrations/" prefix here is load-bearing, same convention as 1300/1301 above). This did not weaken the RBAC safety fix itself: apply-rbac-page-matrix.mjs creates rbac_matrix_applied_grants inline via CREATE TABLE IF NOT EXISTS on every run, independent of this manifest. Registering it now so schema_migrations correctly shows it applied and the migration-manifest-guard test has a real entry to check against, not so anything starts working that wasn't already. Pure CREATE TABLE, no ALTER, no DROP, no DELETE; safe to run any time.
  "migrations/435_rbac_11_super_admin_only_pages.sql", // UAT finding D011 (uat-100pct-readiness branch, 2026-08-18): 11 live, reachable pages had role_page_access grants of super_admin only, making their nav entries invisible to every non-super_admin role even though the backend route guards accept a broader set. MATERNITY_LEAVE and ORG_MASTERS from the same sweep were already fixed by migrations 1231/1233. This closes the remaining 11: ATTENDANCE_BILLING_CONFIG, BENEFITS, CLIENT_MASTER, COMPLIANCE_AUDIT_REPORT, EXIT_COMMAND_CENTER, LEAVE_TYPES, MCNMEET, MOBILITY, PORTAL_DATA_MANAGER, PROCESS_CONFIG, SUPPORT_COMMAND_CENTER. Role grants are derived from each page's backend requireRole() calls (re-read 2026-08-23) and navConfig entries — write grants match backend write guards; view-only where only GET is confirmed. All INSERT … ON DUPLICATE KEY UPDATE; pure data migration, no DDL. Does NOT auto-apply until explicit user approval per CLAUDE.md migration-approval rule.
  "1242_employee_loans_approval_gate.sql", // Adds employee_loans.created_by/rejected_by/rejected_at/rejection_reason for the new loan approval gate (loans.routes.ts POST /:id/approve, /:id/reject). POST / previously self-stamped approved_by/approved_at with the creator's own id at INSERT time and inserted status='active' directly — zero approval gate, fake provenance. Now inserts status='pending_approval' and leaves approved_by/approved_at NULL until a real approver (finance_head/payroll_head/admin/super_admin, mirroring payroll.service.ts::updateRunStatus's head-role tier) calls /approve, which is blocked for the original creator (created_by === approver, matching PAYROLL_SELF_APPROVAL) and uses an `UPDATE ... WHERE status='pending_approval'` affected-rows check for the 409 race guard, mirroring leave.service.ts::reviewRequest. No ENUM/CHECK exists on `status` (plain VARCHAR(20)), so the new status values themselves need no DDL — only the provenance columns do. information_schema-guarded PREPARE/EXECUTE, matching 1241 immediately above. Additive only; touches none of the 67 existing rows (all status IN ('active','completed'), actively deducting real payroll) — no UPDATE, no DELETE, no payroll calculation logic changed. payrollCalculate.service.ts and running-salary.service.ts's loan-EMI reads already filter WHERE status='active', so 'pending_approval' rows are automatically excluded with no change to either file.
  "migrations/1303_client_billing_page_access.sql", // Client Billing frontend Task 1 (2026-08-19): page_catalog row + role_page_access grants for FINANCE_CLIENT_BILLING (/finance/client-billing), the workspace page over the client-billing replica backend (1300/1301/1302 above). Same cautionary reasoning as 1066/1129: without a grant here the page is invisible to every role except super_admin. Roles match client-billing.routes.ts's live ALLOWED_ROLES exactly (admin, finance, finance_head, accounts_head), plus an explicit super_admin row for audit-query consistency with the rest of this table. can_delete=0 for every role — no route in this module exposes a DELETE verb; a wrong document is rejected/superseded, not deleted, preserving client_invoice_audit_log. Registered but NOT applied to production as of this commit — see Task 1's own report for the live PREPARE-verification. Purely additive: two INSERT ... ON DUPLICATE KEY UPDATE statements, no ALTER, no DROP, no DELETE.
  "1243_backfill_branch_gst_state_code.sql", // Backfills branch_master.gst_state_code (added NULL-only by 1087_branch_master_gst_registration.sql, which explicitly deferred population) — this was blocking the client-billing module's createProforma/approveInvoice, which correctly 400 without it. gst_state_code was NULL on all 45 live branch_master rows as of 2026-08-19. The GST state code is a fixed, public 2-digit reference table (unchanged since 2019-2020) — not a per-branch judgment call — matched against branch_master's OWN existing `state` column (already populated on 27/45 rows) wherever present, and against `city`/`branch_name` (cross-checked against a sibling row for the same place that does have `state` populated) for the rest. cost_centre_master.vendor_gst_state was checked and rejected as an alternate source: it records the client/vendor's own GST state per billing relationship, not the branch's physical location (one branch_id alone carries 50+ contradictory vendor_gst_state values). 40 of 45 branches backfilled with high-to-very-high confidence via explicit id-scoped UPDATEs (not a derived/computed statement) — 5 deliberately left NULL (HEAD_OFFICE: genuinely ambiguous, org has two different head offices in this same table; SCAN_N_SMILE: no location signal; 3 TD-BR-* rows: synthetic smoke-test branches). Every WHERE clause also requires gst_state_code IS NULL, so a re-run is a no-op and this can never overwrite a value Finance enters by hand. Does not populate gstin (no real GSTIN exists anywhere in this schema — a genuine, separate, unaddressed gap), gst_type, or any tax-calculation/payroll logic. Explicitly approved by the owner after live review of the full 45-row confidence table.
  "1244_tds_slab_2025_26_new_regime_dedup.sql", // Deactivates 6 stale rows in payroll_tax_slab_master (financial_year='2025-26', regime='new') that were causing the exact TAX_SLABS_AMBIGUOUS condition getSlabs() (taxEngine.service.ts, fixed cd29c8d9 2026-08-17) is designed to refuse — 13 active rows where only 7 bands exist, live since 2026-07-20. Not exact duplicates: two genuinely different slab schemes both tagged '2025-26'/'new' — 7 rows from 2026-06-03 (0-4L 0%, 4-8L 5%, 8-12L 10%, 12-16L 15%, 16-20L 20%, 20-24L 25%, 24L+ 30%, the correct Budget 2025 structure, byte-identical to the FY2026-27 row set and matching statutory_config's independently-maintained tds_slab_* fallback rates exactly) vs 6 rows from 2026-07-20 (0-3L/3-7L/7-10L/10-12L/12-15L/15L+, the superseded Budget 2024 structure, mislabeled '2025-26'). Deactivates the 6 stale ids by explicit id list — not a MIN(id)/GROUP BY heuristic like 503_pt_slab_dedup.sql, since the two cohorts disagree on rate_pct/slab_to and a blind pick could keep the wrong one — then adds UNIQUE(financial_year, regime, slab_from, active_status), information_schema-guarded PREPARE/EXECUTE matching 503/1232. Harmless to any number computed so far: salary_prep_run.tds_mode is 100% 'manual' (66/66 runs), so the auto path that reads this table has never executed live. Explicitly approved by the owner after live review of both full cohorts.
  "1245_fix_head_office_cost_centre_branch_mixup.sql", // Undoes an accidental cost-centre reassignment caused by the "Head Office" branch-name collision, and clears one stale close_date. branch_master holds TWO distinct, real, active branches both displaying as a case variant of "Head Office" (HQ = Mumbai, CORP = Noida) — deliberately, per 1115_reactivate_operational_branches.sql, which warns "do not merge branches on name". org.service.ts listActive() dedupes same-named rows to one arbitrary survivor, so the Branch Budget picker silently resolved "Head Office" to Mumbai/HQ; six cost centres activated on 2026-08-19 intending the real Noida/CORP branch landed on HQ instead. Verified wrong against db_bill.cost_master (all six active there under Head Office) and against finance_cost_centre_monthly_driver rows already keyed to CORP from 2026-08-03. Second statement clears close_date=2023-12-30 on BSS/BO/CORP/302, which read active_status=1 but stayed invisible to branch-budget-allocation.service.ts::listActiveCostCentres (close_date IS NULL OR close_date > CURDATE()); the code fix preventing recurrence is in org.service.ts setStatus(). Both UPDATEs are guarded so a re-run matches nothing. Applied to production 2026-08-19 and verified; no DROP, no DELETE, no payroll/tax logic touched.
  "1246_add_computers_26_27_cost_sub_head.sql", // Adds the missing "Computers 26-27 Cost" sub-head under REPAIRS_MAINTENANCE. db_bill.tbl_bgt_expensesubheadingmaster SubHeadingId=119 ("Computers 26-27 COST", HeadingId=9 = Repairs & Maintenance, Status1=1, sub_close_status=1) is live in db_bill but was never mirrored into mas_hrms, so it could not be selected when raising a branch budget. db_bill re-creates this line per fiscal year (COMPUTERS-2020-21 COST ... Computers 25-26 COST, Computers 26-27 COST); mas_hrms never adopted that yearly-vintage pattern, which is why the FY row was absent. Distinct from CAPEX_COMPUTERS ("Computers - Cost") added by 1060_sync_expense_heads_from_db_bill.sql, which consolidates the equivalent rows from db_bill's SEPARATE HeadingId=27 (Repairs & Maintenance Capex) — placement on the plain head was confirmed with the owner, not assumed, since the two heads' yearly sub-head sets look identical at a glance. Defaults mirror its nearest sibling COMPUTER_PERIPHERALS (Device, 18% exclusive, fully recoverable, device_count, opex). INSERT IGNORE against UNIQUE(head_id, sub_head_code)/(head_id, sub_head_name), so a re-run is a no-op. Applied to production 2026-08-19 and verified; additive only.
  "migrations/1304_client_billing_cutover_schema.sql", // Client Billing Historical Cutover Task 1 (2026-08-19, docs/superpowers/plans/2026-08-19-client-billing-cutover.md / docs/superpowers/specs/2026-08-19-client-billing-cutover-design.md §3, §6): adds client_invoice.is_migrated (TINYINT(1) NOT NULL DEFAULT 0) + legacy_id (INT NULL, UNIQUE) and the identical pair on client_credit_note, plus a new throwaway client_invoice_migration_staging table (106 src_-prefixed columns mirroring db_bill.tbl_invoice verbatim, read live off db_bill's information_schema, plus target_id/target_gst_type/target_apply_gst/target_is_migrated and validation_error/validation_status for a later task's dry-run report). Writes zero historical business data — client_invoice/client_credit_note are both 0 rows as of this commit, and the staging table starts empty; the actual ~11,469-row load is explicitly out of scope for this migration and forbidden elsewhere in this plan without separate human sign-off. legacy_id's nullable-unique-index behavior (new rows always insert legacy_id=NULL, so a plain UNIQUE index never blocks ordinary invoice creation) was independently proven live against mas_hrms before this file was written: a throwaway x_nullable_unique_test_<timestamp> table took two legacy_id=NULL inserts successfully while a real duplicate non-NULL value correctly raised ER_DUP_ENTRY, table dropped after — see this task's own report for the exact command/output. information_schema-guarded PREPARE/EXECUTE idiom for both ALTER TABLEs, matching 431/1241/1242 (MySQL 8 does not support ADD COLUMN IF NOT EXISTS as a single clause the way this repo's history already found out the hard way); CREATE TABLE IF NOT EXISTS for the staging table. Every statement in this file was PREPARE-verified (compiled, never executed) against the real live mas_hrms connection before commit — confirmed afterward that neither client_invoice.is_migrated/legacy_id nor client_invoice_migration_staging existed, proving nothing was actually applied. Registered but NOT applied to production as of this commit. UPDATE (Task 2, same day): its two ALTERs DID apply at the next boot (2026-08-19 09:38, executor Work:25124, both columns confirmed live on both tables) but its CREATE TABLE failed for real with "Row size too large... 65535", recorded success=0 — see 1305 immediately below for the fix and root cause.
  "migrations/1305_client_billing_cutover_staging_fix.sql", // Client Billing Historical Cutover Task 2 prerequisite fix (2026-08-19). 1304's CREATE TABLE client_invoice_migration_staging failed live with InnoDB "Row size too large... 65535" (105 src_ VARCHAR columns + 7 target/validation columns sum to ~68,900 worst-case inline bytes, ~3,300 over the ceiling) and is permanently stuck retrying that same failure at every boot per runPendingMigrations.ts's own success=0-is-not-applied governance, since nothing in 1304's unchanged text differs between retries. Fix (independently verified live before commit: reproduced the identical error against a throwaway table carrying 1304's exact columns, confirmed ROW_FORMAT=DYNAMIC alone does NOT fix it, confirmed converting the four widest free-text columns — filepath/eptp_act_remarks/his_eptp_act_date/his_eptp_act_remarks, all originally VARCHAR(1000) and unindexed — to TEXT does, per the error's own "not counting BLOBs" carve-out): recreates client_invoice_migration_staging with those four columns as TEXT, identical otherwise to 1304's declared shape. Also creates client_credit_note_migration_staging (new, not in 1304 — Task 2's own implementer judgment call per the plan: a second table rather than a `kind`-discriminated shared one, since tbl_credit_note's 39 columns barely overlap tbl_invoice's 106 by name or meaning). Does not edit 1304's own file (this repo's established pattern for a migration whose DDL didn't take effect — matches 1116/1128/1211/1217/1218 exactly: a new numbered file re-runs the missing DDL, original left untouched) and does not touch client_invoice/client_credit_note's own schema (1304's ALTERs already succeeded). Both CREATE TABLE IF NOT EXISTS statements are naturally idempotent against 1304's own continued retries — once this file creates the table, 1304's unchanged CREATE TABLE IF NOT EXISTS no-ops and its own schema_migrations row flips to success=1. Applied directly against production 2026-08-19 by this task in addition to being registered here (shared-dev-server auto-apply timing, same reasoning as every migration in this manifest applied ahead of its own registration commit) — verified live: both tables exist, both 0 rows. No DROP, no DELETE, no data migration (that is extract.ts's job, a separate script, not this file).
  "migrations/1306_client_billing_cutover_addendum_columns.sql", // Client Billing Historical Cutover design addendum (2026-08-19, docs/superpowers/specs/2026-08-19-client-billing-cutover-addendum.md A3/A4): adds target_cost_centre_id (CHAR(36) NULL) to both *_migration_staging tables and target_invoice_id (CHAR(36) NULL) to client_credit_note_migration_staging only. A3: holds the resolved cost_centre_master.id for the addendum's own live re-confirmation of unresolved legacy cost_center codes (87 invoice rows unchanged from Task 3's report, 0 credit-note rows) so a later load task does not redo the lookup; stays NULL for the 87 genuinely-unmatched rows (excluded from this cutover pass per A3, never force-mapped). A4: holds the matched invoice's own target_id (its future client_invoice.id) for the 53 of 144 credit notes whose proforma_bill_no uniquely matches a staged invoice's bill_no with agreeing cost centres (re-verified live: 53 resolved / 86 ambiguous / 5 missing, 0 cost-centre disagreements, identical to the addendum's own figures); stays NULL for the other 91. Does not repurpose the existing target_id column (reserved for each staging row's own future primary key) — separate columns, unambiguous meaning. information_schema-guarded PREPARE/EXECUTE idiom, matching 431/1241/1242/1304 (MySQL 8 does not support ADD COLUMN IF NOT EXISTS as a single clause without a silent no-op recorded as applied). Three ALTER TABLEs adding one nullable CHAR(36) column apiece to throwaway staging tables only (client_invoice/client_credit_note/*_line untouched, still 0 rows as of this commit) — no DROP, no DELETE, no FK, no data migration (that is this addendum's own validate.ts UPDATE step, a separate script). Applied directly against production 2026-08-19 (same shared-dev-server auto-apply timing precedent as 1305) — verified live: all three columns exist on their respective tables.
  "migrations/1307_client_billing_cutover_missing_cost_centres.sql", // Client Billing Historical Cutover follow-up (2026-08-19): creates 8 cost_centre_master rows that were billed against in db_bill (tbl_invoice) but never actually created in cost_centre_master — discovered investigating the 87 unresolved cost_centre_id rows in the cutover's validation report. Only the "recent" cluster (18 of the 87 invoice rows, all finance_year 2026-27, sequential-numbered gaps sitting directly next to real active sibling cost centres for the same branch/process/company, e.g. BSS/IB/NOIDA-DD/1028-1033 already exist and are active but 1034-1040 do not); the other 67 (2015-16/2016-17, predating the current cost-centre scheme entirely) are NOT created — no reliable current equivalent exists. Each of the 8 codes references a genuinely distinct real client on its legacy invoice (RARE BASICS, TIC BEVERAGES, AYURVEDA HOUSE, SISHA GREEN TECH, Draco Brands, INTERNETWALE ONLINE SERVICES, Ride Zipo, ONROADS INDIA ASSISTANCE SERVICES — a strong signal these are 8 real billing relationships simply never onboarded, not duplicates or test data). vendor_gst_no left NULL for "Ride Zipo" whose legacy GSTIN is the literal placeholder "0000000000000", not a real number. company_name/branch_id/process_type/stream/cc_category/cc_type copied from each row's real active sibling in the same branch+process family (read live at authoring time); billing_client_name/vendor_gst_no/vendor_gst_state come from each code's own legacy invoice data, not the sibling. Idempotent via an explicit per-row existence check (cost_centre_code has no unique constraint in this schema). Applied directly against production 2026-08-19 with explicit user authorization ("create them") — verified live: all 8 rows exist with active_status=1; the 18 previously-blocked invoice staging rows were then re-resolved and flipped to validation_status='valid', and loaded into client_invoice for real via the same run-load.mjs runner used for the original cutover load.
  "migrations/1308_client_billing_tally_fields.sql", // Client Billing "Tally part" (2026-08-19): adds tally_head/client_tally_name (VARCHAR(255) NULL) to client_invoice and client_credit_note. Legacy db_bill.tbl_invoice froze cost_TallyHead/cost_client_tally_name per invoice at creation time — a real, actively-used accountant reference field (populated 5,483/10,797 and 7,240/10,797 of live legacy invoices), not automated Tally export (grepped every db_bill table for a "tally" column — none exists; this is purely manual-entry reference data, and stays that way here). client_invoice/client_credit_note had no equivalent column, and the 2026-08-19 historical cutover never carried the legacy value forward even though it was already captured verbatim in client_invoice_migration_staging.src_cost_tallyhead/src_cost_client_tally_name (the original 106-column extraction, migration 1304/1305) — this migration adds the columns; a separate one-off UPDATE (not itself a migration, since it targets already-loaded rows rather than schema) backfilled all 10,727 migrated invoices from that existing staging data (5,414/7,239 populated post-backfill, proportionally matching legacy). client_credit_note is NOT backfilled — tbl_credit_note never had a TallyHead column at all; new credit notes going forward resolve it live from cost_centre_master (client-billing-credit-note.service.ts). createProforma/createCreditNote (client-billing.service.ts/client-billing-credit-note.service.ts, same commit) now snapshot cost_centre_master.tally_head/billing_client_name at creation time for every new record, matching legacy's own frozen-snapshot behaviour rather than a live join. information_schema-guarded PREPARE/EXECUTE idiom, matching every prior migration in this module. Two nullable VARCHAR(255) columns on tables holding real data (client_invoice=10,727 rows, client_credit_note=139 rows) — zero backfill cost from the ALTER itself. Applied directly against production 2026-08-19 with explicit user authorization — verified live: all 4 columns exist, backfill counts confirmed exact.
  "migrations/1309_client_billing_unmapped_legacy_cost_centre.sql", // Client Billing Historical Cutover final resolution (2026-08-19): creates ONE explicitly-flagged placeholder cost_centre_master row (LEGACY-UNMAPPED-VODAFONE-2015-17) so the 67 remaining unresolvable invoices (2015-16/2016-17, predating the current cost-centre numbering scheme) can load and become visible instead of sitting invisible in staging indefinitely. NOT a guess at the specific historical cost centre — that was tried (client+branch+process-family matching, 7 of 10 legacy codes resolved to exactly one candidate) and explicitly rejected after a date-continuity check disproved it: the candidate for CM/FLD/KNL/036/037 turned out to have its own invoices dated the same week in Nov 2015 as the rows being matched to it, proving they were concurrently-active DIFFERENT cost centres for the same client/branch/process, not one renamed into the other. What IS known with certainty (all 67 rows are the same client, Vodafone Mobile Services Ltd., confirmed live) is stated honestly in the placeholder's own billing_client_name; which specific sub-team is stated as explicitly UNKNOWN rather than guessed. active_status=0/status='closed' — never a target for a new invoice going forward. Each invoice's own tally_head/client_tally_name (migration 1308) was already correctly backfilled independent of cost_centre_id. Applied directly against production 2026-08-19 with explicit user authorization ("handle it") — verified live: placeholder row exists, all 67 rows resolved and loaded (client_invoice now 10,794 rows). Separately (same session, not its own migration — targets already-loaded staging rows, not schema): the 5 remaining unresolvable credit notes were resolved for real using evidence found in their own free-text description field (which named the actual invoice for 3 of 5; the other 2 matched via cost-centre+amount+month agreement to the same invoice) — credit-note staging now 144/144 valid, client_credit_note fully loaded at 144 rows, 0 broken invoice_id FKs.
  "1248_grn_dbbill_migration_schema.sql", // Schema prep for the db_bill -> mas_hrms GRN/vendor/imprest migration: adds 'salary' to grn_request.grn_type ENUM, bill_source_id traceback column on grn_request/vendor_payment_tracking/imprest_allocation, creates grn_migration_branch_map (hard-coded db_bill BranchId -> mas_hrms branch_master UUID lookup, verified 2026-08-19) and a blocked MIGRATION_SYSTEM auth_user sentinel used as created_by for migrated rows. information_schema-guarded throughout. Applied out of band; verified live 2026-08-20: grn_type has 'salary', all three bill_source_id columns exist, grn_migration_branch_map exists, sentinel user exists.
  "1250_cost_centre_transfer_support.sql", // Adds cost_centre to transfer_type ENUM on transfer_record; adds new_reporting_manager_id CHAR(36) NULL column for compound CC+RM transfers. Idempotent: ENUM ALTER is safe to re-run (MySQL no-ops duplicate enum values); column add is guarded by INFORMATION_SCHEMA.
  "1251_pnl_snapshot_cc_unique_key.sql", // Updates pnl_running_salary_snapshot unique key from (period_code, employee_id) to (period_code, employee_id, cost_centre_id), enabling multiple apportioned rows per employee per period when a mid-month cost centre transfer occurs. Idempotent: drops old key only if present, adds new key only if absent.
  "1500_wfm_roster_import_engine.sql", // Creates wfm_shift_alias, wfm_roster_import_batch, wfm_roster_import_row, wfm_header_mapping_profile, wfm_rta_exception tables; extends roster_change_log with amendment_reason/is_late_change/lead_time_hours/old_assignment_type/new_assignment_type/old_shift_id/new_shift_id; adds planning_mode to process_master. All CREATE TABLE IF NOT EXISTS; all ALTER uses ADD COLUMN IF NOT EXISTS.
  "1503_wfm_roster_assignment_import_columns.sql", // Adds assignment_type/lifecycle_state/import_batch_id to wfm_roster_assignment for the WFM import engine (roster-import.service.ts). ADD COLUMN IF NOT EXISTS throughout; adds idx_wra_lifecycle and idx_wra_import_batch.
  // Merge conflict left unresolved in the working tree (HEAD side empty, this
  // block from 6ea8ea5b) resolved 2026-08-20 while registering 1504 below —
  // all 4 files above already existed on disk and appeared nowhere else in
  // this manifest, so kept as a clean "both sides wanted this" resolution.
  "1252_kpi_role_template_metrics.sql", // Loads 70 kpi_metric_master rows (definitions only — this file does not touch kpi_master_config or process_master) for a real HR/Ops-sourced role-based KPI target-setting spreadsheet (10 role templates: Admin, Process Manager, 3 Team Leader variants, Assistant Manager, Quality Analyst, Trainer, HR Recruiter, HR Executive/Sr Executive/Operations). family='custom'/category='custom' throughout — a standalone role-template set, not merged into the existing generic operational catalog. scoring_type is set explicitly (not left NULL) for every lower-is-better metric, since calculateMetricScore() treats a NULL scoring_type as a plain higher-is-better ratio regardless of the `direction` column — leaving it NULL on e.g. Attrition/Shrinkage would have silently inverted the score. scoring_type='boolean' used for every KPI whose only given target is a bare 1, confirmed live to have a working boolean-scoring branch (actual=1 -> 100, actual=0 -> 0) before relying on it. 7 metrics are shared/reused across multiple role configs (SELF_ATTENDANCE_BOOLEAN, ACPT_AUDITS, ZTP_AUDITS, GPI_SHRINKAGE, GPI_ATTRITION_LT10, GPI_CLIENT_SATISFACTION_ESCALATION, COST_CONTROL_ALL_ASPECTS) — one metric row, several kpi_master_config assignments, the schema's own designed-for pattern. Applied directly against production 2026-08-19 with explicit owner authorization after live review of the exact designation mapping, target/weightage conversion and every open item (2 name-inferred designations, the 100%-default convention for unquantified compliance-style KPIs, and 2 templates accepted at partial 75% weight pending real targets for the remaining unquantifiable items) — verified live via a rolled-back dry-run transaction before the real apply, then re-verified post-apply: kpi_metric_master at 93 rows (23 pre-existing + 70 new). The accompanying kpi_master_config rows (59, weightage-sum-validated per role/scope) and the Finfort process_master reactivation were applied in the same session as pure data, not part of this migration file. "Team Leader (Paytm)" and "Account Manager"/"HR Payroll" (no matching live process/designation) deliberately excluded; "HR Executive/Sr Executive/Operations" groups loaded as metric definitions only (no numeric target anywhere in the source for any of their 7 groups, so no config row could be assigned).
  "1504_leave_encashment_rate_config.sql", // F&F Phase 1 compute engine (ff-compute.service.ts): INSERT IGNORE seeds the leave_encashment_day_divisor statutory_config key INACTIVE (is_active=0) — a placeholder value only, so the key is discoverable but leave-encashment stays pending_configuration until a payroll owner reviews and activates a real approved divisor. No guessed rate is live from this migration alone.
  "1505_leave_encashment_tax_exemption_config.sql", // F&F Phase 2 TDS true-up (ff-compute.service.ts's resolveTdsTrueUp): INSERT IGNORE seeds leave_encashment_tax_exemption_limit statutory_config key INACTIVE (is_active=0) — placeholder only. Until reviewed/activated by the payroll/tax owner, the true-up treats leave encashment as fully taxable (conservative default), never guessing a s.10(10AA) exemption figure.
  "1506_exit_clearance_task_missing_migration.sql", // Reconstructs exit_clearance_task's missing CREATE TABLE — the table has been live in production and read/written by 20+ files (exit-intelligence.service.ts, exit.routes.ts, ff-approval-guard.compat.routes.ts, reporting adapters) with no CREATE TABLE anywhere in sql/, only its column list surviving in schema-snapshot.json. CREATE TABLE IF NOT EXISTS, structure copied verbatim from SHOW CREATE TABLE against production 2026-08-20 (same columns/enums/indexes, no FKs — matching the live table, which has none either).
  "1501_apr_multi_server_config.sql", // Seeds 3 GPI VICIdial server configs (apr_server_gpi01/gpi02/gpi5) into integration_config for apr-vicidial-sync.worker.ts, INACTIVE (active_status=0) with no credentials — those go through the encrypted external-DB credential screen separately. Plain INSERT ... ON DUPLICATE KEY UPDATE, no ALTER, no syntax issue. Applied out of band; verified live 2026-08-20: all 3 rows exist.
  "1502_apr_source_column.sql", // Adds source ENUM('sync','manual')/uploaded_by/upload_batch_id to apr, plus idx_apr_source — lets a manual upload be protected from being silently overwritten by the sync workers. Already correctly information_schema-guarded. Applied out of band; verified live 2026-08-20: all 3 columns + index exist.
  "1507_roster_daily_assignment_updated_at.sql", // Adds roster_daily_assignment.updated_at (DATETIME, DEFAULT/ON UPDATE CURRENT_TIMESTAMP, matching created_at's own type). roster.governance.service.ts's shift-reassignment path (Task 11 amendment workflow, commit 1ab6cbae) writes `updated_at = NOW()` against a column that has never existed — confirmed live before this migration: 0 such columns, every reassignment call throwing ER_BAD_FIELD_ERROR. Applied live 2026-08-20 with explicit approval; verified: column exists with the correct type/default.
  "1508_noida_cost_centre_status_sync.sql", // Syncs Noida branch cost centre active/inactive status against a user-provided master list of 15 active cost centres (2026-08-20).
  "1509_itc_blocked_sub_heads.sql", // Sets default_recoverable_tax_pct=0 on ITC-blocked sub-heads (cafeteria, R&R, promotional gifts per GST Act S.17(5)) so GRN allocations against those lines use gross amount as P&L cost when vendor bills with GST.
  "1510_wfm_roster_builder_page.sql", // Registers WFM_ROSTER_BUILDER page code and grants to wfm/admin/super_admin
  "1510_cost_centre_legacy_parity.sql", // Adds legacy parity fields to cost_centre_master (additional address lines and other db_bill.cost_master fields missing from HRMS2).
  "1511_grn_legacy_identity_columns.sql", // Adds grn_request.legacy_raised_by_name/legacy_approved_by_name/legacy_rejected_by_name (nullable VARCHAR labels, not FKs) — migrate-grn-from-dbbill.ts never captured who raised/approved/rejected any of the 84,767 legacy rows beyond a migration sentinel user, so History/Approval Queue showed those blank. db_bill's approved_by_ph/approved_by_fh verified never populated across full history (single flat approval stage only), so one legacy_approved_by_name column, not a branch/finance split. information_schema-guarded PREPARE/EXECUTE (MySQL 8 ADD COLUMN IF NOT EXISTS gotcha, matching 1304). Applied out of band 2026-08-20 (deploys blocked by 1500); verified live: all 3 columns exist.
  "1512_grn_unbudgeted_allocation_nullable.sql", // Makes grn_cost_allocation.budget_id/budget_line_id NULLABLE. saveInvoiceComponents() has always built synthetic `{id: null, budget_id: null}` lines when isUnbudgeted is true and then INSERTed them into two NOT NULL columns, so an unbudgeted vendor GRN could only ever die with ER_BAD_NULL_ERROR (1048) - one of five breaks that made the half-built unbudgeted path unreachable end to end. Verified live 2026-08-20: 0 of 84,782 grn_request rows have is_unbudgeted = 1 and 0 of 38 grn_cost_allocation rows have a NULL budget line, so no existing row changes meaning and there is nothing to backfill. Both foreign keys survive MODIFY COLUMN untouched and still constrain every non-NULL value. Purely a nullability relaxation - no DROP, no DELETE, no UPDATE, and guarded on information_schema so re-running is a no-op.
  "1513_roster_decision_audit_run_nullable.sql", // Makes roster_decision_audit.run_id NULLABLE. All four manager-review actions write an audit row with COALESCE(generation_run_id,''), but run_id is NOT NULL with an FK to roster_generation_run(id) - and roster_generation_run holds 0 rows while ALL 413,386 wfm_roster_assignment rows have generation_run_id NULL, so the INSERT always died on ER_NO_REFERENCED_ROW_2 and every manager action returned 500. Reproduced live: an employee rejection reaches pending_manager_action and the manager queue, then nothing can clear it and the cycle sticks forever. Nullable rather than dropping the FK or skipping the audit, so the decision stays auditable; non-NULL values remain constrained. Verified live: roster_decision_audit has 0 rows, nothing to backfill. information_schema-guarded MODIFY (no MODIFY COLUMN IF EXISTS on MySQL 8).
  "1513_bi_revenue_snapshot.sql", // BI revenue snapshot tables mirroring db_bill.dashboard_target_revenue and db_bill.dashboard_data_revenue so bi.service.ts no longer live-reads db_bill for CEO/management dashboards.
  "1514_reimbursement_multilevel_approval.sql", // Adds multi-level approval (manager → branch head) to employee_reimbursement_claim: branch_id, manager/branch_head review columns, GRN conversion tracking (converted_to_grn_id/at/by), attachment columns. Also adds source_reimbursement_id to grn_request for traceability. Idempotent ADD COLUMN guards.
  "1515_branch_master_company_name.sql", // Adds branch_master.company_name (nullable VARCHAR) for GST export and reporting to identify the legal entity a branch belongs to without a separate join. information_schema-guarded.
  "1520_gst_export_staging.sql", // Two NEW tables (gst_export_batch / gst_export_row) replacing db_bill.tbl_tally_row_invoice_data, which was 34 varchar(100) columns with its own spreadsheet header row stored as data, no period scoping and no validation. Batches are materialised and frozen per (export type, OUR GSTIN, period) so a filed return stays reproducible; regeneration supersedes rather than mutates. Rows that cannot legally be filed are still written, flagged validation_status=exception with machine-readable reasons, so Finance gets a worklist instead of a silently short return. Purely additive - two CREATE TABLE IF NOT EXISTS, no existing table/column/row/query touched. Explicit COLLATE utf8mb4_unicode_ci on every char(36) FK column (auth_user.id verified live) - a new table under a different default collation cannot FK to it and MySQL never mentions collation in the error.
  "1521_capex_software_freight_sub_heads.sql", // Adds CAPEX_SOFTWARE sub-head under REPAIRS_MAINTENANCE_CAPEX (for legacy Computer Software Cost year-versioned entries) and a new FREIGHT_CARGO head + sub-head (legacy Freight & Cargo Charges). The 457 unresolved vendor→head/subhead triples from 1092 include these two missing targets; vendor-level mappings must be added manually via the Vendor Management Expense Mapping tab since db_bill vendor codes are not available for auto-resolution. All INSERTs are idempotent (INSERT IGNORE / NOT EXISTS guards).
  "1522_bulk_regularization_uploads.sql", // Bulk upload with branch-head approval for attendance regularization / leave / incentive / deduction. Rows land in the SAME tables the manual single-employee flows write (attendance_regularization, leave_request, incentive_upload_batch+line, employee_deduction_entries) in their normal pending state, and are applied by the SAME domain engines on approval, so leave balances deduct and attendance records change through the existing rules rather than a second implementation. Adds 'pending_approval' to employee_deduction_entries.status (the only one of the four with no pending state; payrollCalculate.service.ts:1488 filters status='active' so pending rows are invisible to payroll until approved), an approval stage on upload_batch, entity linkage on upload_batch_row, and bulk_upload_locked_entity which discard.service.ts consults to make an approved bulk row non-removable. Additive only: one append-only enum widening, six nullable columns, one new table, four upload_template_master rows with live-verified sample codes. information_schema-guarded PREPARE/EXECUTE (MySQL 8 has no ADD COLUMN IF NOT EXISTS).
  "1523_branch_budget_drop_accounts_head_stage.sql", // Owner decision 2026-08-21: Account Head approval is not required to create/activate a branch budget. branch-budget.service.ts REVIEW_STAGES was collapsed in the same release to 2 stages (Branch Head, then Finance Head as terminal approver straight to 'active'). Data-only migration: advances the one live budget stuck at status='finance_head_approved' (id 404c4f60-eecf-458f-8797-6df75eff3560, verified live 2026-08-21) to 'active', crediting the Finance Head's own actor/timestamp into accounts_head_approved_by/at rather than inventing a system actor, and writes one guarded finance_budget_approval_log row (action SYSTEM_ADVANCE) so the jump is auditable. No schema change — finance_budget_header.status keeps 'accounts_head_approved' in its ENUM for history; accounts_head remains a valid role for unrelated finance workflows (GRN reversal, budget transfer, P&L signoff). Idempotent — NOT EXISTS-guarded INSERT, UPDATE only matches rows still at the old status.
  "1524_budget_topup_direct_apply.sql", // Owner decision 2026-08-21: Finance Head (+ super_admin) may increase an active budget line directly, bypassing the 2-stage branch_head->finance_head top-up request/review flow. budgetTopupService.directApply() inserts a finance_budget_topup_request row already at status='applied' (review columns pre-filled to the acting Finance Head) so it shows up for free in the existing top-up history/queue and audit plumbing. Adds is_direct TINYINT(1) NOT NULL DEFAULT 0 so a direct increase is visibly distinct from a fast-approved bottom-up request — both end at status='applied' otherwise. Purely additive, DEFAULT-backed, information_schema-guarded ADD COLUMN (MySQL 8 has no ADD COLUMN IF NOT EXISTS).
  "1530_vendor_approval_request.sql", // Adds vendor_approval_request table: branch admins and finance heads can raise a vendor create/update request; finance head reviews and approves/rejects with optional field corrections. Vendor is written to vendor_master only on approval.
  "1531_capex_pnl_treatment_fix.sql", // Sets pnl_treatment='excluded' on all CAPEX sub-heads (capex_opex='capex'). CAPEX items are balance-sheet additions and must not be included as period expenses in the P&L revenue-cost model.
  "1532_finance_masters_page_access.sql", // Registers FINANCE_MASTERS page (/finance/masters) in page_catalog. Grants super_admin and finance_head full write access; branch_admin view-only.
  "1534_budget_subhead_business_case_closure.sql", // Owner requirement 2026-08-21: monthly business-case close/reopen per head/sub-head. Branch Admin and Finance Head may close a (budget, head, sub-head) directly — no approval needed to close. Reopening a closed one requires Finance Head approval via finance_budget_closure_reopen_request (single-stage, unlike the 2-stage top-up chain). New table finance_budget_subhead_closure is keyed (budget_id, head, sub_head) — sub_head NOT NULL DEFAULT '' rather than nullable, since MySQL treats every NULL as distinct in a UNIQUE index and would let two rows share the same head with a NULL sub_head. Deliberately separate from finance_period_lock (company-wide, period-only, no head/sub-head) and finance_budget_subhead_status (pre-spend planning intent, advisory-only, set once). Purely additive, two new tables, no existing table touched.
  "1535_job_requisition_raised_template.sql", // Seeds the communication_template row (name='job_requisition_raised', category='alerts') read by notifyRequisitionRaised() in job-requisition.service.ts. Feature ships disabled by default (JOB_REQUISITION_RAISED_EMAIL_ENABLED=false) and independently requires branch_notification_recipient rows configured via /settings/provisioning-recipients before anything sends.
  "1536_wfm_roster_import_branch_scope.sql", // Whole-branch roster upload. process_id on wfm_roster_import_batch was NOT NULL with a straight FK to process_master(id), forcing every upload to name one process even though createImportBatch has matched employees purely by globally-unique employee_code since 2026-08-20 (processId already optional at the application layer). Relaxes process_id to NULL and adds branch_id (FK to branch_master(id), same utf8mb4_unicode_ci collation trap as 1500_wfm_roster_import_engine.sql) so a batch can be filed under a branch instead of a single process. CHECK constraint requires at least one of process_id/branch_id so getMissingEmployees always has something to scope against. No existing row changes — 0 batches have NULL process_id today (verified live 2026-08-21).
  "1537_annual_budget_summary_page_access.sql", // Registers FINANCE_ANNUAL_BUDGET_SUMMARY (/finance/annual-budget-summary) in page_catalog + role_page_access (super_admin/admin/finance_head/accounts_head, view+export only). File existed on disk since 2026-08-21 but was never added to this manifest, so it never ran on any environment and the page (backend service+route already live, frontend page component already written) stayed unreachable — WorkforcePageGate denies everyone with no role_page_access row for the code. Added 2026-08-22 alongside the frontend route/nav wiring that depends on this grant existing. Purely additive.
  "1538_asset_material_exit_pass.sql", // Phase 1 of Asset & Material Exit Pass (IT & Admin): create -> Branch Head approval -> Admin approval -> printable pass. New tables exit_pass_requests/exit_pass_items/exit_pass_approvals/exit_pass_audit_logs, FKs to employees(id)/branch_master(id) with matching utf8mb4_unicode_ci collation. Registers ASSET_EXIT_PASS in page_catalog with role_page_access for super_admin/admin/it_head/it/branch_admin/branch_head/wfm (role_key values verified live 2026-08-21; wfm added per owner request 2026-08-21, not executed live yet so edited in place rather than a follow-up migration). Security guard verification, return tracking, exports and notifications are later phases — not touched here. Purely additive, no existing table touched.
  "1539_exit_pass_exit_verification.sql", // Phase 2 of Asset & Material Exit Pass: security guard exit verification. Adds exit_verified_by/exit_verified_at/exit_gate/exit_verification_method to exit_pass_requests (all nullable) so an 'approved' pass can record that the item actually left — status only ever moves approved -> exit_verified in this phase. Registers ASSET_EXIT_PASS_VERIFY page_catalog entry + role_page_access for super_admin/admin/it_head/branch_admin/security_head/visitor_security/it/wfm (it/wfm added per owner request 2026-08-21, not executed live yet so edited in place). Return tracking, overdue and live QR token validation remain later phases. Purely additive columns on a table this project itself created in 1538.
  "1540_exit_pass_return_tracking.sql", // Phase 3 of Asset & Material Exit Pass: return verification + overdue. Adds return_verified_by/_at/return_remarks to exit_pass_requests and has_damage/missing (item-level) to exit_pass_items. A returnable pass now flows approved -> outside_premises -> closed; non_returnable closes the moment exit is verified (application-code change alongside this migration, not a schema change). Overdue is derived at read time from expected_return_at, not a stored status. Purely additive columns on two tables this project itself created in 1538/1539.
  "1541_add_call_centre_code_index.sql", // Adds ADD INDEX IF NOT EXISTS idx_call_centre_code on employees.call_centre_code so kpi-data-connector.service.ts can resolve MasId identifiers from call_quality_assessment/CallDetails in O(1). Idempotent on MySQL 8.0+. No column changes.
  "1541_payroll_head_salary_review.sql", // Payroll Head mandatory salary/journey review gate. New employee_payroll_head_review (one row per employee, UNIQUE on employee_id) starts pending_review; employee-creation-orchestrator.service.ts inserts it in the same transaction that already creates employee_salary_assignment. payrollCalculate.service.ts gets ONE additive NOT EXISTS clause on empConds excluding any employee with a non-approved row -- employees created before this ships have zero rows, so the clause is vacuously true for all ~58,840 of them; no backfill written or needed. Also adds payroll_head_review_reason_master (category+code lookup, mirrors attendance_reason_master), an index on salary_component_assignments(employee_id,status,effective_date) -- that table already has an unpopulated employee_id column this feature is the first live writer of -- a payroll_config_flags kill switch (payroll_head_review_gate_enabled), and page_catalog/role_page_access rows for the two new payroll_head screens. Purely additive, no existing table's columns changed.
  "1542_payroll_head_review_hardening.sql", // Hardens the 1541 gate after an end-to-end rethink pass surfaced: (1) branch_head/payroll_hr/hr had zero page/route access to the detail page their rejection notifications link to -- adds their role_page_access grants on PAYROLL_HEAD_SALARY_REVIEW_DETAIL (frontend route roles + rbacPageMatrix.ts updated alongside, not in this migration); (2) no audit trail of who did what when -- new employee_payroll_head_review_history table, one row per approve/reject/resubmit/reopen; (3) no correction path once approved -- adds reopened_at/reopened_by/reopen_reason/reopen_count columns to employee_payroll_head_review via conditional PREPARE/EXECUTE ADD COLUMN (idempotent, checks information_schema.COLUMNS first). Purely additive.
  "1543_roster_import_row_absent_status.sql", // wfm_roster_import_row.normalized_type ENUM never included 'ABSENT' (added to AssignmentType in assignment-normalizer.service.ts, c1cc4943, for LWP/"Left" — deliberately not LEAVE, which is cross-checked against an approved leave_request and neither carries one). Every PATCH of such a row failed "Data truncated for column 'normalized_type'" until this ran. wfm_roster_assignment.assignment_type (committed side) is VARCHAR(50), unaffected. Idempotent MODIFY COLUMN, same pattern as 435_bgv_check_type_name_match.sql.
  "1544_team_attendance_manager_access.sql", // TEAM_ATTENDANCE page_code was never granted to manager, process_manager, tl, team_leader, assistant_manager or branch_head — the exact roles its nav entry, its route guard and its own API's requireRole list all name as intended users. Verified live 2026-08-22: only branch_qa/branch_wfm/qa/super_admin/tq_head/wfm had a role_page_access row, locking out 79 real manager-tier logins with "Access Denied". can_view (+can_export) only, matching the grant shape already used for the roles that did have it. rbacPageMatrix.ts updated alongside so demo credentials and any code deriving page lists from it match. Purely additive.
  "1545_manager_raised_request.sql", // New manager_raised_request table backing "raise leave for my report" on the Team Attendance page: a manager/TL-initiated leave request sits here as pending_employee_consent until the employee themself approves or declines it — only on approval does it materialize into a normal leave_request row via the existing leaveService.submitRequest(), so leave_request's own status machine and balance/eligibility validation are untouched. request_type is generic on purpose for future on-behalf request kinds beyond leave. Purely additive (new table only).
  "1547_upload_deduction_qual_incentive_snapshots.sql", // New snapshot tables upload_deduction_snapshot and qual_incentive_snapshot mirroring db_bill source tables for report reconciliation. Purely additive (two new tables, no existing tables touched).
  "1546_mira_action_audit_log.sql", // New mira_action_audit_log table backing Mira's write-capable chat actions (draft-then-confirm leave request, mira-leave-action.service.ts). Append-only lifecycle trail (drafted/confirmed/rejected/submitted/failed/cancelled) distinct from ai_prompt_audit_log (question-hash only, no payload) and from 1545's manager_raised_request (that one is cross-person with an employee-consent inbox flow; this one is same-user, same-chat-turn confirmation, so no consent_status machine or notification). Purely additive (new table only).
  "1548_unlinked_grn_review_page_access.sql", // Registers FINANCE_UNLINKED_GRN_REVIEW (/finance/unlinked-grn-review) in page_catalog + role_page_access (super_admin/admin/finance_head/accounts_head, view+export only). Added alongside the frontend route/nav wiring in the same commit this time — see the annual-budget-summary lesson (migration 1537 existed on disk for a day before anyone added it to this manifest, leaving the page unreachable). Purely additive.
  "1549_manager_wfm_quality_dashboard_access.sql", // Grants manager role view access to WFM_DASHBOARD and QUALITY_DASHBOARD in role_page_access. Matches dashboardAccessRegistry.ts allowedRoleKeys — both gates must agree. Reactivates an existing QUALITY_DASHBOARD row (active_status=0 from 2026-07-25 RBAC cleanup) and adds the missing WFM_DASHBOARD grant. Purely additive (INSERT ... ON DUPLICATE KEY UPDATE, no schema changes).
  "1550_budget_topup_cost_centre_split.sql", // Group D: extends budget Top-up (1061/1524) with cost-centre splits and brand-new budget-line requests. Makes finance_budget_topup_request.budget_line_id NULLable (a new-line request has no existing line to point at) and adds is_new_line/head/sub_head/unit/unit_rate (all NULL-default; every existing row gets is_new_line=0 and stays exactly as it reads today). New table finance_budget_topup_request_split (topup_request_id, cost_centre_id, amount, quantity) mirrors finance_budget_line_allocation's own convention (no FK to cost_centre_master). Purely additive/nullability-relaxing, information_schema-guarded ALTERs + CREATE TABLE IF NOT EXISTS, matching 1524's pattern exactly.
  "1551_payroll_branch_readiness_leave_regularization.sql", // Adds leave_finalized/leave_finalized_at/leave_finalized_by and regularization_complete/regularization_complete_at/regularization_complete_by to payroll_branch_readiness. payroll-branch-readiness.service.ts has referenced these in its scoring and UPSERT since the columns were added to its CREATE TABLE DDL, but the table pre-existed (migration 400) so they were never created. Without them every UPSERT silently drops these two readiness signals and the scoring logic evaluating them always reads 0. information_schema-guarded, purely additive.
  "1552_employee_salary_assignment_updated_at.sql", // Adds employee_salary_assignment.updated_at DATETIME NULL. payroll-head-review.service.ts sets updated_at = NOW() on every salary-package confirmation but the column was never created; the UPDATE caught the ER_BAD_FIELD_ERROR and logged a warning on every call. information_schema-guarded, nullable (existing rows read NULL), purely additive.
  "1553_salary_prep_line_component_notes.sql", // Adds salary_prep_line_component.notes TEXT NULL. salary-dispute.service.ts inserts a notes value when creating arrear adjustment lines for resolved disputes; the INSERT has always failed with ER_BAD_FIELD_ERROR, meaning no dispute arrear has ever been written to salary_prep_line_component. information_schema-guarded, TEXT NULL, no existing row touched, purely additive.
  "1554_workforce_mandate_alert_threshold.sql", // Adds alert_threshold_pct DECIMAL(5,2) DEFAULT 80.00 to workforce_mandate. Required by hc-gap-alert.cron.ts daily job — fires when coverage_pct drops below this threshold. ADD COLUMN IF NOT EXISTS, backward-compatible; existing rows default to 80%.
  "1555_attrition_record_inference_columns.sql", // Adds inferred_reason VARCHAR(50), inference_confidence ENUM('HIGH','MEDIUM','LOW'), inference_signals JSON to attrition_record. Required by attrition-reason-inference.service.ts to persist inference results. All columns NULL-default, ADD COLUMN IF NOT EXISTS, purely additive.
  "1556_employee_retention_recommendation.sql", // Creates employee_retention_recommendation: stores rule-based retention action recommendations generated by intervention-recommendation.service.ts per employee. Tracks risk_tier, prediction_score, recommendations JSON, action_taken, outcome. CREATE TABLE IF NOT EXISTS, InnoDB utf8mb4, purely additive.
  "migrations/1558_helpdesk_ticket_raised_by.sql", // Adds helpdesk_ticket.raised_by_user_id + resolved_by_user_id (both CHAR(36) NULL, no FK, matching assigned_to on the same table) and idx_helpdesk_ticket_raised_by. The maker/checker pair for the separation-of-duties guard added to POST /tickets/:id/resolve in the same commit: helpdesk had no occurrence of "maker" or "checker" anywhere, so one holder of one HELPDESK_ADMIN_ROLES role could raise a ticket on behalf of an employee, self-assign it via /take and resolve it, with the acting user surviving only in sensitive_action_log's change_summary JSON — telemetry that writeSensitiveActionLog is explicitly allowed to drop. No backfill: helpdesk_ticket holds 4 rows, all INSERTed in the same second on 2026-06-01 (seed data), and module_key='HELPDESK' in sensitive_action_log has only TICKET_ASSIGNED (3) and TICKET_ESCALATED (1) — TICKET_CREATED/TICKET_RESOLVED/TICKET_TAKEN have never been written, so no ticket has ever gone through this API. Those 4 rows keep raised_by_user_id NULL and the guard treats NULL as "raiser unknown" and lets the resolve through rather than inventing a failure on rows that predate the column. information_schema-guarded PREPARE/EXECUTE, not ADD COLUMN IF NOT EXISTS (unsupported on MySQL 8; this repo has recorded migrations applied while their DDL did nothing — see 1304/1305). Collation stated explicitly: helpdesk_ticket and auth_user are both utf8mb4_unicode_ci, verified live 2026-08-24. Additive and idempotent; registered but NOT applied by hand — applies at the next backend restart like every other manifest entry.
  "1557_branch_sal_code_from_db_bill.sql", // Adds sal_branch_code VARCHAR(30) NULL to branch_master (salary/establishment code from db_bill Sal_Branch_Code). Backfills sal_branch_code, address, and company_name for all 24 db_bill branches, matched by branch_code. All UPDATEs idempotent (only sets where NULL). Source: db_bill.branch_master verified 2026-08-24.
  "migrations/1601_bank_penny_drop_verification_token.sql", // Adds verification_token (UNIQUE VARCHAR 64), verification_token_expires_at, employee_name_at_request, name_match_tier, name_match_score to bank_penny_drop_log. Supports the employee bank-change penny drop email flow: a secure one-time token is emailed to Payroll Branch on submission; clicking the link triggers a live Luckpay penny drop and classifyNameMatch() comparison; results stored here and surfaced in the Payroll HO approval queue. Extends penny_drop_status ENUM with 'name_mismatch'. All column additions are information_schema-guarded. Additive only — no existing rows or values changed.
  "migrations/1602_payroll_loans_rbac_restore.sql", // Reactivates role_page_access rows for page_code='PAYROLL_LOANS': payroll_head and hr were active_status=0 (revoked), admin and finance_head had no row at all — leaving Loan Management's approval queue reachable only by super_admin in practice, out of sync with the frontend's own canApproveLoans gate. UPDATE + INSERT...WHERE NOT EXISTS, idempotent. Applied against production 2026-08-25 with explicit user approval as part of the payroll audit fix plan (Batch 3 Phase 1, Track 2); registered here so it also applies cleanly on any other environment.
  "migrations/1603_loan_negative_pending_cleanup.sql", // Clamps employee_loans.pending_amount to 0 for the 11 rows that were negative — legacy-import artifacts the app's own record-payment handler could never produce (it already clamps at Math.max(0, pending - paid)). Idempotent (WHERE pending_amount < 0 matches nothing once applied). Run via scripts/loan-negative-pending-cleanup.ts --apply, not this raw UPDATE directly, so a logSensitiveAction row is written per loan first — 11 rows confirmed in sensitive_action_log (action_type 'loan_negative_pending_cleanup'). Applied against production 2026-08-25 with explicit user approval, same fix plan as 1602.
  "migrations/1604_employee_performance_daily_snapshot.sql", // Foundation table for the Employee Performance Scorecard feature (Task 1 of that plan) — creates employee_performance_daily_snapshot (employee_id/snapshot_date grain, attendance/late/leave/PIP/quality/template_metrics/team attrition-shrinkage-revenue columns). Nothing in the codebase reads or writes this table yet; later tasks in the same plan populate and consume it. employee_id VARCHAR(36) COLLATE utf8mb4_unicode_ci matches employees.id (char(36) COLLATE utf8mb4_unicode_ci, verified live via SHOW CREATE TABLE employees 2026-08-25) with an FK to employees(id). Task brief specified migration number 1558 assuming 1557 was the highest existing entry; live manifest already had 1558-1603 registered by other concurrent sessions, so this was numbered 1604 (next free number) instead, and filed under sql/migrations/ (the subfolder every entry from 1558 onward actually uses) rather than the brief's literal sql/ root path. Purely additive, CREATE TABLE IF NOT EXISTS, no existing table touched.
  "migrations/1605_deactivate_dangling_payroll_disbursal_grant.sql", // Deactivates the 2 remaining active role_page_access rows for page_code='PAYROLL_DISBURSAL' (finance_head, super_admin — finance and payroll_head were already inactive). The page this code once gated, src/pages/payroll/DisbursalManagement.tsx, was deleted as confirmed dead code in the same change: unrouted since PaymentDisbursalCenter.tsx absorbed its functionality on 2026-08-23, and /payroll/disbursal has redirected to /payroll/payment-center?tab=disbursal (gated on PAYROLL_BANK_READINESS instead) ever since. Soft-deactivate, not delete, matching this table's existing convention. Idempotent. Batch 3 Phase 4 of the payroll audit fix plan; applied against production 2026-08-25 with explicit user approval. Numbered 1605 (not 1604 — a concurrent session took that number between this file being written and the manifest being regenerated).
  "migrations/1607_performance_scorecard_page_catalog.sql", // Task 8 of the employee-performance-scorecard plan: registers PERFORMANCE_SCORECARD_COMMAND_CENTER in page_catalog and seeds its role_page_access grants (can_view only) for the 16 roles in PERFORMANCE_SCORECARD.allowedRoleKeys (backend/src/shared/dashboardAccessRegistry.ts, read live 2026-08-25) — manager, process_manager, assistant_manager, branch_head, branch_manager, team_leader, tl, hr, hr_admin, ho_hr, branch_hr, process_hr, ceo, coo, management, super_admin. admin and wfm deliberately excluded per the 2026-08-22 incident in backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts. Consumed by WorkforcePageGate in a later frontend task in the same plan. Numbered 1607 (1606 was already taken on disk by a concurrent session's normalize_component_names migration, not yet registered in this manifest at the time of writing). Purely additive, WHERE NOT EXISTS idempotent, no existing table touched.
  "migrations/1608_salary_dispute_arrear_pending_status.sql", // Adds 'arrear_pending' to salary_dispute.status (MySQL ENUM). applyArrear() (salary-dispute.service.ts) previously wrote 'closed' unconditionally once a dispute was approved, even when no open payroll run existed yet to attach the arrear to — payroll runs in arrears, so this was the common case. An approved dispute always looked fully resolved regardless of whether the differential had actually been paid. Same commit's service fix now writes 'arrear_pending' instead when no line was found to attach to. Additive ALTER TABLE, existing rows/values untouched. Batch 3 Phase 4 of the payroll audit fix plan; applied against production only with explicit user approval, before/after shown, same as 1602/1603/1605.
  "migrations/1610_payroll_approval_status_page_catalog.sql", // Registers PAYROLL_APPROVAL_STATUS_VIEW in page_catalog and seeds role_page_access grants (can_view only) for branch_head, payroll_hr, payroll_head, admin, super_admin — the new read-only "which onboarded employees are pending/approved/rejected by Payroll Head, and what was assigned" page. Every route in payroll.routes.tsx is wrapped in <Gate pageCode=...>, so a new page needs a page_catalog row before WorkforcePageGate will render it for anyone. Same idempotent WHERE NOT EXISTS pattern as 1607. Numbered 1610 — 1609 already taken on disk by a concurrent session at the time of writing, not yet registered here.
  "migrations/1611_employee_salary_change_log.sql", // New table employee_salary_change_log — the who/why audit trail for the new Salary Change page (Payroll Head changes an already-active employee's salary). The live write still goes to salary_component_assignments in its existing shape; this table never touches that shape, purely additive CREATE TABLE IF NOT EXISTS. Also registers SALARY_CHANGE_CENTER in page_catalog + role_page_access (payroll_head/admin/super_admin, can_view+can_edit) — same idempotent pattern as 1607/1610.
  "migrations/1612_fix_festival_calendar_2026_rakhi_bhaidooj.sql", // 1226_fix_festival_calendar_2026.sql claimed its 2026 dates were verified, but a fresh cross-check against drikpanchang.com and other panchang sources on 2026-08-26 found two still wrong: Raksha Bandhan (was 2026-08-26, real date is 2026-08-28 per Delhi panchang — the festival-greetings cron had already fired 2 days early the same day this was found) and Bhai Dooj (was 2026-11-10, real date is 2026-11-11). Applied directly against production 2026-08-26 with explicit user authorization ("yes correct it"); registered here so a rebuilt database gets the same corrected dates. Each UPDATE is guarded on the OLD (wrong) date, so it is a no-op once applied or on a database seeded with the already-corrected 1072. Touches only greeting content; no payroll, attendance or statutory figure.
  "migrations/1613_add_missing_festival_calendar_2026_entries.sql", // Adds 10 real 2026 Indian festivals entirely missing from festival_calendar (Onam, Eid-e-Milad, Makar Sankranti, Lohri, Ram Navami, Ugadi, Mahavir Jayanti, Baisakhi, Buddha Purnima, Muharram) — found the same session as 1612 while validating dates, when it surfaced that Onam and Eid-e-Milad both fall on 2026-08-26 and neither existed in the table at all. Applied directly against production 2026-08-26 with explicit user authorization ("add them also"); Onam/Eid-e-Milad were added too late for that day's 8 AM cron, a one-time miss accepted by the user rather than manually triggering an out-of-band send. INSERT IGNORE against the existing UNIQUE(festival_name, festival_date) — naturally idempotent. Touches only greeting content; no payroll, attendance or statutory figure.
  "1614_user_roles_grant_provenance.sql", // Adds granted_by CHAR(36) + granted_at DATETIME (both NULL) to user_roles, so a live role grant carries its own provenance instead of existing only in the audit stream. Verified live 2026-08-26: user_roles is (id, user_id, role_key, active_status, created_at) and nothing more, across 1,618 rows / 1,491 active. Role assignment IS audited as an event by access.service.ts via logSensitiveAction (ROLE_ASSIGNED / ROLE_REVOKED), but the row itself cannot say who granted it, and auth-launch.routes.ts holds an actor id it deliberately discards with a comment naming this exact missing column. Worse, created_at MISREPRESENTS current access: every grant site inserts ON DUPLICATE KEY UPDATE active_status=1 against uq_user_role(user_id, role_key) (confirmed live), so a revoked-then-regranted role keeps the ORIGINAL created_at and a reinstated privilege reads as older than it is; granted_at is refreshed on reactivation precisely so it does not inherit that. No backfill by design — copying the unreliable created_at into granted_at would launder it, so historic rows stay NULL and NULL means "granted before this was tracked". granted_by NULL with granted_at set means a system grant with no human actor (the baseline employee role attached at first login or at employee creation). Purely additive: two nullable columns, no index, no FK, no existing column touched, no row rewritten. Idempotent via information_schema guards rather than ADD COLUMN IF NOT EXISTS, which this MySQL 8.0.42 rejects at the token. Proven before scheduling by executing the file twice against a scratch CREATE TABLE LIKE user_roles clone on production 8.0.42: 11 statements clean on pass 1, no-op on pass 2, granted_by landing as char(36) utf8mb4_unicode_ci matching auth_user.id, scratch table dropped
  "1615_vendor_bank_details.sql", // Creates vendor_bank_detail + vendor_bank_change_request + vendor_bank_detail_log, and grants VENDOR_BANK_DETAILS to finance_head/accounts_head only. Verified live 2026-08-26 that vendor payee bank details existed in NEITHER database: mas_hrms.vendor_master (1,821 rows), db_bill.tbl_vendormaster (2,059) and db_bill.vendor_master (526) all carry zero bank columns, db_bill.bill_pay_particulars.deposit_bank is our own paying account rather than the payee, and every acc_no/IFSC column in db_bill is employee-side. So this INTRODUCES payee bank data — and the payment-redirection fraud vector — into HRMS2, which is why the maker-checker request table and the change log are created in the same migration as the detail table: the audit table must exist before the first account can be written. Account numbers are stored only as AES-256-GCM ciphertext plus a last-4 and a blind index, with no plaintext column, deliberately unlike employees.aadhaar_number/pan_number whose plaintext is still live alongside the backfilled ciphertext. Not granted to admin/super_admin because hasOrgWideScope() lets admin past org-wide checks with no scope row. Additive: three new tables, one page_catalog row, two role_page_access rows, no existing column or row touched. Idempotent via information_schema guards rather than CREATE TABLE IF NOT EXISTS, matching 1614, since this MySQL 8.0.42 rejects ADD COLUMN IF NOT EXISTS at the token
  "1616_missing_page_catalog_entries_dispute_budget.sql", // Registers SALARY_DISPUTE and FINANCE_ANNUAL_BUDGET_SUMMARY in page_catalog. Same defect class as 604_missing_page_catalog_entries.sql. Verified live 2026-08-26: SALARY_DISPUTE has NO page_catalog row at all, and access.service.ts builds its permission map from the ACTIVE page_catalog rows — including the super_admin branch, which iterates activePageCodes — so a code absent from the catalogue is grantable to nobody and held by nobody. canViewPage('SALARY_DISPUTE') is therefore false for every user, super_admin included, and /payroll/salary-disputes (SalaryDisputeHub) renders the access-denied gate for the entire organisation; because the gate denies rather than errors it reads as "you do not have access" rather than "never registered", which is why it went unnoticed. FINANCE_ANNUAL_BUDGET_SUMMARY is the opposite case: it EXISTS live with four role grants (super_admin/admin/finance_head/accounts_head) but was inserted straight into the database with no migration, so a rebuilt environment would silently lose a page production serves — drift, not an outage, and its existing grants are left untouched. Additive: two page_catalog rows via ON DUPLICATE KEY UPDATE, no grants issued (role matrix stays the single source of truth, per 604's reasoning), no existing row rewritten. Caught by src/tests/page-access-deployment.contract.test.ts, whose "every referenced page code present in SQL migrations" case was red.
  "1617_snapshot_tables_collation_repair.sql", // Converts upload_deduction_snapshot and qual_incentive_snapshot from utf8mb4_0900_ai_ci to utf8mb4_unicode_ci. 1547 created both with MySQL 8's server default while mas_hrms and employees are utf8mb4_unicode_ci; both carry employee_code and deduction-snapshot.routes.ts joins on it twice (LEFT JOIN employees e ON e.employee_code = q.employee_code), which is not a warning but a hard ER_CANT_AGGREGATE_2COLLATIONS - reproduced against production on both tables, so those endpoints have been 500ing on every request rather than degrading. 1547 is already recorded applied (success=1) and the tables hold real data (13,175 and 3,372 rows measured live), so correcting 1547's own text only helps a rebuilt database; this is the forward fix for environments where it has already run - the same two-part pattern 1226 used. Each CONVERT is guarded on the table's CURRENT collation so it is a no-op once applied, and both collations are case- and accent-insensitive over the same utf8mb4 repertoire, so no row can collide or change meaning - only sort/compare rules change, which is the point. Proven before scheduling by running the file twice against scratch CREATE TABLE LIKE copies holding 500 real rows each on production 8.0.42: both converted on pass 1, the employees join that previously errored returned 500 rows, pass 2 was a no-op, scratch tables dropped
  "1618_payroll_branch_readiness_collation.sql", // Converts payroll_branch_readiness from utf8mb4_0900_ai_ci to utf8mb4_unicode_ci. Joining its branch_id to branch_master.id is a hard ER_CANT_AGGREGATE_2COLLATIONS (errno 1267), not a warning, and payroll-window.cron.ts joins plainly - observed live in the worker log right after the 2026-08-26 deploy as "[payroll-window-cron] startup run failed", so that cron has not been completing. payroll-branch-readiness.service.ts already worked around the same clash at two of its own joins with CONVERT(b.id USING utf8mb4) = CONVERT(r.branch_id USING utf8mb4), i.e. this was hit before and patched per-query instead of at source, which is exactly why one call site survived and the cron did not; those CONVERT() joins are deliberately left alone since they keep working against a converted table. Guarded on the table's current collation so it no-ops once applied; both collations are case- and accent-insensitive over the same utf8mb4 repertoire so no row can collide or change meaning, only sort/compare rules change. Small table, ~146 rows. Scope is this table only - a sweep found 58 of 1,009 tables carrying utf8mb4_0900_ai_ci, several large (wfh_attendance_snapshot ~267k rows, field_attendance_snapshot ~106k, migration_log ~90k); converting those rewrites each table and is scheduled separately
  "1619_attendance_regularization_queue_indexes.sql", // Adds idx_ar_created_at and idx_ar_status_created to attendance_regularization. The table had no index on created_at, which is the ORDER BY of GET /api/wfm/regularizations, so an unfiltered list did type=ALL over 136,924 rows with Using filesort to return 100 - measured 1,572 ms live on 2026-08-27. With created_at indexed the optimiser walks the index backwards and stops at the limit. The status-filtered form already resolves through idx_reg_status (range, rows=12, 133 ms), so the composite is for growth, not for today's numbers. Additive only - two secondary indexes, no column, constraint or row touched, roughly 4 MB against 59.9 MB of index already present, and a replay is a no-op. Both adds are guarded on INFORMATION_SCHEMA.STATISTICS rather than CREATE INDEX IF NOT EXISTS, which MySQL 8.0.42 rejects as MariaDB-only syntax. ALGORITHM=INPLACE, LOCK=NONE are stated explicitly so a server that cannot do it online errors rather than silently falling back to a blocking table copy
  "1620_enable_wired_notification_events.sql", // Turns on the 36 notification events that have a real producer and have been silently off since they were seeded. 1022 seeded every event with a column list omitting `enabled` and `dispatch_mode`, so all 68 took the table defaults (enabled=0, dispatch_mode='shadow') -- not a rollout decision, an accident 1022's own line-120 comment admits. e13457f3 fixed it for leave only; live state 2026-08-27 was 8/68 live, all leave, with payroll 0/15, uat 0/12, wfm 0/10, attendance 0/8, governance 0/8, exit 0/5, reporting 0/2. Enables ONLY events a gateway caller actually names: the other 23 have no producer, and grepping all of src/ for the bare string is not enough -- weekoff_denied is also a roster decisionType, attendance_missing_punch a work_item type, exit_clearance_pending a SmartPing DLT SMS key, and all three passed a naive check before __tests__/enabled-events-have-producers.test.ts caught them. Holds provisioning_overdue back because 69 requests are already past SLA and the owner should pick that moment. Sweep-driven events checked for backlog first -- exit_lwd_approaching matches 0 rows in its bounded +7-day window, task_sla_breach_l1/2/3 read an empty task_tat_instance whose worker is separately disabled -- so this opens without a storm. Rows deliberately set dispatch_mode='off' are preserved by matching only the accidental default. Data-only, no schema, reversible per event_code
  "1621_payroll_head_org_wide_scope.sql", // payroll_head and finance_head users missing from PEOPLE_SCOPE_ROLES and lacking any user_assignment_scope row see 0 employees on every scoped endpoint — buildScopeWhereClause returns 1=0 when scopes.length=0. This inserts scope_type='all' for every active payroll_head/finance_head who has no existing scope row, making both roles org-wide by default. Idempotent WHERE NOT EXISTS guard. Code fix: payroll_head and finance_head also added to PEOPLE_SCOPE_ROLES in employee.secure.routes.ts.
  "1623_team_roster_page_access_for_managers.sql", // Seeds page_catalog row and role_page_access grants for TEAM_ROSTER page for manager-shaped roles (operations_manager, process_manager, team_lead). Without this, TEAM_ROSTER resolves WorkforcePageGate to access=denied for every manager except super_admin. Additive only: INSERT ... ON DUPLICATE KEY UPDATE against page_catalog and role_page_access. Owner-approved 2026-08-27.
  "1624_employee_manager_history.sql", // Creates employee_manager_history table for effective-dated supervisory assignment (manager + process + branch). Fixes silent attribution bug: a manager change moves all historical attrition/shrinkage to whoever holds the pointer today. Seeds the current state as effective_from=today with provenance='seed'. One new table, no existing table altered. Owner-approved 2026-08-27.
  "1625_client_billing_seed_number_sequences.sql", // Seeds client_invoice_number_sequence from the already-migrated invoice book. The 2026-08-19 cutover loaded 10,794 legacy invoices carrying their verbatim legacy numbers but never advanced the counter that mints NEW ones; verified live 2026-08-27 that the table holds 0 rows while proformas run to PI/09/7971 and FY 2026-27 bills to 09-274/26-27. Without this the first live createProforma mints PI/<state>/1 and the first live approveInvoice mints <state>-01/<FY>, both of which already exist — and client_invoice has no UNIQUE index on either column (1,999 duplicate bill_no groups are already inherited from legacy), so the collision is silent, not an error: a second invoice is issued under a number a client already holds, breaching GST Rule 46(b)'s unique-serial-per-financial-year requirement. Seeds only the two kinds that can collide: 'proforma' (one GLOBAL counter; 100% of the 7,508 numbered rows match ^PI/<d>/<d>$, so MAX() is the true high-water mark) and 'bill' (73 scopes keyed exactly as mintBillNumber keys them, <gst_state_code>|<company_name>|<finance_year>, restricted to the modern NN-NNN/YY-YY shape — the 3,052 rows in the older NNN/BRANCH/YYYY-YYYY shape cannot collide and are excluded; the state code is read from branch_master.gst_state_code, the same value the mint uses, verified to agree with the parsed bill-number prefix on 7,740 of 7,740 rows). 'credit_note' deliberately NOT seeded: 0 of 144 migrated credit notes use the new CN-<state>-<NN>/<FY> format, so a counter starting at 1 cannot collide. Writes only to client_invoice_number_sequence; reads client_invoice/cost_centre_master/branch_master and alters neither them nor any invoice, amount, tax figure or existing number. Idempotent via ON DUPLICATE KEY UPDATE ... GREATEST(), which never rewinds a counter that has legitimately advanced past the seed.
  "1626_vendor_payment_due_date_backfill.sql", // Recovers vendor_payment_tracking.due_date, which was NULL on 100% of 14,369 rows (verified live 2026-08-27). Three things on the Vendor Payment Dispatch page depend on it and all three were dead: the Overdue KPI sums balances where due_date < CURDATE() so it could only ever render ₹0 — reading as "nothing is overdue", the opposite of the truth; the Aging report filters `AND vpt.due_date IS NOT NULL` so it returned an empty set for every pending row; and the list orders by `due_date ASC, created_at ASC`, which with all-NULL collapsed to created_at and opened the queue on 2017 GRNs. ₹4,83,13,763 of pending dues carried no prioritisation signal at all. The rows are NULL because they were bulk-loaded from history (created_at from 2017-02-28) and bypassed the service INSERT, which already sets this column as `grn.due_date ?? grn.bill_date` — so this applies the service's OWN existing rule to the rows that missed it, and invents no due-date policy. grn_request.due_date is itself NULL on 84,767 of 84,793 GRNs, so bill_date carries it in practice; COALESCE keeps due_date first exactly as the service does. APPLIED to production 2026-08-27 under explicit user authorisation, run via a controlled script so a restore point (zz_vpt_due_date_backup_20260827) and before/after evidence were captured together: 14,369 matched / 14,369 changed / 0 left NULL; afterwards money totals were byte-identical to the pre-write audit, 0 rows future-dated, 0 rows disagreeing with their own GRN. Expect the Overdue tile to read ₹4.83 crore with every pending row in the 365+ day bucket — that is the reality the NULLs were hiding, not a regression. Registered so a rebuilt database reaches the same state; the UPDATE is guarded on `due_date IS NULL` so a replay can only fill a gap, never overwrite a date the live service has since written.
  "1628_team_kpi_scorecard_page.sql", // Registers TEAM_KPI_SCORECARD page catalog entry and grants view access to 13 manager-tier roles. Required by access.service.ts permission map — a code absent from page_catalog can be held by nobody and the gate denies super_admin too (same defect as 1616). Idempotent via ON DUPLICATE KEY UPDATE and NOT EXISTS guards.
  "1629_salary_component_assignments_full_components.sql", // Adds bonus, portfolio, medical_allowance, lta, other_allowance, pli, mobile_deduction, insurance_deduction to salary_component_assignments so the payroll engine can produce a full component breakdown matching the db_bill legacy salary register column-for-column. Also seeds five deduction component_codes (MOBILE_DED, SHORT_COLL, ASSET_REC, INSURANCE, LEAVE_DED) that appear in db_bill salary_data but were absent from salary_component_master. All column additions are individually information_schema-guarded (MySQL 8.0.42 rejects ADD COLUMN IF NOT EXISTS at the token). Previously the payrollCalculate.service.ts scaRow path reset compAmounts to BASIC/HRA/CONV only, causing BONUS/PORTFOLIO/MEDICAL/LTA/OTHER_ALLOW/PLI to appear as zero on payslips even when the employee's salary structure had them. The accompanying engine fix reads all nine columns from SCA and populates compAmounts fully so salary_prep_line_component rows match the db_bill register.
  "1627_drifted_table_collation_repair.sql", // Converts 49 tables from utf8mb4_0900_ai_ci to the schema default utf8mb4_unicode_ci. Same defect 1617 and 1618 each fixed one instance of, after it had already taken an endpoint and a cron down: on MySQL 8 a bare CHARSET=utf8mb4 resolves to the SERVER default, not the database default, and comparing two differently-collated VARCHARs is a hard ER_CANT_AGGREGATE_2COLLATIONS (errno 1267), not a warning — so each of these tables breaks the first time anyone joins it on a string. A live sweep on 2026-08-28 found 57 still drifted. The second cost is silent: where code already works around the clash with an inline COLLATE cast, the cast makes the column a non-indexable expression — measured on cosec_punch_sync (3.04M rows) as a sole predicate, no cast 23ms ref/idx_user_date, cast to its OWN collation 12ms ref/idx_user_date, cast to a DIFFERENT collation 4,157ms index scan of 3,039,163 rows. So aligning the tables makes the ~127 existing casts in backend/src free, and this ships deliberately WITHOUT any code change, since removing a cast before its table converts raises 1267 immediately. Scope is every drifted table at or under 50MB carrying no foreign key. Excluded and needing their own window because CONVERT rewrites the table: cosec_punch_sync (3,039,163 rows / 390MB), attendance_legacy_snapshot (2,105,841 / 724MB), migration_error (7,158 / 57MB). Also excluded: the five funnel_* / conversion_funnel_event tables, because converting one side of a foreign key before the other is rejected with errno 3780 and all five are empty. Every statement guarded on the table's CURRENT collation so it no-ops once applied; both collations are case- and accent-insensitive over the same utf8mb4 repertoire so no row can collide or change meaning, only sort/compare rules change. NOT applied by hand — 1124 shows a manual ALTER on a live table hits "Lock wait timeout exceeded" against the backend and workers holding transactions; boot runs migrations before the app serves, which is when contention is lowest. Proven before scheduling exactly as 1617 was: parsed with the runner's own splitSql (246 statements, 49 guarded blocks, 0 comment-only), then executed twice against scratch CREATE TABLE LIKE copies of cosec_daily_agg, billing_provision_snapshot and lms_learner_progress holding 500 real production rows each — pass 1 converted all three, pass 2 was a clean no-op, row counts unchanged, and the employees join that raises ER_CANT_AGGREGATE_2COLLATIONS against the live table returned 424 matched rows against the converted copy; scratch tables dropped
  "1630_grn_funding_cost_centre.sql", // Adds grn_cost_allocation.funding_cost_centre_id, separating WHO INCURRED a cost (cost_centre_id, always the raiser's) from WHOSE BUDGET PAID it (the funding line's cost centre; NULL for a branch-common pooled line). Since the branch-wide headroom gate of 2026-08-22 those are routinely different by design - cost centre A with no line of its own is legitimately funded by cost centre B's line - and with one column there was nowhere to record it, so is_unbudgeted was pressed into service as a proxy and fully-funded spend was reported as off-budget. One nullable CHAR(36) plus one index, both guarded on information_schema (ADD COLUMN IF NOT EXISTS is not valid MySQL 8 and would record as applied while having failed). No DROP, no DELETE, no backfill: every pre-deploy row stored the funding line's cost centre in cost_centre_id, so backfilling would assert something the old code never recorded, and NULL correctly means "not captured".
  "1631_topup_allocation_driver.sql", // Adds finance_budget_topup_request.allocation_driver so a top-up can say HOW its money is shared across cost centres, the way a budget line already does. Without it, topping up an existing branch-level line left the split describing the old smaller amount, and a top-up that created a new head/sub-head inserted a planning_level=branch line with no driver at all - a shared cost that could never be divided by rule. One nullable VARCHAR(64), guarded on information_schema; NULL preserves today behaviour exactly (hand-entered splits stay the deliberate manual override they are). No DROP, no DELETE, no backfill.
  "1631_kpi_capture_submission.sql", // Creates kpi_capture_submission (staging store for the open /kpi-capture page) and kpi_capture_access_token (bearer token for the token-gated results view, seeded with one active row). Both tables carry an EXPLICIT COLLATE utf8mb4_unicode_ci: on MySQL 8 a bare CHARSET=utf8mb4 resolves to the SERVER default (utf8mb4_0900_ai_ci here), not the database default, and joining a drifted table to employees or cost_centre_master is a hard ER_CANT_AGGREGATE_2COLLATIONS (1267) rather than a warning - migration 1627 exists only to repair 49 tables that hit exactly this. Staging, not live config: the submit endpoint is unauthenticated by design, so it must not be able to mutate kpi_metric_master or kpi_master_config; nothing in any scoring path reads kpi_capture_submission. Idempotent - CREATE TABLE IF NOT EXISTS plus an INSERT ... WHERE NOT EXISTS on a fixed id, so a re-run is a no-op. No ADD COLUMN IF NOT EXISTS anywhere (invalid on MySQL 8, and it records as applied while having failed). No DROP, no DELETE, no backfill.
  "1636_dialler_source_registry.sql", // Creates dialler_source + dialler_source_column_mapping: the Dialler_Source registry (requirements.md Requirement 16) that gives every productivity feed a first-class identity, plus a per-source Column_Mapping (criteria 16.12-16.14) so a manual-upload report's column layout is a configuration change, not a code change, mirroring wfm_header_mapping_profile's proven JSON-blob shape (migration 1500) rather than a new EAV table. Purely additive, no FOREIGN KEY (unlike 1500's, which currently blocks every deploy), not yet read by production code.
  "1637_canonical_productivity_store.sql", // Adds campaign_master.dialler_source_id/owning_branch_id/is_sentinel (criteria 16.7, 16.8) via the INFORMATION_SCHEMA + PREPARE/EXECUTE guard (ADD COLUMN IF NOT EXISTS is invalid MySQL 8 syntax), and creates attendance_productive_day + attendance_productive_contribution, the materialised Canonical_Productive_Minutes store (Requirement 18). Neither new table is written by anything yet -- deriveCanonical() (this phase) is a pure function with no DB access; the write path is Phase 3's ingestion tasks.
  "migrations/440_salary_date_revision_requests.sql", // RETROACTIVELY REGISTERED 2026-08-27 — the file has existed since the salary-date-sync feature was written but was never listed here, so it never ran and the table never existed. Every call to GET /api/salary-revision therefore returned 500 with "Table 'mas_hrms.employee_salary_date_revision_requests' doesn't exist", which is the Payroll Head Salary Review Queue page — observed live in the browser 2026-08-27 (references 59a7803b and 224297fb in the API error log). Five call sites in the salary-revision service read or write that table. The file was ALSO WRONG as written and has been corrected in the same change before registering it: requested_by and reviewed_by were INT, but they hold auth_user.id, which is CHAR(36) here (as is employees.id, both utf8mb4_unicode_ci, verified live). The service types the field as string and the route passes String(req.authUser!.id), so with STRICT_TRANS_TABLES in sql_mode every INSERT would have hard-errored on the UUID, and the LEFT JOIN to auth_user on that column could never have matched — registering it unchanged would have swapped one loud 500 for a table that reads fine and refuses every write. employee_id widened to CHAR(36) for the same reason, and all three carry an explicit COLLATE so joins to employees and auth_user cannot hit errno 1267. Pure CREATE TABLE IF NOT EXISTS, no ALTER, no data; the table is absent in production so first run creates it and a replay is a no-op.
  "1632_salary_revision_page.sql", // Registers the SALARY_REVISION page_catalog row (route /salary-revision, the dual-role page where employees raise salary revision requests and payroll/HR approve them) plus role_page_access grants for payroll_hr/payroll_head/branch_head/hr/hr_admin/admin/super_admin/employee. The catalog row is load-bearing on its own: access.service.ts builds its permission map from active page_catalog rows, so a page_code absent from the catalogue can be held by nobody and the gate denies the whole organisation, super_admin included. Written earlier but deliberately left unregistered pending owner approval (its header said NOT YET EXECUTED), which is why it sat in the lock's knownUnlisted and ran nowhere; approval given and applied to production 2026-08-30. Idempotent - page_catalog upserts on page_code, grants insert under WHERE NOT EXISTS, and the trailing UPDATE re-asserts can_view/active_status, so a replay is a no-op. RBAC data only, no schema change, no DROP, no DELETE.
  "1633_attendance_source_rule_store.sql", // Creates attendance_source_rule + attendance_source_rule_dimension_value: the single effective-dated Attendance_Source_Rule store (requirements.md Requirement 1) that replaces attendance_rule_config + apr_eligibility_config's non-deterministic OR-combination. Resolution is a pure in-memory function (attendance-source-rule-resolver.ts), not a SQL ORDER BY ... LIMIT 1 tiebreak. Purely additive — two new tables, no ALTER, nothing read by production code yet; the engine cutover and the migration-15 proposal/approval workflow are later phases. No FOREIGN KEY (matches the no-FK convention; migration 1500's FK to process_master is the one already blocking every deploy).
  "1634_day_threshold_rule_store.sql", // Creates day_threshold_rule + day_threshold_rule_dimension_value: full_day_minutes/half_day_minutes/grace_minutes relocated out of attendance_rule_config (criteria 1.14-1.16), resolved by the same six Rule_Dimensions and the same resolver as attendance_source_rule. Purely additive, not yet read by classifyMinutes().
  "1635_attendance_threshold_and_ceiling_store.sql", // Creates attendance_threshold_rule (+ dimension_value child) for the three threshold kinds (apr_corroboration/variance_tolerance/floor_absence_ceiling, defaults 480/60/60) and attendance_dual_review_ceiling, scoped to branch + Pay_Month rather than the six Rule_Dimensions (criterion 6.10). Purely additive.
  "1638_productivity_upload_batch.sql", // Creates productivity_upload_batch + productivity_upload_rejection: the Upload_Batch identity and per-row rejection tracking for the WFM manual upload pipeline (requirements.md Requirement 17). apr.upload_batch_id has 0 distinct values across all 46,163 rows today -- this table is the audit trail the new upload path (apr_manual_upload) will carry, closing that gap. Purely additive, not yet read by production code -- the upload route is Phase 4.
  "1633_exit_pass_qr_token.sql", // Phase 4 of Asset & Material Exit Pass: the QR that 1538/1539/1540 each explicitly deferred ("live QR token validation"). Those phases left the module HALF-WIRED — 1539 added exit_verification_method ENUM('qr','manual') and exit-pass.routes.ts has rejected anything but those two values since Phase 2, yet nothing could produce 'qr': the print layout drew no QR and NativeExitPassVerify.tsx hardcoded method:"manual", so the enum's 'qr' branch was unreachable in production. Adds ONE nullable CHAR(64) + a unique index. Stores a sha256 HASH, never the token — the convention 409_visitor_management_foundation.sql set with tracking_token_hash (visitor.security.test.ts asserts the raw token is never columned), so a leaked backup yields no working gate credential. The raw token is stored NOWHERE and re-derived from HMAC(secret,'exitpass:v1:'||id) in exit-pass.qr.ts, which is what makes a REPRINT work: the visitor flow can be hash-only because its token is emailed once, but a gate pass gets reprinted and a one-way token would leave every reprint with a dead QR. The token proves the PHYSICAL PASS WAS PRESENTED and is NOT an authorization credential — authz stays requireAuth + security role + status='approved', so a scanned token alone can never verify an exit. Single-use is free from the existing state machine (exit verification moves status off 'approved', so a re-scan reads 'already_used'). Pre-existing approved passes get NULL and keep working via manual entry; the app backfills a hash on first print. Purely additive on a table this project created in 1538. No DROP, no DELETE.
  "1639_wfm_productivity_upload_page_access.sql", // Registers WFM_PRODUCTIVITY_UPLOAD in page_catalog + role_page_access (criteria 14.7, 14.8) for the new POST /api/wfm/productivity-upload/{preview,commit} endpoint (requirements.md Requirement 17). No navConfig.tsx entry yet -- no UI page exists to route to; the endpoint is reachable by URL for a correctly-permissioned user and exercised by this phase's own tests.
  "1640_apr_manual_write_attribution_triggers.sql", // BEFORE INSERT + BEFORE UPDATE triggers on apr rejecting an unattributed MANUAL write via SIGNAL SQLSTATE '45000' (requirements.md criterion 17.10 -- the path that produced 3,810 rows with campaign_id 'MANUAL_UPLOAD', NULL upload_batch_id and empty process_name/branch_name). MUST ship in the SAME deployment as the paired attendance-apr-bulk.routes.ts change that attributes that write: applying this file alone makes every evidence row of the live apr-bulk upload fail (loudly, per row -- the attendance write still lands). Keyed on source = 'manual' ONLY, so the continuous ViciDial sync (which writes source = 'sync' and never assigns source in its ON DUPLICATE clause) cannot be caught and production ingestion cannot go down. The UPDATE branch fires only on a TRANSITION into an unattributed manual state, which grandfathers the 3,810 legacy rows -- they remain updatable (corrected re-uploads for historical dates, requirement 15's own attribution backfill, process_name/branch_name enrichment) while no NEW unattributed row can be created and no attributed row can be stripped. No backfill is required before applying. DROP TRIGGER IF EXISTS before each CREATE so a replay redefines rather than fails; ROLLBACK is the two DROP TRIGGER statements in the file header.
  "1641_create_client_portal_users.sql", // Seeds one client_user row per client that has mapped processes, using placeholder emails (portal-{code}@mcnhrms.teammas.in). Idempotent INSERT … SELECT WHERE NOT EXISTS. Numbered 1641 — deliberate collision with 1641_deactivate_test_slabs; manifest tracks by full filename so both run independently.
  "1641_deactivate_test_slabs_and_deduplicate_packages.sql", // Data-quality: deactivates the three test/demo salary slabs (TD-SLAB-182710, TD-SLAB-113934, TD-SLAB-182842, all seq_order=999) that were visible in the production Payroll Masters UI but are not valid business slabs. Also removes exact-duplicate salary_package rows (same band_id + cost_centre_code + ctc_monthly) that have no salary_structure references — e.g. Band F / BSS / OB / Noida / 592 appearing twice at ₹15,000 in the NOIDA packages list. Only orphaned duplicates are deleted; the canonical (older) row is preserved. No schema changes.
  "1642_attendance_rule_migration_proposal.sql", // Creates the seven-table Requirement 15 migration PROPOSAL store: the run, the proposed Attendance_Source_Rules and Day_Threshold_Rules with their set-valued dimension children, the legacy-row provenance that drives criterion 15.12's deactivate-rather-than-delete, and the findings criteria 15.2/15.3 require. Deliberately NOT a status column on attendance_source_rule (1633) or day_threshold_rule (1634): loadActiveWindowedRules() filters on active_status plus the effective window and nothing else, so a draft parked in the live store with active_status = 1 resolves for real employees immediately, and parked with active_status = 0 it is indistinguishable from a rule an administrator deactivated -- which is the exact state 15.12 puts the legacy rows into. Approval (15.11) is therefore a copy from a store nothing resolves against into the store everything resolves against. Purely additive and completely inert on apply: no resolver, service or route reads any of these tables, and the builder that fills them (attendance-rule-migration-proposal.ts) is a pure function with no DB access at all, so applying this changes no employee's resolved Attendance_Source and no day classification. Every string column carries an explicit COLLATE utf8mb4_unicode_ci because a bare CHARSET=utf8mb4 takes the server default utf8mb4_0900_ai_ci and a later join is then a hard errno 1267 -- the defect 1627 exists only to repair across 49 tables. No FOREIGN KEY anywhere, matching every other table in this feature. ROLLBACK is the seven DROP TABLE statements in the file header, in child-first order.
  "1643_dual_review_queue.sql", // Extends payroll_attendance_conflict_review (268 live rows, read by attachReviewState() on /payroll/attendance-control-tower) into the two-reviewer Variance_Review_Queue criterion 7.11 asks for, and creates attendance_adjustment_request for Requirement 8. Twenty-seven columns: the SECOND reviewer identity/timestamp plus a Review_Outcome enum('apr_accepted','apr_disputed','adjustment_requested'), a Reviewer_Role label and a TEXT comment for EACH of the two slots -- the existing reviewed_by/reviewed_at pair is the first slot, so the slots are role-LABELLED rather than role-typed, which is also the only way criterion 7.6's branch-WFM-stood-in-for-an-absent-Reporting_Manager substitution can be recorded honestly (manager_substitution_applied + substitute_spoc_user_id, resolved from the effective-dated branch_wfm_spoc_config at routing time and stored, not re-derived). Deliberately NOT design.md's four wfm_* + four manager_* columns: that shape strands reviewed_by/reviewed_at as an undefined third slot. Also contested_at + override_approver_user_id (7.10), presented_at/escalation_age_days DEFAULT 3/escalation_interval_days/last_escalated_at (7.8, 7.9 -- presented_at rather than created_at because a record raised while mismatch_workflow_enabled is 0 is presented to nobody, per 9.9), variance_risk_score as SIGNED INT (Biometric_Minutes minus Canonical_Productive_Minutes goes negative under criterion 6.4; UNSIGNED would wrap and invert 6.9's ranking), queue_state enum('queued_for_dual_review','recorded_not_queued') + is_floor_absence (6.8, 6.9, 6.11, 7.1), the four-scalar evidence snapshot 6.3/7.2 require recorded AS APPLIED because attendance_threshold_rule is effective-dated, deciding_rule_id (also drives 14.5), and pay_month + carried_forward_from_pay_month (9.3). Criterion 7.2's per-Dialler_Source contributions and punch times are deliberately NOT denormalised as JSON: they are joined at read time to attendance_productive_contribution (1637, live set superseded_at IS NULL) and attendance_daily_record.clock_in_time/clock_out_time, because a corrected re-upload supersedes contributions and re-derives the canonical minutes, so a snapshot taken at flag time would silently disagree with the aggregator's own rows and break criterion 11.7's traceability property; the queue is ceiling-bounded at ~100 rows per branch-month so the join is bounded. status is widened by MODIFY COLUMN listing ALL SIX values (the five existing plus 'contested'), guarded on column_type so a replay no-ops, and carrying NO COLLATE clause because 537 declared no CHARSET and this table is absent from 1627's repair sweep -- restating a collation would convert one column away from the rest of its own table. Every ADD COLUMN and both indexes are guarded on information_schema via PREPARE/EXECUTE (ADD COLUMN IF NOT EXISTS is MariaDB syntax MySQL 8 rejects at parse time while the runner records the file as applied -- what got 1064 dropped); no AFTER clause anywhere, so twenty-seven independent guards cannot replay into a different column order. Every ADDED string column carries an explicit COLLATE utf8mb4_unicode_ci so the CHAR(36) user-id columns can join auth_user/employees without errno 1267. No FOREIGN KEY. PURELY ADDITIVE: no DROP, no DELETE, no UPDATE, no backfill -- all 268 existing rows read as queue_state IS NULL and keep working against the current single-reviewer code; criterion 7.12's mapping of their contents is a later phase. NOT YET EXECUTED, needs owner approval. ROLLBACK is the DROP TABLE, two DROP INDEX, status MODIFY back to five values and twenty-seven DROP COLUMN statements in the file header.
  "1643_payroll_readiness_visibility.sql", // NB deliberate number collision with 1643_dual_review_queue.sql from another session - the manifest keys on the FULL FILENAME (see the note at the top of this file), so both run independently and neither shadows the other; do not assume a number identifies a migration here. Adds four outstanding-work counters to payroll_branch_readiness (pending_leave_count, pending_regularization_count, employees_without_attendance, incentive_batch_status) and the missing payroll_hr grant on PAYROLL_BRANCH_READINESS. The counters exist because the five manually ticked readiness items verify NOTHING - the checklist POST writes the column with no query behind it - so branch WFM attested "Attendance Data Ready" from memory and the Payroll Head saw a score with no way to tell why a branch was short. refreshLiveMetrics() populates them; computeScore() and computeStatus() deliberately do NOT read them, so no branch score or status can move. incentive_batch_status is included because incentives_status='approved' is worth 20 of the 100 points and only admin/finance can set it (POST /api/incentives/batches/:id/approve), a cross-team dependency that never appeared on the readiness page. The grant is the RBAC half of a mismatch: role_page_access carried PAYROLL_BRANCH_READINESS for ten roles but not payroll_hr, while user_roles has 4 active payroll_hr users and ZERO holding payroll_branch - payroll_hr IS the branch-payroll role - and the backend routes already permitted it, so the API allowed a role the access gate denied on the item (custom_deductions_uploaded, 10 points) that role owns. No page_catalog row needed: the page is already catalogued. Purely additive and idempotent - four INFORMATION_SCHEMA + PREPARE/EXECUTE guarded ALTERs (no ADD COLUMN IF NOT EXISTS, which the deployed MySQL rejects while still recording the file applied), one INSERT guarded by NOT EXISTS, one re-asserting UPDATE. No DROP, no DELETE, no FOREIGN KEY. // Per-process client portal access issuance (.kiro/specs/per-process-portal-access): adds the per-CONTACT password credential to client_user (password_hash/password_set_at plus failed_login_attempts/locked_until, because a durable secret is guessable in a way the existing emailed OTP is not and lockout is therefore Requirement 5.6, not a nicety), the four flagged shared-account columns that make the one-shared-team-login exception auditable instead of silent (is_shared_account/shared_account_reason/shared_flagged_by/shared_flagged_at), the two nullable per-client policy columns on client_master (portal_session_days, portal_default_access_days — NULL means platform default, so no backfill), and the new client_portal_invite table storing bcrypt of a high-entropy invite token and never the raw token, so a leaked backup yields no redeemable invite. password_hash is NULLABLE ON PURPOSE: NULL is the "invited, password not yet set" state every newly issued contact starts in, and NOT NULL would have forced an operator-chosen placeholder password, which is exactly what the invite flow exists to prevent. Purely additive, no DROP, no DELETE, no backfill, no FOREIGN KEY, and nothing reads any of it until the paired service code ships. Ten separate INFORMATION_SCHEMA-guarded ALTERs rather than two multi-column ones: migration 509 guarded one column and then added eleven in a single all-or-nothing ALTER on THIS SAME TABLE, died ER_DUP_FIELDNAME on a column that already existed, that error is on the runner's idempotent swallow-list, and every statement after it silently never ran — 1118 exists only to repair that. No ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS anywhere: MariaDB-only, rejected at the token by MySQL 8.0.42, and the runner records the file applied regardless, so a migration that did nothing looks successful. client_portal_invite declares an EXPLICIT COLLATE=utf8mb4_unicode_ci because a bare CHARSET=utf8mb4 resolves to the SERVER default (utf8mb4_0900_ai_ci here) and joining a drifted table to client_user is a hard ER_CANT_AGGREGATE_2COLLATIONS (1267), which is the whole reason 1627 had to repair 49 tables. Its two indexes are declared inline AND re-asserted under INFORMATION_SCHEMA.STATISTICS guards, since CREATE TABLE IF NOT EXISTS no-ops against a pre-existing table of that name and would leave the inline INDEX clauses unevaluated. ROLLBACK is in the file header.
  "1644_role_report_permissions_wfm_payroll_hr.sql", // Populates role_report_permissions with proper access for WFM, Payroll, and HR roles. 245 grants total: WFM roles get 25 reports (attendance, roster, breaks, shrinkage), Payroll roles get 20 reports (register, statutory, cost, slips), HR roles get 20 reports (lifecycle, attendance, leave, compliance), Manager/TL get 6 team-scoped reports, Process Manager gets 12 process-scoped reports, Branch Head gets 11 branch-wide reports. Branch scoping enforced via user_assignment_scope. Purely additive, idempotent DELETE + INSERT pattern. No schema changes.
  "1645_pnl_manual_adjustment.sql", // Creates pnl_manual_adjustment for the new Manual P&L Adjustments feature (Projected Revenue/Penalty/Reward) — see pnl-manual-adjustment.service.ts. Process-scoped, single-stage maker-checker (pending -> approved/rejected), never blended into system-calculated revenue; a separate "Adjusted Total" is folded from APPROVED rows only. Explicit utf8mb4_unicode_ci on every column, matching every sibling finance table (this schema has a documented systemic collation-drift trap). CREATE TABLE IF NOT EXISTS, purely additive, already applied directly to mas_hrms and verified live (create/approve/reject/cleanup end-to-end trace against a real process).
  "1647_exit_module_missing_migrations.sql", // Reconstructs three exit-module tables' migration history to match live production, found during an exit/F&F process audit: (1) exit_retention_action was created by migration 305 with the wrong columns (action_type/action_summary/outcome/performed_by/performed_at only) -- live production also has employee_id/action_owner_user_id/outcome_remarks/created_by/created_at/updated_at, which addRetentionAction() in exit-intelligence.service.ts actually inserts, so a fresh environment built from 305 alone throws ER_BAD_FIELD_ERROR on the first retention action; (2) exit_interview_response and (3) exit_employee_health_snapshot are both actively read/written (saveExitInterview / createExitHealthSnapshot) with no CREATE TABLE anywhere in backend/sql/ at all -- a fresh environment throws ER_NO_SUCH_TABLE on the first exit interview or the first resignation submitted. Column NAMES for all three come from schema-snapshot.json (generated from live mas_hrms); TYPES/nullability/indexes are inferred from code usage, not read off the server -- flagged in the file header as needing SHOW CREATE TABLE reconciliation before being trusted on a real DR restore. Guards every ALTER with an INFORMATION_SCHEMA + PREPARE/EXECUTE helper procedure (mirroring 305's own _m305_add_col), not `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` -- per 1643_dual_review_queue.sql's and 1643_payroll_readiness_visibility.sql's own notes, that MariaDB syntax is rejected at parse time by this project's MySQL 8 while the runner still records the file as applied. Purely additive: CREATE TABLE IF NOT EXISTS / guarded ADD COLUMN / guarded ADD INDEX only, no DROP, no DELETE, no FOREIGN KEY. NOT YET EXECUTED, needs owner verification against production schema first.
  "1648_apr_eligibility_attendance_logic.sql", // Adds apr_eligibility_config.attendance_logic ENUM('apr','cosec','apr_validated_by_cosec') DEFAULT 'apr', plus idx_apr_elig_active_logic. Gives the table the third logic the business uses — APR first, biometric consulted when APR falls short of a full day — and lets a row state "explicitly COSEC" instead of that only being implied by no row existing. DEFAULT 'apr' keeps every existing row's meaning and isAprEligible()'s behaviour identical until a row is deliberately changed. Deliberately NOT on attendance_rule_config: processDay() overwrites that table's attendance_source/full_day_minutes/half_day_minutes in both branches, so a column added there would never be read. Purely additive — one guarded ADD COLUMN and one guarded ADD INDEX, no DROP, no DELETE, no FOREIGN KEY.
  "1651_payroll_cc_attendance_finalization.sql", // Three new tables behind the cost-centre attendance sign-off on /payroll/readiness?scope=branch (owner requirement 2026-09-02): payroll_cc_attendance_finalization (one row per process_month+branch+cost_centre, three-stage status unprocessed -> hr_finalized -> branch_head_approved -> ho_approved plus unlock_requested, and cycle_no so a granted unlock starts a NEW cycle rather than editing history), payroll_cc_attendance_line (the employee grid AS FINALIZED per cycle — not a cache: live numbers are re-derived from attendance_daily_record on every read and a late regularization can move them between HR finalizing and the Payroll Head approving, so without the snapshot the chain is a signature on whatever the data said at each click), and payroll_cc_attendance_unlock_request (single-stage pending/approved/rejected, modelled on 1534's finance_budget_closure_reopen_request). cost_centre_id is VARCHAR(64) NOT NULL with an 'UNASSIGNED' sentinel rather than a nullable FK: employees with no cost centre must stay visible and finalizable (1 of 1,115 active on 2026-09-02, and employee-master-bulk.service.ts still accepts a blank cost_centre_code), and MySQL treats every NULL in a UNIQUE index as distinct so a nullable column would allow two 'no cost centre' rows per branch-month — same reasoning as 1534's sub_head NOT NULL DEFAULT ''. The approval timeline is NOT a fourth table: transitions write finance_approval_event (1089) under entity_type 'payroll_cc_attendance', which is polymorphic by design. Explicit COLLATE utf8mb4_unicode_ci on every string column (a bare CHARSET=utf8mb4 takes the server's utf8mb4_0900_ai_ci default and the first join to employees/auth_user is errno 1267 — the defect 1627 repairs across 49 tables). No FOREIGN KEY, matching payroll_branch_readiness and every sibling payroll table. No new page_catalog/role_page_access rows — the screen is served under the existing PAYROLL_BRANCH_READINESS page code whose grants already cover these roles. Purely additive: three CREATE TABLE IF NOT EXISTS, no DROP, no DELETE, no ALTER of any existing table. NOT YET EXECUTED, needs owner approval.
  "1652_employee_attendance_exception_bucket.sql", // Creates employee_attendance_exception_bucket — the per-employee COSEC exception list behind /payroll/exception-control (owner requirement 2026-09-02). Two independent exceptions per named employee: single_punch_counts_as_present (a day COSEC saw one punch on is credited present instead of falling into the missing_punch review queue on zero minutes — 320 such days in the last 30, against 12,300 missing_punch days) and full_day_threshold_minutes (this person's full day is 480 rather than the hardcoded 540). Read by attendance-engine.service.ts, which treats an absent table as "nobody is bucketed" (errno 1146 caught explicitly), so the runner order cannot break attendance processing. Purely additive: one CREATE TABLE IF NOT EXISTS, explicit COLLATE utf8mb4_unicode_ci on every string column (employee_id joins employees.id — the errno 1267 trap 1627 exists to repair), no FOREIGN KEY, no existing table touched. Modelled on 290_pf_esic_optout.sql's employee_statutory_override.
  "1653_payroll_payable_days_override.sql", // Creates payroll_payable_days_override — the Payroll Head's month-level payable days for one employee, set before payroll release (same owner requirement). Read by payrollCalculate.service.ts step 6, which substitutes it for the COMPUTED paid base and then re-applies the active-calendar cap, so an override can never pay for days outside the employment window; the arithmetic itself is unchanged. Distinct from attendance_manual_override (238), which is per-DAY and stays exactly as it is. run_month is VARCHAR(7) to match payroll_run.run_month's storage — comparing it to a DATE matches zero rows. payable_days is DECIMAL(5,2) because half days are real. Purely additive: one CREATE TABLE IF NOT EXISTS, explicit COLLATE on every string column, no FOREIGN KEY. The engine lookup catches errno 1146 and falls through to the computed value, so an unapplied migration leaves payroll exactly as it was.
  "1650_backfill_active_branch_gstin.sql", // Writes the 4 checksum-verified company GSTINs onto the 5 branches that raised a client_invoice in FY2026-27 (branch_master.company_name resolves entity+state unambiguously for each). gst-export.service.ts's collectRows() joins on bm.gstin, so this is what unblocks the GST/Tally export -- it had generated zero rows since it shipped in 1520. Delhi/VDF MANPOWER (state 07, ~1,132 historical invoices, none since 2026-03-31) is deliberately left NULL: no GSTIN for that state exists anywhere in db_bill. Five single-row UPDATEs, each guarded on id + gstin IS NULL.
  "1652_gst_tally_export_page_access.sql", // Makes the new /finance/gst-export page reachable: page_catalog row + role_page_access grants mirroring gst-export.routes.ts's own GST_WRITE_ROLES/GST_READ_ROLES split exactly (write: accounts_head, finance_head, super_admin -- can_create+can_export; read-only: +admin, finance, branch_admin). Additive, idempotent.
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
  // Block comments are safe to strip first; they cannot appear inside '' string literals in MySQL.
  const noBlock = sql.replace(/\/\*[\s\S]*?\*\//g, " ");

  // Single-pass: process string literals BEFORE line-comment markers (-- / #).
  // Stripping -- comments with a regex first causes a closing ' that follows a -- inside a string
  // literal to be consumed by the comment regex, leaving the string unclosed and causing later
  // ALTER TABLE text to leak through into the DDL-keyword search.
  let result = "";
  let i = 0;
  while (i < noBlock.length) {
    if (noBlock[i] === "'") {
      i++; // consume opening quote
      while (i < noBlock.length) {
        if (noBlock[i] === "\\") {
          i += 2; // backslash escape — skip both chars
        } else if (noBlock[i] === "'") {
          i++;
          if (noBlock[i] === "'") {
            i++; // '' doubled apostrophe = escaped quote — stay inside the literal
          } else {
            break; // single ' = closing delimiter
          }
        } else {
          i++;
        }
      }
      result += "''"; // replace entire literal with a harmless placeholder
    } else if (noBlock[i] === "-" && noBlock[i + 1] === "-") {
      // Line comment — only reached when outside a string literal
      while (i < noBlock.length && noBlock[i] !== "\n") i++;
    } else if (noBlock[i] === "#") {
      // Hash comment — only reached when outside a string literal
      while (i < noBlock.length && noBlock[i] !== "\n") i++;
    } else {
      result += noBlock[i];
      i++;
    }
  }
  return result;
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
export async function runPendingMigrations(attempt = 1): Promise<MigrationHealth> {
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
  /** Set when the outer catch sees a retryable DB error; acted on after the lock is released. */
  let transientRetryCause: unknown = null;

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
    // A transient DB error is not a schema verdict. Flag it and retry BELOW — deliberately not
    // here, because the advisory lock is still held until the `finally` runs, so retrying inside
    // this catch would block on a lock this same call owns.
    if (isTransientMigrationError(error) && attempt < MIGRATION_MAX_ATTEMPTS) {
      transientRetryCause = error;
    } else {
      migrationHealth.failed.push({
        filename: "migration-runner",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    // GOVERNANCE: Always release advisory lock
    if (lockConn) {
      await releaseMigrationLock(lockConn);
      await lockConn.end();
    }
  }

  if (transientRetryCause) {
    const delayMs = MIGRATION_RETRY_BASE_MS * attempt;
    const reason =
      transientRetryCause instanceof Error ? transientRetryCause.message : String(transientRetryCause);
    console.warn(
      `[migration] transient failure on attempt ${attempt}/${MIGRATION_MAX_ATTEMPTS} — ${reason}. `
        + `Retrying in ${delayMs}ms; the advisory lock has been released.`
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    // migrationHealth is reset at the top of every call, so the retry starts from a clean slate
    // and the returned health reflects only the attempt that actually finished.
    return runPendingMigrations(attempt + 1);
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
