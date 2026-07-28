import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const INGESTION_MIGRATIONS = [
  "580_performance_ingestion_platform.sql",
  "581_performance_multi_source_lineage.sql",
  "582_performance_governance_audit.sql",
] as const;

function requireApplyFlag(): void {
  if (!process.argv.includes("--apply")) {
    throw new Error("Dry safety stop: pass --apply to install the performance ingestion schema");
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  requireApplyFlag();
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const connection = await mysql.createConnection({
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 3306),
    user: required("DB_USER"),
    password: process.env.DB_PASSWORD ?? "",
    database: required("DB_NAME"),
    multipleStatements: true,
    connectTimeout: 15_000,
  });

  try {
    await connection.query(`
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
    for (const filename of INGESTION_MIGRATIONS) {
      const migrationPath = path.resolve(currentDir, `../sql/${filename}`);
      const sql = fs.readFileSync(migrationPath, "utf8");
      const start = Date.now();
      await connection.query(sql);
      const durationMs = Date.now() - start;
      // Record in schema_migrations so the main migration runner does not re-run these
      await connection.query(
        `INSERT INTO schema_migrations (filename, applied_at, environment, start_time, end_time, duration_ms, executor, success)
         VALUES (?, NOW(), ?, NOW(), NOW(), ?, 'performance-ingestion-install', 1)
         ON DUPLICATE KEY UPDATE applied_at = applied_at`,
        [filename, process.env.NODE_ENV ?? "production", durationMs],
      );
    }
    const [rows] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'performance_ingestion_run') AS ingestion_table,
         (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_daily_actual' AND COLUMN_NAME = 'source_dataset_id') AS lineage_column,
         (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'performance_fact_lineage' AND COLUMN_NAME = 'source_dataset_id') AS multi_source_lineage_column,
         (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_metric_master' AND COLUMN_NAME = 'aggregation_method') AS dynamic_metric_column,
         (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'performance_governance_audit') AS governance_audit_table`,
    );
    console.log(JSON.stringify({
      installed: true,
      migrations: INGESTION_MIGRATIONS,
      verification: (rows as any[])[0] ?? {},
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
