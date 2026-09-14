/**
 * phase2-describe.ts
 *
 * Read-only pre-flight: describes the current database schema state relevant
 * to Phase 1 (base migrations) and the MVP attendance/WFM/audit additions.
 *
 * Run: npm run phase2:describe
 * Output: console + writes evidence to scripts/phase2-describe-output.json
 *
 * SAFE: read-only SELECT / SHOW / INFORMATION_SCHEMA queries only.
 * Does NOT migrate, insert, update, or delete anything.
 */

import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "mas_hrms",
  connectTimeout: 10000,
};

// Tables and columns to verify for MVP migrations 223-238
const EXPECTED_COLUMNS: Record<string, string[]> = {
  attendance_regularization: [
    "dispute_type",
    "old_status",
    "new_status",
    "old_punch_in",
    "old_punch_out",
    "new_punch_in",
    "new_punch_out",
    "supporting_doc_id",
    "payroll_impact",
    "payroll_head_approval_required",
    "payroll_head_approved_by",
    "payroll_head_approved_at",
    "escalation_to",
    "escalation_reason",
    "payroll_head_notes",
  ],
  attendance_daily_record: [
    "old_attendance_status",
    "old_lwp_value",
    "status_change_reason",
    "status_changed_by",
    "status_changed_at",
  ],
  sensitive_action_log: [
    "old_value_json",
    "new_value_json",
    "employee_id",
    "actor_role",
    "reason",
  ],
};

const EXPECTED_TABLES = [
  "attendance_manual_override",
  "wfm_process_planning_rule",
  "wfm_slot_requirement",
  "process_weekoff_day_rule",
  "wfm_roster_assignment",
  "roster_decision_audit",
];

async function run() {
  const output: Record<string, unknown> = {};
  let conn: mysql.Connection | null = null;

  console.log("=== Phase 2 Describe: Read-Only Schema Pre-Flight ===\n");

  try {
    conn = await mysql.createConnection(DB_CONFIG);
    console.log(`✅ Connected to ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}\n`);

    // 1. MySQL version
    const [versionRows] = await conn.query<mysql.RowDataPacket[]>("SELECT VERSION() AS version");
    const mysqlVersion = versionRows[0]?.version ?? "unknown";
    output.mysql_version = mysqlVersion;
    const versionOk = mysqlVersion >= "8.0.16";
    console.log(`MySQL Version: ${mysqlVersion} ${versionOk ? "✅" : "❌ (requires 8.0.16+)"}`);

    // 2. Table existence checks
    console.log("\n--- Table Existence ---");
    output.tables = {};
    for (const table of EXPECTED_TABLES) {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [DB_CONFIG.database, table]
      );
      const exists = rows.length > 0;
      (output.tables as Record<string, boolean>)[table] = exists;
      console.log(`  ${exists ? "✅" : "❌"} ${table}`);
    }

    // 3. Column checks for MVP migrations
    console.log("\n--- MVP Column Checks (migrations 237-238) ---");
    output.columns = {};
    for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [DB_CONFIG.database, table]
      );
      const existing = new Set(rows.map((r) => r.COLUMN_NAME as string));
      const found: string[] = [];
      const missing: string[] = [];
      for (const col of cols) {
        if (existing.has(col)) found.push(col);
        else missing.push(col);
      }
      (output.columns as Record<string, unknown>)[table] = { found, missing };
      const status = missing.length === 0 ? "✅" : "❌";
      console.log(`  ${status} ${table}: ${found.length}/${cols.length} columns present`);
      if (missing.length > 0) console.log(`     Missing: ${missing.join(", ")}`);
    }

    // 4. Trigger check
    console.log("\n--- Trigger Check ---");
    const [trigRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS
       WHERE TRIGGER_SCHEMA = ? AND TRIGGER_NAME = 'trg_amo_locked_month_check'`,
      [DB_CONFIG.database]
    );
    const triggerExists = trigRows.length > 0;
    output.trigger_trg_amo_locked_month_check = triggerExists;
    console.log(`  ${triggerExists ? "✅" : "❌"} trg_amo_locked_month_check`);

    // 5. Migration count (if migrations table exists)
    console.log("\n--- Migration Count ---");
    try {
      const [migRows] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS cnt FROM migrations"
      );
      output.applied_migrations = migRows[0]?.cnt ?? 0;
      console.log(`  Applied migrations: ${output.applied_migrations}`);
    } catch {
      output.applied_migrations = "migrations table not found";
      console.log("  migrations table not found (may use timestamp-based runner)");
    }

    // 6. Row counts (read-only sanity)
    console.log("\n--- Row Counts ---");
    const countsToCheck = ["attendance_regularization", "attendance_daily_record", "sensitive_action_log", "attendance_manual_override"];
    output.row_counts = {};
    for (const tbl of countsToCheck) {
      try {
        const [cntRows] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ${tbl}`);
        const cnt = cntRows[0]?.cnt ?? 0;
        (output.row_counts as Record<string, number>)[tbl] = cnt;
        console.log(`  ${tbl}: ${cnt} rows`);
      } catch {
        (output.row_counts as Record<string, number | string>)[tbl] = "table not found";
        console.log(`  ${tbl}: ❌ table not found`);
      }
    }

    // Summary
    const allTablesOk = Object.values(output.tables as Record<string, boolean>).every(Boolean);
    const allColsOk = Object.values(output.columns as Record<string, { missing: string[] }>).every((v) => v.missing.length === 0);
    output.summary = {
      mysql_version_ok: versionOk,
      all_tables_exist: allTablesOk,
      all_columns_present: allColsOk,
      trigger_ok: triggerExists,
    };

    console.log("\n=== Summary ===");
    console.log(JSON.stringify(output.summary, null, 2));

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    output.connection_error = message;
    console.error(`\n❌ DB connection error: ${message}`);
    console.error("Check DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME in .env");
    process.exitCode = 1;
  } finally {
    if (conn) await conn.end();
  }

  // Write evidence file
  const outPath = path.resolve(__dirname, "phase2-describe-output.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nEvidence written to: ${outPath}`);
}

run();
