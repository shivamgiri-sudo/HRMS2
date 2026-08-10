import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { MIGRATION_MANIFEST, splitSql } from "../src/db/runPendingMigrations.js";

const TARGET_MIGRATION = "522_performance_governance_audit.sql";
const host = process.env.DB_HOST ?? "127.0.0.1";
const port = Number(process.env.DB_PORT ?? 3306);
const user = process.env.DB_USER ?? "root";
const password = process.env.DB_PASSWORD ?? "";
const database = process.env.DB_NAME ?? "hrms_migration_test_performance";
const sqlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../sql");

function assertDisposableTarget(): void {
  const normalisedHost = host.trim().toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(normalisedHost)) {
    throw new Error(`Refusing destructive full-schema verification on non-loopback host: ${host}`);
  }
  if (!/^hrms_migration_test_[a-z0-9_]+$/i.test(database)) {
    throw new Error(
      `Refusing destructive full-schema verification: DB_NAME must start with hrms_migration_test_ (received ${database})`,
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid DB_PORT: ${String(process.env.DB_PORT ?? "")}`);
  }
}

function manifestThroughTarget(): string[] {
  const targetIndex = MIGRATION_MANIFEST.indexOf(TARGET_MIGRATION);
  if (targetIndex < 0) {
    throw new Error(`${TARGET_MIGRATION} is missing from the canonical migration manifest`);
  }
  return MIGRATION_MANIFEST.slice(0, targetIndex + 1);
}

function checksum(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function normaliseForMySQL8(sql: string): string {
  // Strip MariaDB-only conditional DDL guards. On a fresh empty schema every ADD/CREATE
  // is safe without the guard, and every CHANGE/MODIFY that would fail silently can
  // be converted to an unconditional form (the column either exists or the statement
  // is idempotent-safe on a fresh DB).
  return sql
    // ALTER TABLE … ADD COLUMN / ADD INDEX variants
    .replace(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/gi, "ADD COLUMN")
    .replace(/\bADD\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi, "ADD INDEX")
    .replace(/\bADD\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi, "ADD UNIQUE INDEX")
    .replace(/\bADD\s+UNIQUE\s+KEY\s+IF\s+NOT\s+EXISTS\b/gi, "ADD UNIQUE KEY")
    // Standalone CREATE INDEX IF NOT EXISTS
    .replace(/\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi, "CREATE INDEX")
    .replace(/\bCREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi, "CREATE UNIQUE INDEX")
    // ALTER TABLE … CHANGE COLUMN IF EXISTS / MODIFY COLUMN IF EXISTS
    .replace(/\bCHANGE\s+COLUMN\s+IF\s+EXISTS\b/gi, "CHANGE COLUMN")
    .replace(/\bMODIFY\s+COLUMN\s+IF\s+EXISTS\b/gi, "MODIFY COLUMN")
    // ALTER TABLE … DROP INDEX IF EXISTS (MariaDB) → DROP INDEX (MySQL uses DROP INDEX name ON tbl)
    .replace(/\bDROP\s+INDEX\s+IF\s+EXISTS\b/gi, "DROP INDEX")
    // Tables declared with DEFAULT CHARSET=utf8mb4 but no explicit collation inherit
    // MySQL 8.4's default utf8mb4_0900_ai_ci, which differs from the test DB's
    // utf8mb4_unicode_ci, causing FK incompatibility errors on CHAR/VARCHAR columns.
    // Append the matching collation so every table is consistent with the DB.
    .replace(/\bCHARSET\s*=\s*utf8mb4\s*;/gi, "CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;")
    .replace(/\bCHARSET\s*=\s*utf8mb4\s*\n/gi, "CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci\n")
    .replace(/\bCHARSET\s*=\s*utf8mb4\s*$/gim, "CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci");
}

function executableStatements(rawSql: string): string[] {
  return splitSql(normaliseForMySQL8(rawSql)).filter((statement) => {
    const upper = statement.trim().toUpperCase();
    return !upper.startsWith("SOURCE ")
      && !upper.startsWith("USE ")
      && !upper.startsWith("CREATE DATABASE ");
  });
}

async function scalar(
  connection: mysql.Connection,
  query: string,
  params: unknown[] = [],
): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>(query, params);
  return Number(Object.values(rows[0] ?? {})[0] ?? 0);
}

async function applyManifest(
  connection: mysql.Connection,
  files: string[],
): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    const [existing] = await connection.execute<RowDataPacket[]>(
      "SELECT checksum_sha256 FROM schema_migrations WHERE filename = ? AND success = 1",
      [file],
    );
    if (existing[0]) {
      skipped += 1;
      continue;
    }

    const filePath = path.join(sqlDir, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Canonical manifest references missing migration before ${TARGET_MIGRATION}: ${file}`);
    }

    const rawSql = fs.readFileSync(filePath, "utf8");
    const statements = executableStatements(rawSql);
    const startedAt = Date.now();

    for (let index = 0; index < statements.length; index += 1) {
      try {
        await connection.query(statements[index]);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Fresh-schema migration failed in ${file}, statement #${index + 1}/${statements.length}: ${detail}\n` +
            statements[index].slice(0, 2000),
        );
      }
    }

    await connection.execute(
      `INSERT INTO schema_migrations
         (filename, checksum_sha256, environment, duration_ms, success)
       VALUES (?, ?, 'disposable_test', ?, 1)`,
      [file, checksum(filePath), Date.now() - startedAt],
    );
    applied += 1;
    console.log(`[performance-fresh-schema] applied ${file}`);
  }

  return { applied, skipped };
}

