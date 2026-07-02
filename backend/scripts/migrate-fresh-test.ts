/**
 * migrate-fresh-test.ts
 *
 * Drops and recreates the TEST database, then runs every migration in manifest
 * order, stopping on the first failure and printing the exact failing statement
 * plus the MySQL server version.
 *
 * Usage:
 *   npm run migrate:fresh:test
 *
 * Environment variables read (falls back to .env.test, then .env):
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 *   TEST_DB_NAME  — optional override; defaults to <DB_NAME>_test
 *
 * NEVER run against the production database.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import { splitSql } from "../src/db/runPendingMigrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.resolve(__dirname, "../sql");

// Resolve test DB name — never allow production DB name
const PROD_DB = process.env.DB_NAME ?? "mas_hrms";
const TEST_DB = process.env.TEST_DB_NAME ?? `${PROD_DB}_test`;

if (TEST_DB === PROD_DB) {
  console.error(
    `[migrate-fresh-test] FATAL: TEST_DB_NAME '${TEST_DB}' matches DB_NAME '${PROD_DB}'. ` +
      "Refusing to drop production database."
  );
  process.exit(1);
}

const connBase = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
};

// Canonical migration manifest (must stay in sync with runPendingMigrations.ts)
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
  "060_legacy_sync_schema.sql",
  "062_employees_legacy_fields.sql",
  "067_employee_task_system.sql",
  "099_ats_candidate_uploads.sql",
  "100_user_page_access.sql",
  "125_kpi_process_role_engine.sql",
  "134_external_db_credentials.sql",
  "135_payroll_masters.sql",
  "137_schema_gaps.sql",
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
  "199_employee_directory_indexes.sql",
  "200_employee_directory_process_index.sql",
];

async function main() {
  // Connect without a database to create/drop the test DB
  const adminConn = await mysql.createConnection(connBase);

  let mysqlVersion = "unknown";
  try {
    const [[row]] = await adminConn.query<any[]>("SELECT VERSION() AS v");
    mysqlVersion = row?.v ?? "unknown";
  } catch {}

  console.log(`[migrate-fresh-test] MySQL version: ${mysqlVersion}`);
  console.log(`[migrate-fresh-test] Test database: ${TEST_DB}`);

  console.log(`[migrate-fresh-test] Dropping '${TEST_DB}' ...`);
  await adminConn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  console.log(`[migrate-fresh-test] Creating '${TEST_DB}' ...`);
  await adminConn.query(
    `CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await adminConn.end();

  const connConfig = { ...connBase, database: TEST_DB, multipleStatements: false };

  // Create schema_migrations tracking table
  {
    const conn = await mysql.createConnection(connConfig);
    await conn.query(`
      CREATE TABLE schema_migrations (
        filename   VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.end();
  }

  let applied = 0;
  let skipped = 0;

  for (const file of MIGRATION_MANIFEST) {
    const filePath = path.join(SQL_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[migrate-fresh-test] SKIP (missing): ${file}`);
      skipped++;
      continue;
    }

    const rawSql = fs.readFileSync(filePath, "utf8");
    const statements = splitSql(rawSql).filter((stmt) => {
      const upper = stmt.toUpperCase();
      return !upper.startsWith("SOURCE ") && !upper.startsWith("USE ");
    });

    console.log(`[migrate-fresh-test] Running: ${file} (${statements.length} statements)`);

    const conn = await mysql.createConnection(connConfig);
    try {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        try {
          await conn.query(stmt);
        } catch (err: any) {
          console.error(`\n[migrate-fresh-test] FAILED: ${file}`);
          console.error(`  Statement #${i + 1}:`);
          console.error("  " + stmt.replace(/\n/g, "\n  "));
          console.error(`\n  Error: ${err?.message ?? String(err)}`);
          console.error(`  MySQL version: ${mysqlVersion}`);
          console.error(`\n  ${applied} file(s) applied before failure.\n`);
          await conn.end();
          process.exit(1);
        }
      }

      await conn.query("INSERT INTO schema_migrations (filename) VALUES (?)", [file]);
      applied++;
      console.log(`[migrate-fresh-test] OK: ${file}`);
    } finally {
      await conn.end();
    }
  }

  console.log(
    `\n[migrate-fresh-test] All migrations passed.\n` +
      `  Applied: ${applied}  Skipped: ${skipped}  MySQL: ${mysqlVersion}\n`
  );
}

main().catch((err) => {
  console.error("[migrate-fresh-test] Unexpected error:", err);
  process.exit(1);
});
