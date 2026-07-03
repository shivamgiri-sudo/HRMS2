import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import { env } from "../config/env.js";

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
  "271_performance_indexes.sql",
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
  "342_bgv_provider_config_labels.sql",
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

function isIdempotentMigrationError(error: any): boolean {
  const code = error?.code;
  const errno = Number(error?.errno ?? 0);
  const msg = String(error?.message ?? "").toLowerCase();
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

  for (const stmt of statements) {
    await conn.query(stmt);
  }
}

/**
 * Runs pending SQL migrations in manifest order and records a health summary.
 * - Uses MIGRATION_MANIFEST (derived from 000_run_all.sql) instead of directory scan.
 * - Each migration file runs on a dedicated single connection (for session variable support).
 * - Safe SQL splitter avoids false splits on semicolons inside string literals.
 * - Skips non-b duplicate variants (020, 021, 022) which are excluded from manifest.
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

  try {
    await ensureDatabaseExists(
      env.DB_HOST,
      env.DB_PORT,
      env.DB_USER,
      env.DB_PASSWORD,
      env.DB_NAME
    );

    // Ensure schema_migrations tracking table exists
    {
      const conn = await mysql.createConnection(connConfig);
      try {
        await conn.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            filename   VARCHAR(255) NOT NULL PRIMARY KEY,
            applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } finally {
        await conn.end();
      }
    }

    // Read the set of already-applied migrations
    const appliedSet = new Set<string>();
    {
      const conn = await mysql.createConnection(connConfig);
      try {
        const [rows] = await conn.query<any[]>("SELECT filename FROM schema_migrations");
        for (const row of rows) appliedSet.add(row.filename);
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

    for (const file of files) {
      const filePath = path.join(SQL_DIR, file);
      if (!fs.existsSync(filePath)) {
        console.warn(`[migration] skipping missing file: ${file}`);
        migrationHealth.skipped.push(file);
        continue;
      }

      if (appliedSet.has(file)) {
        migrationHealth.skipped.push(file);
        continue;
      }

      // Each file gets its own dedicated connection for session-variable isolation
      const conn = await mysql.createConnection(connConfig);
      try {
        await runFileOnConnection(conn, filePath);

        // Record as applied using a separate query on the same connection
        await conn.query("INSERT INTO schema_migrations (filename) VALUES (?)", [file]);
        migrationHealth.applied.push(file);
        console.log(`[migration] applied: ${file}`);
      } catch (error: any) {
        if (isIdempotentMigrationError(error)) {
          // Record as applied even for idempotent errors (table/column already exists)
          const conn2 = await mysql.createConnection(connConfig);
          try {
            await conn2.query(
              "INSERT IGNORE INTO schema_migrations (filename) VALUES (?)",
              [file]
            );
          } finally {
            await conn2.end();
          }
          migrationHealth.skipped.push(file);
          console.log(`[migration] already applied/idempotent: ${file}`);
        } else {
          const message = error?.message ?? String(error);
          migrationHealth.failed.push({ filename: file, error: message });
          console.error(`[migration] FAILED: ${file} — ${message}`);
        }
      } finally {
        await conn.end();
      }
    }
  } catch (error: any) {
    migrationHealth.failed.push({
      filename: "migration-runner",
      error: error?.message ?? String(error),
    });
  }

  migrationHealth.completedAt = new Date().toISOString();
  migrationHealth.status = migrationHealth.failed.length > 0 ? "failed" : "ok";

  if (migrationHealth.failed.length > 0 && env.NODE_ENV === "production") {
    const names = migrationHealth.failed.map((item) => item.filename).join(", ");
    throw new Error(`Production startup blocked because migrations failed: ${names}`);
  }

  return getMigrationHealth();
}