async function verifyPerformanceSchema(connection: mysql.Connection): Promise<Record<string, number>> {
  const requiredTables = [
    "kpi_metric_master",
    "kpi_daily_actual",
    "performance_source_dataset",
    "performance_mapping_version",
    "performance_identity_map",
    "performance_process_map",
    "performance_ingestion_run",
    "performance_raw_record",
    "performance_validation_result",
    "performance_reconciliation_result",
    "performance_publication_batch",
    "performance_fact_lineage",
    "performance_governance_audit",
  ];

  const tableCount = await scalar(
    connection,
    `SELECT COUNT(*) AS total
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME IN (${requiredTables.map(() => "?").join(",")})`,
    [database, ...requiredTables],
  );
  if (tableCount !== requiredTables.length) {
    throw new Error(`Expected ${requiredTables.length} required performance tables, found ${tableCount}`);
  }

  const lineageColumns = [
    "source_dataset_id",
    "mapping_version_id",
    "source_record_count",
    "process_id_at_event",
    "branch_id_at_event",
  ];
  const lineageColumnCount = await scalar(
    connection,
    `SELECT COUNT(*) AS total
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'performance_fact_lineage'
        AND COLUMN_NAME IN (${lineageColumns.map(() => "?").join(",")})`,
    [database, ...lineageColumns],
  );
  if (lineageColumnCount !== lineageColumns.length) {
    throw new Error(`Expected ${lineageColumns.length} performance lineage columns, found ${lineageColumnCount}`);
  }

  const canonicalColumns = [
    "source_dataset_id",
    "mapping_version_id",
    "publication_batch_id",
    "process_id_at_event",
    "branch_id_at_event",
    "source_record_count",
  ];
  const canonicalColumnCount = await scalar(
    connection,
    `SELECT COUNT(*) AS total
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'kpi_daily_actual'
        AND COLUMN_NAME IN (${canonicalColumns.map(() => "?").join(",")})`,
    [database, ...canonicalColumns],
  );
  if (canonicalColumnCount !== canonicalColumns.length) {
    throw new Error(`Expected ${canonicalColumns.length} canonical KPI lineage columns, found ${canonicalColumnCount}`);
  }

  const appliedThroughTarget = await scalar(
    connection,
    "SELECT COUNT(*) AS total FROM schema_migrations WHERE filename = ? AND success = 1",
    [TARGET_MIGRATION],
  );
  if (appliedThroughTarget !== 1) {
    throw new Error(`${TARGET_MIGRATION} is not recorded as successfully applied`);
  }

  return {
    requiredTables: tableCount,
    lineageColumns: lineageColumnCount,
    canonicalColumns: canonicalColumnCount,
  };
}

async function main(): Promise<void> {
  assertDisposableTarget();
  const files = manifestThroughTarget();
  const admin = await mysql.createConnection({ host, port, user, password, charset: "utf8mb4" });
  let connection: mysql.Connection | null = null;

  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      charset: "utf8mb4",
      multipleStatements: false,
    });
    await connection.query(`
      CREATE TABLE schema_migrations (
        filename VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        checksum_sha256 VARCHAR(64) NULL,
        environment VARCHAR(50) NULL,
        duration_ms INT NULL,
        success TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const firstRun = await applyManifest(connection, files);
    const schema = await verifyPerformanceSchema(connection);
    const secondRun = await applyManifest(connection, files);

    if (secondRun.applied !== 0 || secondRun.skipped !== files.length) {
      throw new Error(
        `Second-run idempotency failed: applied=${secondRun.applied}, skipped=${secondRun.skipped}, expected skipped=${files.length}`,
      );
    }

    console.log(JSON.stringify({
      result: "PASS",
      database,
      targetMigration: TARGET_MIGRATION,
      manifestFiles: files.length,
      firstRun,
      secondRun,
      schema,
    }, null, 2));
  } finally {
    await connection?.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
