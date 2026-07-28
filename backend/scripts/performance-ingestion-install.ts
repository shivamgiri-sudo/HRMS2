import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const INGESTION_MIGRATIONS = [
  "520_performance_ingestion_platform.sql",
  "521_performance_multi_source_lineage.sql",
  "522_performance_governance_audit.sql",
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
    for (const filename of INGESTION_MIGRATIONS) {
      const migrationPath = path.resolve(currentDir, `../sql/${filename}`);
      await connection.query(fs.readFileSync(migrationPath, "utf8"));
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
