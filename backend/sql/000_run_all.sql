-- 000_run_all.sql
-- Run this to execute all schema files in order.
-- Usage: mysql -u root -p < sql/000_run_all.sql

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
SOURCE sql/010a_kpi_migration.sql;
SOURCE sql/011_exit_management.sql;
SOURCE sql/012_client_portal.sql;
SOURCE sql/013_roster_shift_times.sql;
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

SELECT 'mas_hrms schema complete' AS status;
SHOW TABLES;
