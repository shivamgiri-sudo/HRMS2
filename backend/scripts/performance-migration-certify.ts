import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { splitSql } from "../src/db/runPendingMigrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.resolve(__dirname, "../sql");

const TEST_DB = process.env.TEST_DB_NAME ?? "hrms_test_performance";
const DB_HOST = process.env.DB_HOST ?? "127.0.0.1";
const DB_PORT = Number(process.env.DB_PORT ?? 3306);
const DB_USER = process.env.DB_USER ?? "root";
const DB_PASSWORD = process.env.DB_PASSWORD ?? "";

const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const disposableDbName = /(^test_|_test$|_testing$|^hrms_migration_test_|^hrms_test_)/i.test(TEST_DB);
const allowDestructive = process.argv.includes("--allow-destructive-test-db");

if (!allowDestructive) {
  console.error("[performance-migration-certify] FATAL: missing --allow-destructive-test-db confirmation flag.");
  process.exit(1);
}

if (!localHosts.has(DB_HOST.trim().toLowerCase())) {
  console.error(`[performance-migration-certify] FATAL: refusing destructive certification on '${DB_HOST}'.`);
  process.exit(1);
}

if (!disposableDbName) {
  console.error(`[performance-migration-certify] FATAL: TEST_DB_NAME '${TEST_DB}' does not look disposable/test-scoped.`);
  process.exit(1);
}

const connBase = {
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
};

async function runSqlFile(file: string, database: string): Promise<void> {
  const rawSql = fs.readFileSync(path.join(SQL_DIR, file), "utf8");
  const statements = splitSql(rawSql).filter((stmt) => {
    const upper = stmt.trim().toUpperCase();
    return upper.length > 0 && !upper.startsWith("SOURCE ") && !upper.startsWith("USE ");
  });

  const conn = await mysql.createConnection({ ...connBase, database, multipleStatements: false });
  try {
    for (let i = 0; i < statements.length; i++) {
      try {
        await conn.query(statements[i]);
      } catch (error) {
        console.error(`[performance-migration-certify] FAILED: ${file} statement #${i + 1}`);
        console.error(statements[i]);
        throw error;
      }
    }
  } finally {
    await conn.end();
  }
}

async function columnExists(database: string, tableName: string, columnName: string): Promise<boolean> {
  const conn = await mysql.createConnection(connBase);
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT 1
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
        LIMIT 1`,
      [database, tableName, columnName],
    );
    return rows.length > 0;
  } finally {
    await conn.end();
  }
}

async function indexExists(database: string, tableName: string, indexName: string): Promise<boolean> {
  const conn = await mysql.createConnection(connBase);
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT 1
         FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
          AND INDEX_NAME = ?
        LIMIT 1`,
      [database, tableName, indexName],
    );
    return rows.length > 0;
  } finally {
    await conn.end();
  }
}

async function main(): Promise<void> {
  const adminConn = await mysql.createConnection(connBase);
  try {
    const [versionRows] = await adminConn.query<RowDataPacket[]>("SELECT VERSION() AS version");
    console.log(`[performance-migration-certify] MySQL version: ${versionRows[0]?.version ?? "unknown"}`);
    console.log(`[performance-migration-certify] Host: ${DB_HOST}`);
    console.log(`[performance-migration-certify] Port: ${DB_PORT}`);
    console.log(`[performance-migration-certify] Test database: ${TEST_DB}`);

    await adminConn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await adminConn.query(`CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await adminConn.end();
  }

  const conn = await mysql.createConnection({ ...connBase, database: TEST_DB, multipleStatements: true });
  try {
    await conn.query(`
      CREATE TABLE kpi_metric_master (
        id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
        metric_code VARCHAR(50) NOT NULL UNIQUE,
        metric_name VARCHAR(255) NOT NULL,
        family VARCHAR(30) NULL,
        category VARCHAR(30) NOT NULL,
        unit VARCHAR(50) NOT NULL,
        direction VARCHAR(30) NOT NULL,
        active_status TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE kpi_daily_actual (
        id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
        employee_id CHAR(36) NOT NULL,
        metric_id CHAR(36) NOT NULL,
        score_date DATE NOT NULL,
        actual_value DECIMAL(12,4) NULL,
        numerator_value DECIMAL(18,6) NULL,
        denominator_value DECIMAL(18,6) NULL,
        source VARCHAR(30) NOT NULL DEFAULT 'manual',
        source_system VARCHAR(50) NULL,
        source_record_count INT UNSIGNED NULL,
        formula_version_id CHAR(36) NULL,
        integration_run_id CHAR(36) NULL,
        computed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_emp_metric_date (employee_id, metric_id, score_date)
      );

      INSERT INTO kpi_metric_master (metric_code, metric_name, category, unit, direction) VALUES
        ('AHT', 'Average Handle Time', 'operations', 'seconds', 'lower_is_better'),
        ('QUALITY_SCORE', 'Quality Audit Score', 'quality', 'percent', 'higher_is_better'),
        ('SALES_COUNT', 'Sales Count', 'sales', 'count', 'higher_is_better');
    `);
  } finally {
    await conn.end();
  }

  for (const file of [
    "580_performance_ingestion_platform.sql",
    "581_performance_multi_source_lineage.sql",
    "582_performance_governance_audit.sql",
  ]) {
    console.log(`[performance-migration-certify] Running ${file}`);
    await runSqlFile(file, TEST_DB);
  }

  const requiredColumns: Array<[string, string]> = [
    ["performance_fact_lineage", "calculation_multiplier"],
    ["performance_fact_lineage", "source_event_timestamp"],
    ["performance_fact_lineage", "source_record_count"],
    ["kpi_daily_actual", "calculation_multiplier"],
    ["performance_governance_audit", "entity_type"],
  ];

  for (const [tableName, columnName] of requiredColumns) {
    if (!(await columnExists(TEST_DB, tableName, columnName))) {
      throw new Error(`Expected ${tableName}.${columnName} to exist after performance migrations`);
    }
  }

  if (!(await indexExists(TEST_DB, "performance_fact_lineage", "idx_performance_lineage_latest"))) {
    throw new Error("Expected idx_performance_lineage_latest to exist after performance migrations");
  }

  console.log("[performance-migration-certify] Performance migrations 580-582 certified.");
}

main().catch((error) => {
  console.error("[performance-migration-certify] Unexpected error:", error);
  process.exit(1);
});
